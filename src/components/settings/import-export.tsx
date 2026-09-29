"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon, FileUpIcon, LoaderIcon } from "lucide-react";
import { embedMissingMemories, retryFailedExtraction } from "@/app/settings-actions";
import { notifyExtractionChanged, type ExtractionProgress } from "@/components/library/use-extraction-processor";
import { selectClass } from "@/components/notebook/forms";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectRow } from "@/lib/db/types";
import { HUMAN_SPEAKERS, type HumanSpeaker } from "@/lib/gio/speakers";
import {
  ChatGptFormatError,
  groupByGpt,
  importChatGptConversations,
  parseChatGptExport,
  type ChatGptConversation,
} from "@/lib/importers/chatgpt";
import { matchesQuery } from "@/lib/memory/search";
import { BundleFormatError, collectExport, parseBundle, toJson, type ExportBundle } from "@/lib/portability/bundle";
import { importBundle, type ImportReport } from "@/lib/portability/import";
import { fromMarkdown, toMarkdown } from "@/lib/portability/markdown";
import { supabaseDataStore } from "@/lib/portability/store";
import { createClient } from "@/lib/supabase/client";

function download(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Card({ title, children, description }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5">
      <h2 className="font-serif text-xl text-ink">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-ink-muted">{description}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function ImportExport({ userId, projects, extraction }: { userId: string; projects: ProjectRow[]; extraction: ExtractionProgress }) {
  return (
    <div className="space-y-6">
      <ExportCard />
      <ImportCard userId={userId} />
      <ChatGptCard userId={userId} projects={projects} extraction={extraction} />
    </div>
  );
}

function ExportCard() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (format: "json" | "md") => {
    setBusy(format);
    setError(null);
    try {
      const bundle = await collectExport(supabaseDataStore(createClient()));
      const day = bundle.exported_at.slice(0, 10);
      if (format === "json") download(`gio-export-${day}.json`, toJson(bundle), "application/json");
      else download(`gio-export-${day}.md`, toMarkdown(bundle), "text/markdown");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Card
      title="Export everything"
      description="Projects, rooms, every conversation, memory, decisions, pieces, Gio's prompt and its history. JSON is for re-importing; Markdown is readable and can also be imported. Library files stay in storage and are listed by name."
    >
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => run("json")} disabled={Boolean(busy)}>
          {busy === "json" ? <LoaderIcon className="animate-spin" /> : <DownloadIcon />} Export JSON
        </Button>
        <Button variant="outline" onClick={() => run("md")} disabled={Boolean(busy)}>
          {busy === "md" ? <LoaderIcon className="animate-spin" /> : <DownloadIcon />} Export Markdown
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-warn">{error}</p> : null}
    </Card>
  );
}

