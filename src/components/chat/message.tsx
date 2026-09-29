"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookmarkPlusIcon,
  BookOpenIcon,
  GlobeIcon,
  ListChecksIcon,
  MoreHorizontalIcon,
  NotebookPenIcon,
  RotateCcwIcon,
  ScaleIcon,
  ShoppingBagIcon,
} from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MODE_LABELS, type ChatMode } from "@/lib/gio/modes";
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
  mode?: ChatMode | null;
  /** Proposals created from this exchange (live only). */
  proposals?: { memories: number; decisions: number };
}

export type MessageCommand = "decision" | "memory" | "keep_looking" | "compare" | "shopping_brief";

const SPEAKER_STYLES: Record<string, string> = {
  Courtney: "text-accent",
  Amar: "text-ok",
  Both: "text-ink-muted",
};

export function Message({
  message,
  onCommand,
  highlighted,
}: {
  message: DisplayMessage;
  onCommand?: (command: MessageCommand, message: DisplayMessage) => void;
  highlighted?: boolean;
}) {
  const frame = cn("scroll-mt-6 rounded-lg transition-colors duration-700", highlighted && "bg-accent-soft/50 ring-8 ring-accent-soft/50");
  if (message.role === "user") {
    return (
      <div id={`msg-${message.id}`} className={cn("flex flex-col items-end", frame)}>
        <span className="mb-1 flex items-center gap-2">
          {message.mode ? (
            <span className="rounded-full border border-line px-2 py-px text-[10px] uppercase tracking-[0.1em] text-ink-muted">
              {MODE_LABELS[message.mode]}
            </span>
          ) : null}
          <span className={cn("text-[11px] font-medium uppercase tracking-[0.14em]", SPEAKER_STYLES[message.speaker])}>
            {message.speaker}
          </span>
        </span>
        {message.images?.length ? (
          <div className="mb-2 flex max-w-[85%] flex-wrap justify-end gap-2">
            {message.images.map((url) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element -- private signed URLs */}
                <img src={url} alt="Attached photo" className="h-40 max-w-[16rem] rounded-md object-cover" />
              </a>
            ))}
          </div>
        ) : null}
        {message.content ? (
          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-[4px] bg-ink px-3.5 py-2 text-[15px] leading-relaxed text-ground [overflow-wrap:anywhere]">
            {message.content}
          </div>
        ) : null}
      </div>
    );
  }

  const searching = message.pending && message.webSearches?.length;
  const canCommand = onCommand && !message.pending && message.content.trim() && !message.id.startsWith("local-");
  return (
    <div id={`msg-${message.id}`} className={frame}>
      <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Gio</span>
      {message.webSearches?.length ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {message.webSearches.map((q, i) => (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-muted">
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
        <p className="text-[15px] text-ink-muted">
          <span className="gio-dots">{searching ? "Looking at real listings" : "Thinking"}</span>
        </p>
      ) : null}
      {message.error ? <p className="mt-2 text-sm text-warn">{message.error}</p> : null}
      {!message.pending && message.references?.length ? <References references={message.references} /> : null}
      {!message.pending && message.webSources?.length ? <Sources sources={message.webSources} /> : null}
      {message.proposals && message.proposals.memories + message.proposals.decisions > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-accent">
          <NotebookPenIcon className="size-3.5" />
          {describeProposals(message.proposals)} for the notebook
        </p>
      ) : null}
      {canCommand ? <MessageCommands onCommand={(c) => onCommand(c, message)} /> : null}
    </div>
  );
}

function describeProposals(p: { memories: number; decisions: number }): string {
  const parts = [];
  if (p.memories) parts.push(`${p.memories} ${p.memories === 1 ? "memory" : "memories"}`);
  if (p.decisions) parts.push(`${p.decisions} ${p.decisions === 1 ? "decision" : "decisions"}`);
  return `${parts.join(" and ")} proposed`;
}

const commandButton =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-sunk hover:text-ink [&_svg]:size-3.5";

function MessageCommands({ onCommand }: { onCommand: (c: MessageCommand) => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-0.5 border-t border-line/70 pt-2">
      <button type="button" className={commandButton} onClick={() => onCommand("decision")}>
        <ListChecksIcon /> Save as decision
      </button>
      <button type="button" className={commandButton} onClick={() => onCommand("memory")}>
        <BookmarkPlusIcon /> Add to memory
      </button>
      <button type="button" className={commandButton} onClick={() => onCommand("keep_looking")}>
        <RotateCcwIcon /> Keep looking
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger className={commandButton} aria-label="More commands">
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[12rem]">
          <DropdownMenuItem onSelect={() => onCommand("compare")}>
            <ScaleIcon /> Compare options
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onCommand("shopping_brief")}>
            <ShoppingBagIcon /> Create shopping brief
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:text-accent hover:underline">
              {s.title || s.url}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
