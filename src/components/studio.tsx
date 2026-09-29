"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUpIcon, CameraIcon, SquareIcon, XIcon } from "lucide-react";
import type { WebSourceRef } from "@/lib/ai/types";
import type { AskEvent } from "@/lib/gio/ask";
import { fitToBudget } from "@/lib/gio/budget";
import { readNdjson } from "@/lib/gio/ndjson";
import { PHOTO_ACCEPT, preparePhoto, type PreparedPhoto } from "@/lib/gio/photos";
import { MAX_PHOTOS_PER_TURN, type AskTurn } from "@/lib/gio/prompt";
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
  searching?: boolean;
  sources?: WebSourceRef[];
  error?: string;
}

let counter = 0;
const nextKey = () => `k${++counter}`;

export function Studio() {
  const [thread, setThread] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [staged, setStaged] = useState<StagedPhoto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

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
          (err: unknown) =>
            setStaged((s) =>
              s.map((p) => (p.key === key ? { ...p, error: err instanceof Error ? err.message : "Couldn't read that photo." } : p)),
            ),
        );
      }
    },
    [staged.length],
  );

  const removeStaged = (key: string) => setStaged((s) => s.filter((p) => p.key !== key));

  const update = (key: string, fn: (t: Turn) => Turn) => setThread((all) => all.map((t) => (t.key === key ? fn(t) : t)));

  const ask = async () => {
    if (!canSend) return;
    const question = text.trim();
    const photos = ready.map((p) => p.photo!);
    const userTurn: Turn = { key: nextKey(), role: "user", text: question, photos };
    const answer: Turn = { key: nextKey(), role: "assistant", text: "", pending: true };

    // Earlier photos go along small; this question's photos go at full size.
    let turns: AskTurn[];
    try {
      turns = fitToBudget([
        ...thread
          .filter((t) => !t.error && (t.role === "user" || t.text.trim()))
          .map((t) => ({ role: t.role, text: t.text, images: t.photos?.map((p) => p.small) })),
        { role: "user", text: question, images: photos.map((p) => p.full) },
      ]);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Those photos are too large to send together.");
      return;
    }

    setThread((all) => [...all, userTurn, answer]);
    setText("");
    setStaged((s) => s.filter((p) => !p.photo));
    setNotice(null);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error ??
            (response.status === 413 ? "Those photos are too large to send together. Try fewer." : `Request failed (${response.status})`),
        );
      }
      for await (const event of readNdjson<AskEvent>(response.body)) {
        if (event.type === "text") update(answer.key, (t) => ({ ...t, text: t.text + event.text, searching: false }));
        else if (event.type === "searching") update(answer.key, (t) => ({ ...t, searching: true }));
        else if (event.type === "sources")
          update(answer.key, (t) => ({ ...t, sources: [...(t.sources ?? []), ...event.sources] }));
        else if (event.type === "error") update(answer.key, (t) => ({ ...t, error: event.message }));
      }
    } catch (err) {
      const stopped = err instanceof DOMException && err.name === "AbortError";
      update(answer.key, (t) => ({ ...t, error: stopped ? "Stopped." : err instanceof Error ? err.message : "Something went wrong." }));
    } finally {
      update(answer.key, (t) => ({ ...t, pending: false, searching: false }));
      setBusy(false);
      abortRef.current = null;
    }
  };

  const startOver = () => {
    abortRef.current?.abort();
    setThread([]);
    setText("");
    setStaged([]);
    setNotice(null);
    inputRef.current?.focus();
  };

  // Follow the answer as it streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
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
      className="w-full rounded-[26px] border border-line bg-surface p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors focus-within:border-line-strong"
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
          rows={1}
          placeholder={staged.length ? "Add a question, or just send" : "Ask a question"}
          aria-label="Ask Gio"
          className="min-h-10 flex-1 resize-none bg-transparent py-2 text-base leading-6 text-ink outline-none placeholder:text-ink-muted focus-visible:outline-none"
        />
        {busy ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
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
      <main className="flex min-h-dvh flex-col items-center justify-center px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-8">
        <div className="w-full max-w-[640px]">
          <p className="text-center text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">Gio</p>
          <h1 className="mt-6 text-center font-serif text-[clamp(40px,10vw,64px)] font-normal leading-[1.02] tracking-[-0.025em] text-ink [text-wrap:balance]">
            See with a designer&rsquo;s eye.
          </h1>
          <p className="mt-5 text-center text-lg text-ink-muted">Upload a picture or ask a question.</p>
          <div className="mt-10">{composer}</div>
          {hint}
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-[640px] shrink-0 items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <p className="text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">Gio</p>
        <button type="button" onClick={startOver} className="text-sm text-ink-muted transition-colors hover:text-ink">
          New
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8 px-4 py-6">
          {thread.map((t) => (t.role === "user" ? <Question key={t.key} turn={t} /> : <Answer key={t.key} turn={t} />))}
          <div ref={endRef} />
        </div>
      </main>

      <div className="mx-auto w-full max-w-[640px] shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
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
        <p className="max-w-[85%] whitespace-pre-wrap rounded-[20px] rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-relaxed text-ground [overflow-wrap:anywhere]">
          {turn.text}
        </p>
      ) : null}
    </div>
  );
}

function Answer({ turn }: { turn: Turn }) {
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
      {turn.pending && (!turn.text || turn.searching) ? (
        <p className={cn("text-[15px] text-ink-muted", turn.text && "mt-4")}>
          <span className="gio-dots">{turn.searching ? "Checking real listings" : "Looking"}</span>
        </p>
      ) : null}
      {turn.error ? <p className="mt-2 text-[15px] text-warn">{turn.error}</p> : null}
      {!turn.pending && turn.sources?.length ? <Sources sources={turn.sources} /> : null}
    </div>
  );
}

function Sources({ sources }: { sources: WebSourceRef[] }) {
  const unique = [...new Map(sources.map((s) => [s.url, s])).values()].slice(0, 12);
  return (
    <details className="mt-4 text-sm text-ink-muted">
      <summary className="cursor-pointer select-none hover:text-ink">Sources</summary>
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
