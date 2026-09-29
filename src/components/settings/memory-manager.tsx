"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { approveMemory, deleteMemory, dismissMemory } from "@/app/memory-actions";
import { MemoryForm, selectClass } from "@/components/notebook/forms";
import { MEMORY_TYPE_LABELS, sourceHref } from "@/components/notebook/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MEMORY_TYPES, type MemoryRow, type ProjectRow } from "@/lib/db/types";
import { filterMemories, type MemoryFilter } from "@/lib/memory/search";
import { cn } from "@/lib/utils";

export function MemoryManager({ memories, projects }: { memories: MemoryRow[]; projects: ProjectRow[] }) {
  const [filter, setFilter] = useState<MemoryFilter>({ query: "", state: "approved", type: "", project: "" });
  const set = (patch: Partial<MemoryFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const shown = useMemo(() => filterMemories(memories, filter), [memories, filter]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));
  const counts = {
    approved: memories.filter((m) => m.review_state === "approved").length,
    proposed: memories.filter((m) => m.review_state === "proposed").length,
    dismissed: memories.filter((m) => m.review_state === "dismissed").length,
  };

  return (
    <section>
      <h2 className="font-serif text-xl text-ink">Memory</h2>
      <p className="mt-1 text-sm text-ink-muted">
        {counts.approved} approved · {counts.proposed} waiting for review · {counts.dismissed} dismissed. Gio uses only approved memories.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_12rem_12rem]">
        <label className="relative">
          <span className="sr-only">Search memories</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={filter.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search memory…" className="pl-9" />
        </label>
        <select aria-label="State" className={selectClass + " h-10"} value={filter.state} onChange={(e) => set({ state: e.target.value as MemoryFilter["state"] })}>
          <option value="approved">Approved</option>
          <option value="proposed">Proposed</option>
          <option value="dismissed">Dismissed</option>
          <option value="all">All</option>
        </select>
        <select aria-label="Type" className={selectClass + " h-10"} value={filter.type} onChange={(e) => set({ type: e.target.value })}>
          <option value="">Any type</option>
          {MEMORY_TYPES.map((t) => (
            <option key={t} value={t}>
              {MEMORY_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select aria-label="Project" className={selectClass + " h-10"} value={filter.project} onChange={(e) => set({ project: e.target.value })}>
          <option value="">Every project</option>
          <option value="household">Household-wide</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <ul className="mt-5 divide-y divide-stone border-y border-stone">
        {shown.length === 0 ? <li className="py-6 text-sm text-ink-muted">Nothing matches.</li> : null}
        {shown.map((m) => (
          <MemoryRowItem key={m.id} memory={m} projectName={m.project_id ? projectName.get(m.project_id) : "Household-wide"} />
        ))}
      </ul>
    </section>
  );
}

function MemoryRowItem({ memory: m, projectName }: { memory: MemoryRow; projectName?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      setEditing(false);
      router.refresh();
    });
  const href = m.project_id ? sourceHref(m.project_id, m) : null;

  if (editing) {
    return (
      <li className="py-4">
        <MemoryForm
          initial={{ type: m.type, content: m.content, attributedTo: m.attributed_to, household: !m.project_id }}
          submitLabel={m.review_state === "approved" ? "Save" : "Save & approve"}
          busy={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) => run(() => approveMemory(m.id, v, m.project_id ?? undefined))}
        />
      </li>
    );
  }
  return (
    <li className={cn("flex flex-col gap-2 py-3 sm:flex-row sm:items-start", m.review_state === "dismissed" && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tobacco">
          {MEMORY_TYPE_LABELS[m.type]}
          {m.review_state !== "approved" ? ` · ${m.review_state}` : ""}
        </p>
        <p className="mt-0.5 font-serif text-[15px] leading-snug text-ink">{m.content}</p>
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted">
          {m.attributed_to ? <span>{m.attributed_to === "Both" ? "Courtney & Amar" : m.attributed_to}</span> : null}
          {projectName ? <span>· {projectName}</span> : null}
          <span>· {new Date(m.created_at).toLocaleDateString()}</span>
          {m.source ? <span>· {m.source}</span> : null}
          {href ? (
            <Link href={href} className="hover:text-oxblood">
              · source
            </Link>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {m.review_state === "proposed" ? (
          <>
            <Button size="sm" className="h-7 text-xs" disabled={pending} onClick={() => run(() => approveMemory(m.id))}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => run(() => dismissMemory(m.id))}>
              Dismiss
            </Button>
          </>
        ) : null}
        {m.review_state === "dismissed" ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={pending} onClick={() => run(() => approveMemory(m.id))}>
            Restore
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-oxblood"
          disabled={pending}
          onClick={() => confirm("Delete this memory for good?") && run(() => deleteMemory(m.id))}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
