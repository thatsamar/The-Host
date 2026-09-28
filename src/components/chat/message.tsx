"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpenIcon, GlobeIcon } from "lucide-react";
import type { MessageReference, WebSource } from "@/lib/db/types";
import type { Speaker } from "@/lib/gio/speakers";
import { cn } from "@/lib/utils";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  speaker: Speaker;
  content: string;
  /** Displayable URLs for attached photos. */
  images?: string[];
  references?: MessageReference[];
  webSearches?: string[];
  webSources?: WebSource[];
  pending?: boolean;
  error?: string;
}

const SPEAKER_STYLES: Record<string, string> = {
  Courtney: "text-oxblood",
  Amar: "text-olive",
  Both: "text-tobacco",
};

export function Message({ message }: { message: DisplayMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col items-end">
        <span className={cn("mb-1 text-[11px] font-medium uppercase tracking-[0.14em]", SPEAKER_STYLES[message.speaker])}>
          {message.speaker}
        </span>
        {message.images?.length ? (
          <div className="mb-2 flex max-w-[85%] flex-wrap justify-end gap-2">
            {message.images.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- private signed URLs */}
                <img src={url} alt="Attached photo" className="h-40 max-w-[16rem] rounded-lg border border-stone object-cover" />
              </a>
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-sm bg-paper-sunk px-4 py-2.5 text-[15px] leading-relaxed text-ink">
            {message.content}
          </div>
        ) : null}
      </div>
    );
  }

  const searching = message.pending && message.webSearches?.length;
  return (
    <div>
      <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Gio</span>
      {message.webSearches?.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {message.webSearches.map((q, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-stone px-2 py-0.5 text-[11px] text-ink-muted">
              <GlobeIcon className="size-3" />
              {q || "Searching"}
            </span>
          ))}
        </div>
      ) : null}
      {message.content ? (
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
            {message.content}
          </ReactMarkdown>
        </div>
      ) : message.pending ? (
        <p className="font-serif text-lg italic text-ink-muted">
          {searching ? "Looking at real listings…" : "Thinking it through…"}
        </p>
      ) : null}
      {message.error ? <p className="mt-2 text-sm text-oxblood">{message.error}</p> : null}
      {!message.pending && message.references?.length ? <References references={message.references} /> : null}
      {!message.pending && message.webSources?.length ? <Sources sources={message.webSources} /> : null}
    </div>
  );
}

function References({ references }: { references: MessageReference[] }) {
  // One line per file, listing the pages that were drawn on.
  const byFile = new Map<string, { pages: Set<number>; images: boolean }>();
  for (const r of references) {
    const entry = byFile.get(r.file_name) ?? { pages: new Set<number>(), images: false };
    if (r.page) entry.pages.add(r.page);
    entry.images ||= r.source_type === "visual_description";
    byFile.set(r.file_name, entry);
  }
  return (
    <details className="mt-4 text-sm text-ink-muted">
      <summary className="cursor-pointer select-none text-xs uppercase tracking-[0.12em] hover:text-ink">
        <BookOpenIcon className="mr-1 inline size-3 align-[-1px]" />
        From your library · {byFile.size}
      </summary>
      <ul className="mt-2 space-y-1">
        {[...byFile.entries()].map(([name, { pages, images }]) => (
          <li key={name} className="truncate">
            {name}
            {pages.size ? <span className="text-ink-muted"> · p. {[...pages].sort((a, b) => a - b).join(", ")}</span> : null}
            {images ? <span className="text-ink-muted"> · image</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Sources({ sources }: { sources: WebSource[] }) {
  return (
    <details className="mt-4 text-sm text-ink-muted">
      <summary className="cursor-pointer select-none text-xs uppercase tracking-[0.12em] hover:text-ink">
        Sources · {sources.length}
      </summary>
      <ul className="mt-2 space-y-1">
        {sources.slice(0, 20).map((s) => (
          <li key={s.url} className="truncate">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-oxblood hover:underline">
              {s.title || s.url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
