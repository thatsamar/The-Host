"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GlobeIcon } from "lucide-react";
import type { WebSource } from "@/lib/db/types";
import type { Speaker } from "@/lib/gio/speakers";
import { cn } from "@/lib/utils";

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  speaker: Speaker;
  content: string;
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
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-tr-sm bg-paper-sunk px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          {message.content}
        </div>
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
      {!message.pending && message.webSources?.length ? <Sources sources={message.webSources} /> : null}
    </div>
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