function ImportCard({ userId }: { userId: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const read = async (file: File) => {
    setError(null);
    setReport(null);
    setBundle(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      setBundle(file.name.toLowerCase().endsWith(".md") ? fromMarkdown(text) : parseBundle(JSON.parse(text)));
    } catch (err) {
      setError(err instanceof BundleFormatError ? err.message : err instanceof SyntaxError ? "That file isn't valid JSON." : String(err));
    }
  };

  const run = () =>
    start(async () => {
      if (!bundle) return;
      setError(null);
      try {
        setStatus("Importing…");
        const r = await importBundle(supabaseDataStore(createClient()), bundle, userId);
        setReport(r);
        // Imported memories need embeddings for relevance search.
        for (let i = 0; i < 20 && r.memoryIdsToEmbed.length; i++) {
          setStatus("Preparing imported memories for search…");
          const res = await embedMissingMemories();
          if (!res.ok || !res.data?.remaining) break;
        }
        setStatus(null);
        router.refresh();
      } catch (err) {
        setStatus(null);
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });

  return (
    <Card
      title="Import a Gio export"
      description="Restores a JSON or Markdown export from this app. Nothing is overwritten: items already here are skipped, the export's General Design Brain merges into yours, and a different system prompt is added to the prompt history rather than replacing the current one."
    >
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm text-ink hover:bg-sunk">
        <FileUpIcon className="size-4" /> Choose export file
        <input type="file" accept=".json,.md,application/json,text/markdown" className="hidden" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      {fileName ? <span className="ml-3 text-sm text-ink-muted">{fileName}</span> : null}
      {bundle && !report ? (
        <div className="mt-4 text-sm text-ink-soft">
          <p>
            Exported {bundle.exported_at.slice(0, 10)}: {bundle.projects.length} projects, {bundle.chats.length} conversations ({bundle.messages.length}{" "}
            messages), {bundle.memories.length} memories, {bundle.decisions.length} decisions, {bundle.products.length} pieces.
          </p>
          <Button className="mt-3" onClick={run} disabled={pending}>
            {pending ? "Importing…" : "Import"}
          </Button>
        </div>
      ) : null}
      {status ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
          <LoaderIcon className="size-4 animate-spin" /> {status}
        </p>
      ) : null}
      {report ? (
        <div className="mt-4 text-sm text-ink-soft">
          <p className="text-ok">Imported.</p>
          <p className="mt-1">
            Added {report.added.projects} projects, {report.added.rooms} rooms, {report.added.chats} conversations ({report.added.messages} messages),{" "}
            {report.added.memories} memories, {report.added.decisions} decisions, {report.added.products} pieces and {report.added.promptVersions} prompt
            versions. {report.skipped ? `${report.skipped} items were already here.` : ""}
          </p>
          {report.filesNotIncluded ? (
            <p className="mt-1 text-ink-muted">
              {report.filesNotIncluded} library files are listed in the export but not included. Re-upload the originals in the Library tab.
            </p>
          ) : null}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}
    </Card>
  );
}

const LIST_LIMIT = 300;

function ChatGptCard({ userId, projects, extraction }: { userId: string; projects: ProjectRow[]; extraction: ExtractionProgress }) {
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatGptConversation[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [speaker, setSpeaker] = useState<HumanSpeaker>("Both");
  const [extract, setExtract] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, start] = useTransition();

  const groups = useMemo(() => (conversations ? groupByGpt(conversations) : []), [conversations]);
  const matching = useMemo(
    () => (conversations ?? []).filter((c) => matchesQuery(query, c.title, c.messages[0]?.text.slice(0, 300))),
    [conversations, query],
  );

  const read = async (file: File) => {
    setError(null);
    setResult(null);
    setReading(true);
    try {
      const parsed = parseChatGptExport(await file.text());
      parsed.sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? ""));
      setConversations(parsed);
      // Preselect the largest custom GPT, most likely the old Gio.
      const top = groupByGpt(parsed).find((g) => g.gizmoId);
      setSelected(new Set(top ? parsed.filter((c) => c.gizmoId === top.gizmoId).map((c) => c.id) : []));
    } catch (err) {
      setError(err instanceof ChatGptFormatError ? err.message : "Couldn't read that file.");
    } finally {
      setReading(false);
    }
  };

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });

  const run = () =>
    start(async () => {
      if (!conversations) return;
      setError(null);
      try {
        const chosen = conversations.filter((c) => selected.has(c.id));
        const report = await importChatGptConversations(supabaseDataStore(createClient()), chosen, {
          userId,
          projectId,
          speaker,
          extractMemories: extract,
        });
        setResult(
          `Imported ${report.imported} conversations (${report.messages} messages).${report.skipped ? ` ${report.skipped} were already imported.` : ""}${
            extract && report.imported ? " Gio is now reading them for memories to propose." : ""
          }`,
        );
        router.refresh();
        notifyExtractionChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Import failed");
      }
    });

  return (
    <Card
      title="Import from ChatGPT"
      description="In ChatGPT, go to Settings, then Data controls, then Export data. Unzip the file ChatGPT emails you and choose conversations.json. It's read in this browser; only the conversations you select are saved. Conversations with the old Gio are grouped by its custom GPT id."
    >
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line-strong px-3 py-2 text-sm text-ink hover:bg-sunk">
        {reading ? <LoaderIcon className="size-4 animate-spin" /> : <FileUpIcon className="size-4" />} Choose conversations.json
        <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>

      {conversations ? (
        <div className="mt-5 space-y-4">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => {
              const ids = conversations.filter((c) => c.gizmoId === g.gizmoId).map((c) => c.id);
              const all = ids.every((id) => selected.has(id));
              return (
                <button
                  key={g.gizmoId ?? "none"}
                  type="button"
                  onClick={() => toggle(ids, !all)}
                  className={`rounded-full border px-3 py-1 text-xs ${all ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-muted hover:text-ink"}`}
                >
                  {g.gizmoId ? `Custom GPT ${g.gizmoId.slice(0, 14)}` : "Regular ChatGPT"} · {g.count}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles…" className="h-9 max-w-xs" />
            <Button size="sm" variant="ghost" onClick={() => toggle(matching.map((c) => c.id), true)}>
              Select all shown
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toggle(matching.map((c) => c.id), false)}>
              Clear shown
            </Button>
            <span className="text-sm text-ink-muted">{selected.size} selected</span>
          </div>

          <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
            {matching.slice(0, LIST_LIMIT).map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-3 px-3 py-2 hover:bg-sunk">
                  <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={selected.has(c.id)} onChange={(e) => toggle([c.id], e.target.checked)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">{c.title}</span>
                    <span className="block text-xs text-ink-muted">
                      {(c.updatedAt ?? c.createdAt ?? "").slice(0, 10)} · {c.messages.length} messages{c.gizmoId ? ` · ${c.gizmoId.slice(0, 14)}` : ""}
                    </span>
                  </span>
                </label>
              </li>
            ))}
            {matching.length > LIST_LIMIT ? (
              <li className="px-3 py-2 text-xs text-ink-muted">{matching.length - LIST_LIMIT} more; search to narrow the list.</li>
            ) : null}
          </ul>

          <div className="grid gap-2 sm:grid-cols-3">
            <label className="space-y-1">
              <span className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">Into project</span>
              <select className={selectClass + " h-10"} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block text-xs font-medium uppercase tracking-[0.08em] text-ink-muted">Who was typing</span>
              <select className={selectClass + " h-10"} value={speaker} onChange={(e) => setSpeaker(e.target.value as HumanSpeaker)}>
                {HUMAN_SPEAKERS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm text-ink-soft">
              <input type="checkbox" checked={extract} onChange={(e) => setExtract(e.target.checked)} className="accent-[var(--accent)]" />
              Propose memories from these conversations
            </label>
          </div>
          <Button onClick={run} disabled={pending || !selected.size || !projectId}>
            {pending ? "Importing…" : `Import ${selected.size} conversations`}
          </Button>
        </div>
      ) : null}

      {result ? <p className="mt-3 text-sm text-ok">{result}</p> : null}
      {error ? <p className="mt-3 text-sm text-warn">{error}</p> : null}

      {extraction.waiting || extraction.done || extraction.failed ? (
        <div className="mt-5 rounded-md bg-sunk p-3 text-sm text-ink-soft">
          <p className="flex items-center gap-2">
            {extraction.running ? <LoaderIcon className="size-4 animate-spin" /> : null}
            Memory proposals from imported conversations: {extraction.done} read, {extraction.waiting} waiting
            {extraction.failed ? `, ${extraction.failed} failed` : ""}.
            {extraction.proposals ? ` ${extraction.proposals} proposed this session.` : ""}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Proposals appear under Proposals in each project&rsquo;s notebook and in the Memory tab (filter: Proposed). Reading continues while the app is open.
          </p>
          {extraction.failed ? (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={async () => {
                await retryFailedExtraction();
                notifyExtractionChanged();
              }}
            >
              Retry failed
            </Button>
          ) : null}
          {extraction.error ? <p className="mt-1 text-xs text-warn">{extraction.error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}
