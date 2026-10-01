"use client";

import { useState } from "react";
import type { AnswerNotes } from "@/lib/ask/notes";
import { isSaved, keepPattern, saveDraft, saveLine, type EntryType, type Journal } from "@/lib/journal/store";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import type { Turn } from "./studio";

export interface NotesContext {
  /** Null when the companion keeps no journal: nothing to save to. */
  journal: Journal | null;
  change: (fn: (j: Journal) => Journal) => void;
  busy: boolean;
  onTone: (turn: Turn, tone: string) => void;
}

export const LINE_LABELS: Record<EntryType, string> = {
  thing_under_the_thing: "The thing under the thing",
  one_sentence: "The one sentence",
  next_move: "The next move",
};

const TONES = ["Softer", "Sharper", "Shorter", "Warmer", "More formal"];

/** The cards under an answer: the lines worth keeping, a draft, a pattern. */
export function Notes({ notes, turn, context }: { notes: AnswerNotes; turn: Turn; context: NotesContext }) {
  const { journal, change } = context;
  const lines = (Object.keys(LINE_LABELS) as EntryType[]).flatMap((type) => {
    const content = notes[type];
    return content ? [{ type, content }] : [];
  });

  return (
    <div className="mt-6 space-y-3">
      {lines.map(({ type, content }) => (
        <section key={type} className="rounded-[var(--radius)] border border-line bg-surface px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-4">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{LINE_LABELS[type]}</h3>
            {journal ? (
              <SaveButton
                saved={isSaved(journal, type, content)}
                onSave={() => change((j) => saveLine(j, type, content, turn.mode))}
              />
            ) : null}
          </div>
          <p className={cn("mt-1.5 font-serif text-[17px] leading-snug text-ink", type === "one_sentence" && "italic")}>{content}</p>
        </section>
      ))}
      {notes.draft_message ? <DraftCard draft={notes.draft_message} turn={turn} context={context} /> : null}
      {journal && journal.settings.memory_enabled && notes.suggested_memory_pattern && notes.safety_flag !== "high" ? (
        <PatternSuggestion pattern={notes.suggested_memory_pattern} journal={journal} change={change} />
      ) : null}
    </div>
  );
}

function SaveButton({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saved}
      className="shrink-0 text-sm text-ink-muted transition-colors hover:text-ink disabled:text-accent"
    >
      {saved ? "Saved" : "Save"}
    </button>
  );
}

function DraftCard({ draft, turn, context }: { draft: string; turn: Turn; context: NotesContext }) {
  const { journal, change, busy, onTone } = context;
  const saved = journal?.drafts.some((d) => d.draft_content.trim() === draft.trim()) ?? false;
  return (
    <section className="rounded-[var(--radius)] border border-line-strong bg-surface px-4 py-3.5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Send this</h3>
      <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">{draft}</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted">
        <CopyButton text={draft} />
        {journal ? (
          <SaveButton
            saved={saved}
            onSave={() =>
              change((j) =>
                saveDraft(j, { original_context: turn.context ?? "", draft_content: draft, tone: turn.tone ?? "Original" }),
              )
            }
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
        {TONES.map((tone) => (
          <button
            key={tone}
            type="button"
            disabled={busy}
            onClick={() => onTone(turn, tone)}
            className="rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            {tone}
          </button>
        ))}
      </div>
    </section>
  );
}

function PatternSuggestion({
  pattern,
  journal,
  change,
}: {
  pattern: string;
  journal: Journal;
  change: NotesContext["change"];
}) {
  const [dismissed, setDismissed] = useState(false);
  const kept = journal.patterns.some((p) => p.pattern.trim().toLowerCase() === pattern.trim().toLowerCase());
  if (dismissed && !kept) return null;
  return (
    <section className="rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-3.5">
      <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">A pattern</h3>
      <p className="mt-1.5 font-serif text-[17px] leading-snug text-ink">{pattern}</p>
      {kept ? (
        <p className="mt-2 text-sm text-accent">Remembered. Edit or delete it in Patterns.</p>
      ) : (
        <div className="mt-2 flex gap-5 text-sm text-ink-muted">
          <button type="button" onClick={() => change((j) => keepPattern(j, pattern))} className="transition-colors hover:text-ink">
            Remember this
          </button>
          <button type="button" onClick={() => setDismissed(true)} className="transition-colors hover:text-ink">
            Not true
          </button>
        </div>
      )}
    </section>
  );
}
