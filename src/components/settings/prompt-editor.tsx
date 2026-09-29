"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDownIcon, RotateCcwIcon } from "lucide-react";
import { resetSystemPrompt, restorePromptVersion, saveSystemPrompt } from "@/app/settings-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { diffSummary } from "@/lib/gio/prompt-versions";
import { cn } from "@/lib/utils";
import type { SettingsData } from "./settings-view";

const LABELS: Record<string, string> = {
  original: "Original",
  edited: "Edited",
  restored: "Restored",
  reset: "Reset to default",
  imported: "Imported",
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PromptEditor({ prompt, defaultPrompt, versions }: { prompt: string; defaultPrompt: string; versions: SettingsData["versions"] }) {
  const router = useRouter();
  const [text, setText] = useState(prompt);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"save" | "restore" | "reset" | null>(null);
  const dirty = text !== prompt;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, success: string, kind: "save" | "restore" | "reset") =>
    start(async () => {
      setAction(kind);
      const res = await fn();
      setMessage(res.ok ? { tone: "ok", text: success } : { tone: "bad", text: res.error ?? "Something went wrong" });
      if (res.ok) router.refresh();
    });

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <section>
        <h2 className="font-serif text-xl text-ink">Gio&rsquo;s system prompt</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-muted">
          Gio reads this first on every turn, before the project, memories and references. Every save is kept below, so any
          earlier version can be restored.
        </p>
        <textarea
          aria-label="System prompt"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck
          className="mt-4 h-[60vh] min-h-80 w-full resize-y rounded-md border border-line-strong bg-surface p-4 font-serif text-[15px] leading-relaxed text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional)" className="h-9 max-w-xs" />
          <Button
            disabled={!dirty || pending}
            onClick={() =>
              run(async () => {
                const res = await saveSystemPrompt(text, note);
                if (res.ok) setNote("");
                return res;
              }, "Saved. Gio uses the new prompt from the next message.", "save")
            }
          >
            {pending && action === "save" ? "Saving…" : "Save prompt"}
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setText(prompt)} disabled={pending}>
              Discard changes
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="ml-auto text-ink-muted"
            disabled={pending || prompt === defaultPrompt}
            onClick={() => {
              if (!confirm("Replace the current prompt with the original Gio prompt? The current one stays in the history.")) return;
              run(async () => {
                const res = await resetSystemPrompt();
                if (res.ok) setText(defaultPrompt);
                return res;
              }, "Reset to the original Gio prompt.", "reset");
            }}
          >
            <RotateCcwIcon /> Reset to default
          </Button>
        </div>
        {message ? <p className={cn("mt-3 text-sm", message.tone === "ok" ? "text-ok" : "text-warn")}>{message.text}</p> : null}
      </section>

      <aside>
        <h3 className="font-serif text-lg text-ink">History</h3>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No changes yet. The first save keeps a copy of the original.</p>
        ) : (
          <ol className="mt-3 space-y-2">
            {versions.map((v) => {
              const current = v.content === prompt;
              const diff = diffSummary(prompt, v.content);
              return (
                <li key={v.id} className="rounded-md border border-line bg-surface">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 p-3 text-left"
                    onClick={() => setOpen(open === v.id ? null : v.id)}
                    aria-expanded={open === v.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-ink">
                        {LABELS[v.label] ?? v.label}
                        {current ? <span className="ml-1.5 rounded-sm bg-ok-soft px-1 text-[10px] uppercase tracking-wider text-ok">Live</span> : null}
                      </span>
                      <span className="block text-xs text-ink-muted">{when(v.created_at)}</span>
                      {v.note ? <span className="mt-0.5 block text-xs text-ink-soft">{v.note}</span> : null}
                      {!current ? (
                        <span className="mt-0.5 block text-[11px] text-ink-muted">
                          vs. live: +{diff.added} / −{diff.removed} lines
                        </span>
                      ) : null}
                    </span>
                    <ChevronDownIcon className={cn("mt-1 size-4 shrink-0 text-ink-muted transition-transform", open === v.id && "rotate-180")} />
                  </button>
                  {open === v.id ? (
                    <div className="border-t border-line p-3">
                      <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-serif text-xs leading-relaxed text-ink-soft">{v.content}</pre>
                      <div className="mt-2 flex gap-2">
                        <Button
                          size="sm"
                          disabled={current || pending}
                          onClick={() =>
                            run(async () => {
                              const res = await restorePromptVersion(v.id);
                              if (res.ok) setText(v.content);
                              return res;
                            }, "Restored. Gio uses it from the next message.", "restore")
                          }
                        >
                          Restore this version
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setText(v.content)} disabled={pending}>
                          Load into editor
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </aside>
    </div>
  );
}
