"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpIcon, CameraIcon, SquareIcon, XIcon } from "lucide-react";
import { signOut } from "@/app/login/actions";
import type { CompanionCopy } from "@/lib/companions/types";
import type { AnswerPhase, WebSourceRef } from "@/lib/ai/types";
import type { StreamEvent } from "@/lib/ask/ask";
import type { AnswerSnapshot } from "@/lib/ask/relay";
import { fitToBudget } from "@/lib/ask/budget";
import { readNdjson } from "@/lib/ask/ndjson";
import { PHOTO_ACCEPT, preparePhoto, type PreparedPhoto } from "@/lib/ask/photos";
import { MAX_PHOTOS_PER_TURN, type AskTurn } from "@/lib/ask/prompt";
import { cn } from "@/lib/utils";

interface StagedPhoto {
  key: string;
  previewUrl: string;
  photo?: PreparedPhoto;
  error?: string;
}

interface Turn {
  key: string;
  role: "user" | "assistant";
  text: string;
  photos?: PreparedPhoto[];
  pending?: boolean;
  /** What's happening while the answer is pending, from the server's own events. */
  progress?: Progress;
  sources?: WebSourceRef[];
  error?: string;
  /** When the question was sent, to say so if the answer is slow to start. */
  sentAt?: number;
}

type Progress = "sending" | AnswerPhase | "reconnecting";

const PROGRESS_LABEL: Record<Progress, string> = {
  sending: "Sending your question",
  thinking: "Thinking through your question",
  searching: "Checking sources",
  writing: "Writing your answer",
  reconnecting: "Reconnecting",
};

/** One question in flight. The id lets the page collect the answer if the connection drops. */
interface InFlight {
  id: string;
  controller: AbortController;
  stopped: boolean;
  /** Collecting the answer from the server rather than streaming it live. */
  recovering: boolean;
  /** The server has answered the request (headers arrived). */
  connected: boolean;
  sentAt: number;
  lastEvent: number;
}

type Outcome = "answered" | "failed" | "stopped" | "lost";

// After returning to the page, a stream that has said nothing for this long is
// treated as dropped and the answer is collected from the server instead.
const STALL_MS = 2500;
// The server sends something at least every 10 seconds; this much silence on a
// visible page means the connection died, so collect the answer instead.
const SILENCE_MS = 30_000;
// Sending photos on a slow connection takes a while, but not this long.
const CONNECT_MS = 120_000;
const WATCHDOG_MS = 5000;
const RECOVERY_POLL_MS = 1200;
const CHECK_TIMEOUT_MS = 10_000;
// The server saves a live answer at least every 10 seconds; a saved answer that
// hasn't moved for this long was cut off and won't finish.
const STALE_MS = 45_000;
// A little longer than the server's own limit on one answer, counted from sending.
const ANSWER_LIMIT_MS = 6 * 60_000;
// Consecutive "not found" replies before deciding the question never arrived.
const RECOVERY_MISSES = 5;
const LOST_MESSAGE = "The connection dropped before the answer finished. Try again.";

