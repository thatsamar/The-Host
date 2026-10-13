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
import { connectionAbandoned, recoverAnswer, type SavedRead } from "@/lib/ask/recovery";
import { cn } from "@/lib/utils";

interface StagedPhoto {
  key: string;
  previewUrl: string;
  photo?: PreparedPhoto;
  error?: string;
}

/** A question set aside, whole, so the text box can hold another: its words and photos as they were. */
interface SavedDraft {
  key: string;
  text: string;
  staged: StagedPhoto[];
  /** Why it was set aside: a question too large to send, or a draft switched out. */
  tooLarge: boolean;
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
  /** When the server answered the request (headers arrived); its time limit runs from about then. */
  connectedAt?: number;
  /** Size of the request, to allow for uploading it on a slow connection. */
  bodyBytes: number;
  lastEvent: number;
  /** The server ended this answer itself, so there's nothing left to stop. */
  settled: boolean;
}

type Outcome = "answered" | "failed" | "stopped" | "lost" | "too-large";

// After returning to the page, an established stream that has said nothing for
// this long is treated as dropped and the answer is collected from the server.
const STALL_MS = 2500;
const WATCHDOG_MS = 5000;
const CHECK_TIMEOUT_MS = 10_000;
const LOST_MESSAGE = "The connection dropped before the answer finished. Try again.";
const TOO_LARGE_MESSAGE = "Those photos are too large to send together. Remove one or more and send again.";
const TOO_LARGE_SAVED_MESSAGE =
  "That question's photos are too large to send together. It's saved below the box: switch to it to remove a photo.";

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
  // Questions set aside so the text box can hold another; each can be switched back in.
  const [saved, setSaved] = useState<SavedDraft[]>([]);
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
        // A request still uploading has its own, size-aware timeout; don't cut it off here.
        const quiet = live.connectedAt !== undefined && live.lastEvent < returnedAt;
        if (inFlight.current === live && !live.stopped && !live.recovering && quiet) {
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
        // The photo may have been set aside with its draft by the time it's ready.
        const updatePhoto = (fn: (s: StagedPhoto[]) => StagedPhoto[]) => {
          setStaged(fn);
          setSaved((all) => all.map((d) => ({ ...d, staged: fn(d.staged) })));
        };
        preparePhoto(file).then(
          (photo) => {
            URL.revokeObjectURL(previewUrl);
            updatePhoto((s) => s.map((p) => (p.key === key ? { ...p, photo, previewUrl: photo.previewUrl } : p)));
          },
          (err: unknown) => {
            // Drop the photo and say why, rather than leaving a dead thumbnail.
            URL.revokeObjectURL(previewUrl);
            updatePhoto((s) => s.filter((p) => p.key !== key));
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
  const stream = async (live: InFlight, key: string, body: string): Promise<Outcome> => {
    // Nothing at all for too long on a visible page (allowing for uploading the
    // photos): stop waiting on this connection and collect the answer instead.
    const watchdog = setInterval(() => {
      if (live.stopped || live.recovering || document.visibilityState !== "visible") return;
      const state = { connected: live.connectedAt !== undefined, lastEventAt: live.lastEvent, bodyBytes: live.bodyBytes };
      if (connectionAbandoned({ ...state, now: Date.now() })) live.controller.abort();
    }, WATCHDOG_MS);
    try {
      return await streamOnce(live, key, body);
    } finally {
      clearInterval(watchdog);
    }
  };

  const streamOnce = async (live: InFlight, key: string, body: string): Promise<Outcome> => {
    let response: Response;
    try {
      response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: live.controller.signal,
      });
    } catch {
      return live.stopped ? "stopped" : "lost";
    }
    if (!response.ok) {
      // The server never started an answer, so there's nothing to stop.
      live.settled = true;
      if (response.status === 413) return "too-large";
      const reply = await response.json().catch(() => ({}));
      update(key, (t) => ({ ...t, error: reply.error ?? "Something went wrong on our side. Try again." }));
      return "failed";
    }
    live.connectedAt = live.lastEvent = Date.now();
    try {
      for await (const event of readNdjson<StreamEvent>(response.body!)) {
        if (live.stopped) return "stopped";
        live.lastEvent = Date.now();
        apply(key, event);
        if (event.type === "done") return "answered";
        if (event.type === "error") {
          live.settled = true;
          return event.message === "Stopped." ? "stopped" : "failed";
        }
      }
    } catch {
      if (live.stopped) return "stopped";
    }
    return "lost";
  };

  /** Reads the saved answer once, with its own timeout so a dead connection can't hold up the next read. */
  const readSaved = async (live: InFlight): Promise<SavedRead> => {
    const check = new AbortController();
    const timer = setTimeout(() => check.abort(), CHECK_TIMEOUT_MS);
    const onStop = () => check.abort();
    live.controller.signal.addEventListener("abort", onStop, { once: true });
    try {
      const res = await fetch(`/api/ask/${live.id}`, { cache: "no-store", signal: check.signal });
      if (res.status === 404) return { status: "missing" };
      if (!res.ok) return { status: "unreachable" };
      return { status: "found", saved: (await res.json()) as AnswerSnapshot };
    } catch {
      return { status: "unreachable" };
    } finally {
      clearTimeout(timer);
      live.controller.signal.removeEventListener("abort", onStop);
    }
  };

  /** Collects an answer the server kept writing while the page was away. */
  const recover = async (live: InFlight, key: string): Promise<Outcome> => {
    update(key, (t) => ({ ...t, progress: "reconnecting" }));
    live.recovering = true;
    live.controller = new AbortController();
    const result = await recoverAnswer({
      connectedAt: live.connectedAt,
      read: () => readSaved(live),
      visible: () => document.visibilityState === "visible",
      wait: (ms) => wait(ms, live.controller.signal),
      now: () => Date.now(),
      stopped: () => live.stopped,
      // The saved copy can trail what already arrived live; keep whichever is further along.
      onProgress: (saved) =>
        update(key, (t) => ({
          ...t,
          text: saved.text.length > t.text.length ? saved.text : t.text,
          sources: saved.sources.length > (t.sources?.length ?? 0) ? saved.sources : t.sources,
          progress: saved.phase ?? t.progress,
        })),
    });
    if (result.outcome !== "failed") return result.outcome;
    // What was written so far stays; the reason goes below it.
    if (result.reason === "server") {
      live.settled = true;
      update(key, (t) => ({ ...t, error: result.error }));
    } else {
      const message =
        result.reason === "stale" ? `${companion.name} stopped responding before the answer finished. Try again.` : LOST_MESSAGE;
      update(key, (t) => ({ ...t, error: message }));
    }
    return "failed";
  };

  /** Asks the server to stop an answer, in case it is still being written for no one. */
  const stopOnServer = (id: string) => void fetch(`/api/ask/${id}`, { method: "DELETE", keepalive: true }).catch(() => {});

  // What's in the text box now, for putting a question back without overwriting new work.
  const draft = useRef({ text, staged });
  draft.current = { text, staged };

  /**
   * Hands back a question that can't be sent as is (its photos are too large) to
   * edit, rather than offering a Retry that would send the same photos again. It
   * leaves the conversation, so it isn't sent again as history. It goes into the
   * text box if that's empty; otherwise whatever the person has started stays
   * there and this question is saved below it, whole, to switch back in.
   */
  const putBack = (answerKey: string, question: string, photos: PreparedPhoto[]) => {
    setThread((all) => {
      const i = all.findIndex((t) => t.key === answerKey);
      return i < 1 ? all : [...all.slice(0, i - 1), ...all.slice(i + 1)];
    });
    const staging = photos.map((photo) => ({ key: nextKey(), previewUrl: photo.previewUrl, photo }));
    if (draft.current.text.trim() || draft.current.staged.length) {
      setSaved((all) => [...all, { key: nextKey(), text: question, staged: staging, tooLarge: true }]);
      setNotice(TOO_LARGE_SAVED_MESSAGE);
    } else {
      setText(question);
      setStaged(staging);
      setNotice(TOO_LARGE_MESSAGE);
    }
  };

  /** Puts a saved question in the text box, saving whatever was there in its place. */
  const switchTo = (key: string) => {
    const target = saved.find((d) => d.key === key);
    if (!target) return;
    const current: SavedDraft = { key: nextKey(), text, staged, tooLarge: false };
    const keep = text.trim() || staged.length;
    setSaved((all) => [...all.filter((d) => d.key !== key), ...(keep ? [current] : [])]);
    setText(target.text);
    setStaged(target.staged);
    setNotice(null);
    inputRef.current?.focus();
  };

  const discard = (key: string) => setSaved((all) => all.filter((d) => d.key !== key));

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
    // Too large to send as is: hand it back for editing.
    if (!send(question.text, question.photos ?? [], [...thread.slice(0, i - 1), ...thread.slice(i + 1)])) {
      putBack(answerKey, question.text, question.photos ?? []);
    }
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
    const id = crypto.randomUUID();
    const body = JSON.stringify({ id, turns });
    const live: InFlight = {
      id,
      controller: new AbortController(),
      stopped: false,
      recovering: false,
      bodyBytes: body.length,
      lastEvent: sentAt,
      settled: false,
    };
    inFlight.current = live;
    void run(live, answer.key, body, question, photos);
    return true;
  };

  const run = async (live: InFlight, key: string, body: string, question: string, photos: PreparedPhoto[]) => {
    let outcome: Outcome;
    try {
      outcome = await stream(live, key, body);
      if (outcome === "lost") outcome = await recover(live, key);
    } catch (err) {
      update(key, (t) => ({ ...t, error: err instanceof Error ? err.message : "Something went wrong." }));
      outcome = "failed";
    }

    // After New, a fresh question may already be in flight; leave its state alone.
    const current = inFlight.current === live;
    if (outcome === "stopped") update(key, (t) => ({ ...t, error: t.error ?? "Stopped." }));
    // The page gave up waiting; make sure the server isn't still writing it, so a
    // Retry doesn't leave two answers running. An answer the server ended itself
    // has nothing left to stop.
    if (outcome === "failed" && !live.stopped && !live.settled) stopOnServer(live.id);
    update(key, (t) => ({ ...t, pending: false, progress: undefined }));
    // Sending the same photos again would fail the same way: hand them back to edit.
    if (outcome === "too-large" && current) putBack(key, question, photos);
    if (current) {
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
    setSaved([]);
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

  // Questions set aside, each whole, to switch back into the text box.
  const savedList = saved.length ? (
    <ul aria-label="Saved questions" className="mt-3 space-y-2">
      {saved.map((d) => (
        <li key={d.key} className="flex items-center gap-3 rounded-2xl bg-sunk px-4 py-2 text-sm text-ink">
          <span className="min-w-0 flex-1 truncate">
            <span className="text-ink-muted">{d.tooLarge ? "Too large to send: " : "Saved draft: "}</span>
            {d.text.trim() || "Photos only"}
            {d.staged.length ? ` · ${d.staged.length} photo${d.staged.length === 1 ? "" : "s"}` : ""}
          </span>
          <button type="button" onClick={() => switchTo(d.key)} className="shrink-0 font-medium underline underline-offset-4">
            Switch
          </button>
          <button
            type="button"
            onClick={() => discard(d.key)}
            aria-label="Discard saved question"
            className="grid size-6 shrink-0 place-items-center rounded-full text-ink-muted hover:text-ink"
          >
            <XIcon className="size-3.5" />
          </button>
        </li>
      ))}
    </ul>
  ) : null;

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
            {savedList}
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
        {savedList}
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
