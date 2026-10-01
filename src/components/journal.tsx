"use client";

import { useState } from "react";
import Link from "next/link";
import type { CompanionCopy } from "@/lib/companions/types";
import { editPattern, removeFrom, setMemory, type Journal } from "@/lib/journal/store";
import { useJournal } from "@/lib/journal/use-journal";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";
import { LINE_LABELS } from "./notes";
import { JOURNAL_PAGES } from "./studio";

export type JournalPage = "matchbook" | "patterns" | "drafts" | "settings";

/** The pages behind the conversation: what the visitor kept, in this browser. */
export function JournalView({ companion, page }: { companion: CompanionCopy; page: JournalPage }) {
  const { journal, change, clear } = useJournal(companion.id);
  return (
    <div className="min-h-dvh">
      <header className="mx-auto w-full max-w-[640px] px-4 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-[22px] font-bold leading-none tracking-[-0.04em] text-ink">
            {companion.name}
          </Link>
          <Link href="/" className="text-sm text-ink-muted transition-colors hover:text-ink">
            Back
          </Link>
        </div>
        <nav className="mt-6 flex gap-x-5 overflow-x-auto border-b border-line text-sm [scrollbar-width:none]">
          {JOURNAL_PAGES.map((p) => (
            <Link
              key={p.href}
              href={p.href}
              aria-current={p.href === `/${page}` ? "page" : undefined}
              className={cn(
                "-mb-px shrink-0 border-b py-2 transition-colors",
                p.href === `/${page}` ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink",
              )}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-[640px] px-4 pb-[max(3rem,env(safe-area-inset-bottom))] pt-6">
        {page === "matchbook" ? <Matchbook journal={journal} change={change} /> : null}
        {page === "patterns" ? <Patterns companion={companion} journal={journal} change={change} /> : null}
        {page === "drafts" ? <Drafts journal={journal} change={change} /> : null}
        {page === "settings" ? <Settings companion={companion} journal={journal} change={change} clear={clear} /> : null}
      </main>
    </div>
  );
}

type Change = (fn: (j: Journal) => Journal) => void;

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

function Intro({ children }: { children: React.ReactNode }) {
  return <p className="mb-6 text-[15px] leading-relaxed text-ink-muted">{children}</p>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-16 text-center font-serif text-lg italic text-ink-muted">{children}</p>;
}

function Matchbook({ journal, change }: { journal: Journal; change: Change }) {
  return (
    <>
      <Intro>Lines worth keeping, scribbled on the back of a matchbook. Kept in this browser only.</Intro>
      {journal.matchbook.length ? (
        <ul className="space-y-3">
          {journal.matchbook.map((e) => (
            <li key={e.id} className="rounded-[var(--radius)] border border-line bg-surface px-4 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">{LINE_LABELS[e.type] ?? ""}</p>
              <p className={cn("mt-1.5 font-serif text-lg leading-snug text-ink", e.type === "one_sentence" && "italic")}>{e.content}</p>
              <div className="mt-3 flex gap-5 text-sm text-ink-muted">
                <span>{when(e.created_at)}</span>
                <CopyButton text={e.content} />
                <button
                  type="button"
                  onClick={() => change((j) => removeFrom(j, "matchbook", e.id))}
                  className="transition-colors hover:text-warn"
                >
                  Burn
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing saved yet. When a line lands, save it.</Empty>
      )}
    </>
  );
}

function Patterns({ companion, journal, change }: { companion: CompanionCopy; journal: Journal; change: Change }) {
  return (
    <>
      <Intro>
        What {companion.name} remembers about you: only the patterns you chose to keep. While memory is on, they go along with
        your questions. Change any of them, or delete them.
        {journal.settings.memory_enabled ? null : " Memory is off, so none of them are sent right now."}
      </Intro>
      {journal.patterns.length ? (
        <ul className="space-y-3">
          {journal.patterns.map((p) => (
            <PatternRow key={p.id} id={p.id} pattern={p.pattern} change={change} />
          ))}
        </ul>
      ) : (
        <Empty>Nothing remembered. When {companion.name} spots a pattern, you decide whether it stays.</Empty>
      )}
    </>
  );
}

function PatternRow({ id, pattern, change }: { id: string; pattern: string; change: Change }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(pattern);
  return (
    <li className="rounded-[var(--radius)] border border-line bg-surface px-4 py-4">
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            change((j) => editPattern(j, id, draft));
            setEditing(false);
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={300}
            rows={3}
            aria-label="Pattern"
            autoFocus
            className="w-full resize-none rounded-md border border-line-strong bg-ground p-2 font-serif text-lg leading-snug text-ink outline-none focus:border-accent"
          />
          <div className="mt-2 flex gap-5 text-sm text-ink-muted">
            <button type="submit" className="text-ink transition-colors hover:text-accent">
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(pattern);
                setEditing(false);
              }}
              className="transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p className="font-serif text-lg leading-snug text-ink">{pattern}</p>
          <div className="mt-3 flex gap-5 text-sm text-ink-muted">
            <button
              type="button"
              onClick={() => {
                setDraft(pattern);
                setEditing(true);
              }}
              className="transition-colors hover:text-ink"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => change((j) => removeFrom(j, "patterns", id))}
              className="transition-colors hover:text-warn"
            >
              Forget
            </button>
          </div>
        </>
      )}
    </li>
  );
}

function Drafts({ journal, change }: { journal: Journal; change: Change }) {
  return (
    <>
      <Intro>Messages you saved from Write It for Me. Kept in this browser only.</Intro>
      {journal.drafts.length ? (
        <ul className="space-y-3">
          {journal.drafts.map((d) => (
            <li key={d.id} className="rounded-[var(--radius)] border border-line bg-surface px-4 py-4">
              {d.original_context ? (
                <p className="line-clamp-2 text-sm text-ink-muted">{d.original_context}</p>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink [overflow-wrap:anywhere]">
                {d.draft_content}
              </p>
              <div className="mt-3 flex gap-5 text-sm text-ink-muted">
                <span>
                  {when(d.created_at)}
                  {d.tone && d.tone !== "Original" ? ` · ${d.tone}` : ""}
                </span>
                <CopyButton text={d.draft_content} />
                <button
                  type="button"
                  onClick={() => change((j) => removeFrom(j, "drafts", d.id))}
                  className="transition-colors hover:text-warn"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>No drafts saved. Pick Write It for Me when there’s something you need to say.</Empty>
      )}
    </>
  );
}

function Settings({
  companion,
  journal,
  change,
  clear,
}: {
  companion: CompanionCopy;
  journal: Journal;
  change: Change;
  clear: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const memory = journal.settings.memory_enabled;

  const exportAll = () => {
    const blob = new Blob([JSON.stringify(journal, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${companion.id}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-8 text-[15px] leading-relaxed">
      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Memory</h2>
        <div className="mt-3 flex items-start justify-between gap-6">
          <p className="text-ink-soft">
            When it’s on, the patterns you keep go along with your questions, so {companion.name} can see them. When it’s off,
            nothing goes, and no new patterns are offered.
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={memory}
            aria-label="Memory"
            onClick={() => change((j) => setMemory(j, !memory))}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full border transition-colors",
              memory ? "border-accent bg-accent" : "border-line-strong bg-sunk",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-[22px] rounded-full transition-all",
                memory ? "left-[22px] bg-accent-ink" : "left-0.5 bg-ink-muted",
              )}
            />
          </button>
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Your things</h2>
        <p className="mt-3 text-ink-soft">
          {journal.matchbook.length} saved {journal.matchbook.length === 1 ? "line" : "lines"}, {journal.patterns.length}{" "}
          {journal.patterns.length === 1 ? "pattern" : "patterns"}, {journal.drafts.length}{" "}
          {journal.drafts.length === 1 ? "draft" : "drafts"}. All of it lives in this browser, on this device, and nowhere else.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={exportAll}
            className="rounded-full border border-line-strong px-4 py-2 text-sm text-ink transition-colors hover:border-ink-muted"
          >
            Export everything
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                onClick={() => {
                  clear();
                  setConfirming(false);
                }}
                className="rounded-full border border-warn bg-warn px-4 py-2 text-sm text-ground"
              >
                Yes, delete it all
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="px-2 py-2 text-sm text-ink-muted hover:text-ink">
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="rounded-full border border-line-strong px-4 py-2 text-sm text-warn transition-colors hover:border-warn"
            >
              Delete everything
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-muted">Privacy</h2>
        <div className="mt-3 space-y-3 text-ink-soft">
          <p>
            {companion.name} keeps no conversations. Each question, with the conversation so far and any patterns you keep, goes
            to Anthropic’s model to be answered, and the answer comes back. Nothing is stored on a server. Close the page and the
            conversation is gone.
          </p>
          <p>
            What you save stays in this browser. Clearing your browser data, or a private window, loses it; export it first if
            you want a copy.
          </p>
          <p>
            No accounts, no ads, no tracking, and nothing is sold. Anthropic doesn’t train its models on what apps send
            through its API.
          </p>
        </div>
      </section>
    </div>
  );
}