let counter = 0;
const nextKey = () => `k${++counter}`;
/** Resolves after `ms`, or at once when `signal` aborts. */
const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export function Studio({
  companion,
  share,
  signedIn = false,
}: {
  companion: CompanionCopy;
  /** What the share button sends: the app itself when it's open, or an invitation link. */
  share?: { path: string; label: string } | null;
  /** Sign-in is on for this deployment, so offer Sign out. */
  signedIn?: boolean;
}) {
  const [thread, setThread] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef<InFlight | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // A phone suspends the page when its owner switches apps, which can leave the
  // answer's connection dead. On return, if nothing has arrived, collect the
  // answer from the server instead.
  useEffect(() => {
    const onVisibility = () => {
      const live = inFlight.current;
      if (document.visibilityState !== "visible" || !live || live.recovering) return;
      const returnedAt = Date.now();
      setTimeout(() => {
        if (inFlight.current === live && !live.stopped && !live.recovering && live.lastEvent < returnedAt) {
          live.controller.abort();
        }
      }, STALL_MS);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const preparing = staged.some((p) => !p.photo && !p.error);
  const ready = staged.filter((p) => p.photo);
  const canSend = !busy && !preparing && (text.trim().length > 0 || ready.length > 0);
  const started = thread.length > 0;

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const room = MAX_PHOTOS_PER_TURN - staged.length;
      const list = [...files].filter((f) => f.type.startsWith("image/") || f.type === "");
      setNotice(list.length > room ? `Up to ${MAX_PHOTOS_PER_TURN} photos at a time.` : null);
      for (const file of list.slice(0, Math.max(0, room))) {
        const key = nextKey();
        const previewUrl = URL.createObjectURL(file);
        setStaged((s) => [...s, { key, previewUrl }]);
        preparePhoto(file).then(
          (photo) => {
            URL.revokeObjectURL(previewUrl);
            setStaged((s) => s.map((p) => (p.key === key ? { ...p, photo, previewUrl: photo.previewUrl } : p)));
          },
          (err: unknown) => {
            // Drop the photo and say why, rather than leaving a dead thumbnail.
            URL.revokeObjectURL(previewUrl);
            setStaged((s) => s.filter((p) => p.key !== key));
            setNotice(err instanceof Error ? err.message : "Couldn't read that photo.");
          },
        );
      }
    },
    [staged.length],
  );

  const removeStaged = (key: string) => setStaged((s) => s.filter((p) => p.key !== key));

  const update = (key: string, fn: (t: Turn) => Turn) => setThread((all) => all.map((t) => (t.key === key ? fn(t) : t)));

  const apply = (key: string, event: StreamEvent) => {
    if (event.type === "phase") update(key, (t) => ({ ...t, progress: event.phase }));
    else if (event.type === "searching") update(key, (t) => ({ ...t, progress: "searching" }));
    else if (event.type === "text") update(key, (t) => ({ ...t, text: t.text + event.text }));
    else if (event.type === "sources") update(key, (t) => ({ ...t, sources: [...(t.sources ?? []), ...event.sources] }));
    else if (event.type === "error") update(key, (t) => ({ ...t, error: event.message }));
  };

  /** Streams the answer live; "lost" means the connection went before the answer finished. */
  const stream = async (live: InFlight, key: string, turns: AskTurn[]): Promise<Outcome> => {
    // Nothing at all for too long on a visible page: stop waiting on this
    // connection and collect the answer from the server instead.
    const watchdog = setInterval(() => {
      if (live.stopped || live.recovering || document.visibilityState !== "visible") return;
      if (Date.now() - live.lastEvent > (live.connected ? SILENCE_MS : CONNECT_MS)) live.controller.abort();
    }, WATCHDOG_MS);
    try {
      return await streamOnce(live, key, turns);
    } finally {
      clearInterval(watchdog);
    }
  };

  const streamOnce = async (live: InFlight, key: string, turns: AskTurn[]): Promise<Outcome> => {
    let response: Response;
    try {
      response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: live.id, turns }),
        signal: live.controller.signal,
      });
    } catch {
      return live.stopped ? "stopped" : "lost";
    }
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message =
        body.error ??
        (response.status === 413 ? "Those photos are too large to send together. Try fewer." : `Request failed (${response.status})`);
      update(key, (t) => ({ ...t, error: message }));
      return "failed";
    }
    live.connected = true;
    live.lastEvent = Date.now();
    try {
      for await (const event of readNdjson<StreamEvent>(response.body!)) {
        if (live.stopped) return "stopped";
        live.lastEvent = Date.now();
        apply(key, event);
        if (event.type === "done") return "answered";
        if (event.type === "error") return event.message === "Stopped." ? "stopped" : "failed";
      }
    } catch {
      if (live.stopped) return "stopped";
    }
    return "lost";
  };

  /** Collects an answer the server kept writing while the page was away. */
  const recover = async (live: InFlight, key: string): Promise<Outcome> => {
    update(key, (t) => ({ ...t, progress: "reconnecting" }));
    live.recovering = true;
    live.controller = new AbortController();
    const giveUpAt = live.sentAt + ANSWER_LIMIT_MS;
    let misses = 0;
    // When the saved answer last moved, to tell a long think from one that was cut off.
    let seen = "";
    let movedAt = Date.now();
    while (!live.stopped && Date.now() < giveUpAt && misses < RECOVERY_MISSES) {
      if (document.visibilityState === "visible") {
        // A check that hangs (a dead connection) mustn't hold up the next one.
        const check = new AbortController();
        const timer = setTimeout(() => check.abort(), CHECK_TIMEOUT_MS);
        const onStop = () => check.abort();
        live.controller.signal.addEventListener("abort", onStop, { once: true });
        try {
          const res = await fetch(`/api/ask/${live.id}`, { cache: "no-store", signal: check.signal });
          if (res.status === 404) misses++;
          else if (res.ok) {
            misses = 0;
            const saved: AnswerSnapshot = await res.json();
            if (live.stopped) break;
            // The saved copy can trail what already arrived live; keep whichever is further along.
            update(key, (t) => ({
              ...t,
              text: saved.text.length > t.text.length ? saved.text : t.text,
              sources: saved.sources.length > (t.sources?.length ?? 0) ? saved.sources : t.sources,
              progress: saved.phase ?? t.progress,
            }));
            if (saved.done) {
              if (!saved.error) return "answered";
              update(key, (t) => ({ ...t, error: saved.error }));
              return saved.error === "Stopped." ? "stopped" : "failed";
            }
            const mark = String(saved.updatedAt ?? `${saved.phase}|${saved.text.length}|${saved.sources.length}`);
            if (mark !== seen) {
              seen = mark;
              movedAt = Date.now();
            } else if (Date.now() - movedAt > STALE_MS) {
              update(key, (t) => ({ ...t, error: `${companion.name} stopped responding before the answer finished. Try again.` }));
              return "failed";
            }
          }
        } catch {
          // Still offline or just resumed; try again shortly.
        } finally {
          clearTimeout(timer);
          live.controller.signal.removeEventListener("abort", onStop);
        }
      }
      await wait(RECOVERY_POLL_MS, live.controller.signal);
    }
    if (live.stopped) return "stopped";
    update(key, (t) => ({ ...t, error: LOST_MESSAGE }));
    return "failed";
  };

  /** Asks the server to stop an answer, in case it is still being written for no one. */
  const stopOnServer = (id: string) => void fetch(`/api/ask/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});

  const ask = () => {
    if (!canSend) return;
    if (send(text.trim(), ready.map((p) => p.photo!), thread)) {
      setText("");
      setStaged((s) => s.filter((p) => !p.photo));
    }
  };

  /** Sends the same question and photos again, in place of the answer that failed. */
  const retry = (answerKey: string) => {
    const i = thread.findIndex((t) => t.key === answerKey);
    const question = thread[i - 1];
    if (busy || i < 1 || question?.role !== "user") return;
    send(question.text, question.photos ?? [], [...thread.slice(0, i - 1), ...thread.slice(i + 1)]);
  };

  /** Starts a question after the given conversation; false if it can't be sent as is. */
  const send = (question: string, photos: PreparedPhoto[], before: Turn[]): boolean => {
    const userTurn: Turn = { key: nextKey(), role: "user", text: question, photos };
    const sentAt = Date.now();
    const answer: Turn = { key: nextKey(), role: "assistant", text: "", pending: true, progress: "sending", sentAt };

    // Earlier photos go along small; this question's photos go at full size.
    let turns: AskTurn[];
    try {
      turns = fitToBudget([
        ...before
          .filter((t) => !t.error && (t.role === "user" || t.text.trim()))
          .map((t) => ({ role: t.role, text: t.text, images: t.photos?.map((p) => p.small) })),
        { role: "user", text: question, images: photos.map((p) => p.full) },
      ]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Those photos are too large to send together.");
      return false;
    }

    following.current = true;
    setThread([...before, userTurn, answer]);
    setNotice(null);
    setBusy(true);
    const live: InFlight = {
      id: crypto.randomUUID(),
      controller: new AbortController(),
      stopped: false,
      recovering: false,
      connected: false,
      sentAt,
      lastEvent: sentAt,
    };
    inFlight.current = live;
    void run(live, answer.key, turns);
    return true;
  };

  const run = async (live: InFlight, key: string, turns: AskTurn[]) => {
    let outcome: Outcome;
    try {
      outcome = await stream(live, key, turns);
      if (outcome === "lost") outcome = await recover(live, key);
    } catch (err) {
      update(key, (t) => ({ ...t, error: err instanceof Error ? err.message : "Something went wrong." }));
      outcome = "failed";
    }

    if (outcome === "stopped") update(key, (t) => ({ ...t, error: t.error ?? "Stopped." }));
    // The page gave up waiting; make sure the server isn't still writing it, so a
    // Retry doesn't leave two answers running.
    if (outcome === "failed" && !live.stopped) stopOnServer(live.id);
    update(key, (t) => ({ ...t, pending: false, progress: undefined }));
    // After New, a fresh question may already be in flight; leave its state alone.
    if (inFlight.current === live) {
      inFlight.current = null;
      setBusy(false);
    }
  };

  /** Stops the answer here and on the server, so it isn't written for no one. */
  const stop = () => {
    const live = inFlight.current;
    if (!live) return;
    live.stopped = true;
    live.controller.abort();
    stopOnServer(live.id);
  };

  const startOver = () => {
    stop();
    setThread([]);
    setText("");
    setStaged([]);
    setNotice(null);
    inputRef.current?.focus();
  };

  // Follow the answer as it streams, unless the reader has scrolled up to read.
  const following = useRef(true);
  useEffect(() => {
    if (following.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [thread]);

  // Grow the text box with its content, up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ask();
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
      className="w-full rounded-3xl bg-surface p-3 shadow-[0_2px_8px_rgba(0,0,0,0.08)] transition-all focus-within:shadow-[0_4px_12px_rgba(0,0,0,0.12)]"
    >
      {staged.length ? (
        <div className="flex gap-2 overflow-x-auto px-1 pb-2 pt-1 [scrollbar-width:none]">
          {staged.map((p) => (
            <div key={p.key} className="relative shrink-0" title={p.error}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local preview */}
              <img
                src={p.previewUrl}
                alt=""
                className={cn("size-16 rounded-xl object-cover", !p.photo && "opacity-50", p.error && "opacity-25")}
              />
              <button
                type="button"
                onClick={() => removeStaged(p.key)}
                aria-label="Remove photo"
                className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-ink text-ground"
              >
                <XIcon className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={staged.length >= MAX_PHOTOS_PER_TURN}
          aria-label="Add photos"
          className="grid size-10 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-sunk disabled:opacity-30"
        >
          <CameraIcon className="size-[22px]" strokeWidth={1.6} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            const finePointer = window.matchMedia("(pointer: fine)").matches;
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && finePointer) {
              e.preventDefault();
              void ask();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          rows={1}
          placeholder={staged.length ? companion.placeholderWithPhotos : companion.placeholder}
          aria-label={`Ask ${companion.name}`}
          className="min-h-10 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            aria-label="Stop"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-ground"
          >
            <SquareIcon className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Send"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-ground transition-opacity disabled:opacity-15"
          >
            <ArrowUpIcon className="size-5" strokeWidth={2} />
          </button>
        )}
      </div>
    </form>
  );

  const hint = notice ? <p className="mt-3 px-4 text-center text-sm text-warn">{notice}</p> : null;

  if (!started) {
    return (
      <div className="flex min-h-dvh flex-col">
        <div className="flex-shrink-0 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-2">
          <div className="mx-auto w-full max-w-[640px]">
            <a href="https://fresh2-pi.vercel.app" className="text-sm text-ink-muted transition-colors hover:text-ink">
              ← Back
            </a>
          </div>
        </div>
        <main className="flex flex-1 flex-col items-center justify-start px-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-[640px]" style={{ marginTop: 'max(calc(3rem + 48px), calc(2.5vh + env(safe-area-inset-top) + 48px))' }}>
            <h1 className="text-center text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">{companion.name}</h1>
            <p className="mt-2 text-center text-[15px] text-ink-muted">{companion.role}</p>
            <p className="mx-auto mt-6 max-w-[32rem] text-center font-serif text-[clamp(22px,5.6vw,28px)] leading-[1.3] tracking-[-0.01em] text-ink [text-wrap:balance]">
              {companion.intro}
            </p>
            <div className="mt-10">{composer}</div>
            {hint}
          </div>
        </main>
        <div className="fixed inset-x-0 bottom-0 flex justify-center gap-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-sm text-ink-muted">
          {share ? <ShareButton path={share.path} label={share.label} companion={companion} /> : null}
          {signedIn ? (
            <form action={signOut}>
              <button type="submit" className="transition-colors hover:text-ink">
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[640px] shrink-0 items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <a href="https://fresh2-pi.vercel.app" className="text-sm text-ink-muted transition-colors hover:text-ink">
          ← Back
        </a>
        <p className="text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">{companion.name}</p>
        <button type="button" onClick={startOver} className="text-sm text-ink-muted transition-colors hover:text-ink">
          New
        </button>
      </header>

      <main
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-8">
          {thread.map((t, i) =>
            t.role === "user" ? (
              <Question key={t.key} turn={t} />
            ) : (
              <Answer
                key={t.key}
                turn={t}
                onRetry={!busy && t.error && i === thread.length - 1 ? () => retry(t.key) : undefined}
              />
            ),
          )}
          <div ref={endRef} />
        </div>
      </main>

      <div className="mx-auto w-full max-w-[640px] shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        {composer}
        {hint}
      </div>
    </div>
  );
}

function Question({ turn }: { turn: Turn }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {turn.photos?.length ? (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
          {turn.photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element -- local preview
            <img key={p.previewUrl} src={p.previewUrl} alt="" className="size-24 rounded-xl object-cover" />
          ))}
        </div>
      ) : null}
      {turn.text ? (
        <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-sm bg-ink px-5 py-3 text-[15px] leading-relaxed text-ground shadow-[0_2px_6px_rgba(0,0,0,0.12)] [overflow-wrap:anywhere]">
          {turn.text}
        </p>
      ) : null}
    </div>
  );
}

// After this long with nothing written yet, say that's expected for a big question.
const SLOW_START_MS = 40_000;

function Answer({ turn, onRetry }: { turn: Turn; onRetry?: () => void }) {
  const waiting = !!turn.pending && !turn.text && turn.sentAt !== undefined;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), Math.max(0, turn.sentAt! + SLOW_START_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [waiting, turn.sentAt]);

  return (
    <div className="min-w-0">
      {turn.text ? (
        <div className="gio-prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {turn.text}
          </ReactMarkdown>
        </div>
      ) : null}
      {turn.pending ? (
        <p role="status" className={cn("leading-relaxed text-ink-muted", turn.text ? "mt-4 text-sm" : "text-[15px]")}>
          <span className="gio-dots">{PROGRESS_LABEL[turn.progress ?? "sending"]}</span>
          {slow && waiting ? (
            <span className="mt-1 block text-sm">Detailed questions can take a few minutes.</span>
          ) : null}
        </p>
      ) : null}
      {turn.error ? (
        <div className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-2", turn.text ? "mt-4 border-t border-ink/10 pt-3" : "mt-3")}>
          <p className="text-[15px] text-warn">{turn.error}</p>
          {onRetry ? (
            <button type="button" onClick={onRetry} className="text-[15px] font-medium text-ink underline underline-offset-4">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {!turn.pending && turn.text.trim() ? (
        <div className="mt-5 flex flex-wrap items-start gap-x-5 gap-y-2 text-sm text-ink-muted">
          <CopyButton text={turn.text} />
          {turn.sources?.length ? <Sources sources={turn.sources} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Shares a link to the app: the share sheet on a phone, the clipboard elsewhere. */
function ShareButton({ path, label, companion }: { path: string; label: string; companion: CompanionCopy }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="transition-colors hover:text-ink"
      onClick={async () => {
        const url = new URL(path, window.location.origin).toString();
        if (navigator.share) {
          try {
            await navigator.share({ title: companion.name, text: `${companion.name}. ${companion.tagline}`, url });
            return;
          } catch (err) {
            if (err instanceof DOMException && err.name === "AbortError") return; // closed the sheet
          }
        }
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {}
      }}
    >
      {copied ? "Link copied" : label}
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="self-start transition-colors hover:text-ink"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {}
      }}
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function Sources({ sources }: { sources: WebSourceRef[] }) {
  const unique = [...new Map(sources.map((s) => [s.url, s])).values()].slice(0, 12);
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer select-none transition-colors hover:text-ink">Sources</summary>
      <ul className="mt-2 space-y-1">
        {unique.map((s) => (
          <li key={s.url} className="truncate">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-ink hover:underline">
              {s.title || s.url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
