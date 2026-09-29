"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SearchIcon } from "lucide-react";
import { approveDecision, deleteDecision, dismissDecision, updateDecision } from "@/app/memory-actions";
import { DecisionForm, selectClass } from "@/components/notebook/forms";
import { DECISION_STATUS_LABELS, DECISION_STATUS_STYLES, sourceHref } from "@/components/notebook/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DecisionRow, ProjectRow } from "@/lib/db/types";
import { filterDecisions, type DecisionFilter } from "@/lib/memory/search";
import { cn } from "@/lib/utils";

export function DecisionManager({ decisions, projects }: { decisions: DecisionRow[]; projects: ProjectRow[] }) {
  const [filter, setFilter] = useState<DecisionFilter>({ query: "", status: "", project: "", includeProposed: true });
  const set = (patch: Partial<DecisionFilter>) => setFilter((f) => ({ ...f, ...patch }));
  const shown = useMemo(() => filterDecisions(decisions, filter), [decisions, filter]);
  const projectName = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <section>
      <h2 className="font-serif text-xl text-ink">Decisions</h2>
      <p className="mt-1 text-sm text-ink-muted">The decision log across every project.</p>
      <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_12rem]">
        <label className="relative">
          <span className="sr-only">Search decisions</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input value={filter.query} onChange={(e) => set({ query: e.target.value })} placeholder="Search decisions…" className="pl-9" />
        </label>
        <select aria-label="Status" className={selectClass + " h-10"} value={filter.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          {Object.entries(DECISION_STATUS_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select aria-label="Project" className={selectClass + " h-10"} value={filter.project} onChange={(e) => set({ project: e.target.value })}>
          <option value="">Every project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {shown.length === 0 ? <li className="py-6 text-sm text-ink-muted">Nothing matches.</li> : null}
        {shown.map((d) => (
          <DecisionRowItem key={d.id} decision={d} projectName={projectName.get(d.project_id)} />
        ))}
      </ul>
    </section>
  );
}

function DecisionRowItem({ decision: d, projectName }: { decision: DecisionRow; projectName?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      setEditing(false);
      router.refresh();
    });
  const href = sourceHref(d.project_id, d);

  if (editing) {
    return (
      <li className="py-4">
        <DecisionForm
          allowProduct={false}
          initial={{ title: d.title, detail: d.detail ?? "", status: d.status, product: null }}
          submitLabel={d.review_state === "approved" ? "Save" : "Save & approve"}
          busy={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) =>
            run(() =>
              d.review_state === "approved"
                ? updateDecision(d.id, { title: v.title, detail: v.detail || null, status: v.status })
                : approveDecision(d.id, { title: v.title, detail: v.detail || null, status: v.status }),
            )
          }
        />
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2">
          <span className={cn("rounded-sm px-1.5 py-px text-[10px] font-medium uppercase tracking-wider", DECISION_STATUS_STYLES[d.status])}>
            {DECISION_STATUS_LABELS[d.status]}
          </span>
          {d.review_state === "proposed" ? <span className="text-[10px] uppercase tracking-wider text-accent">Proposed</span> : null}
        </p>
        <p className="mt-1 font-serif text-[15px] leading-snug text-ink">{d.title}</p>
        {d.detail ? <p className="text-sm text-ink-soft">{d.detail}</p> : null}
        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-ink-muted">
          {projectName ? <span>{projectName}</span> : null}
          {d.decided_by ? <span>· {d.decided_by}</span> : null}
          <span>· {new Date(d.created_at).toLocaleDateString()}</span>
          {href ? (
            <Link href={href} className="hover:text-accent">
              · source
            </Link>
          ) : null}
        </p>
      </div>
      <div className="flex shrink-0 gap-1">
        {d.review_state === "proposed" ? (
          <>
            <Button size="sm" className="h-7 text-xs" disabled={pending} onClick={() => run(() => approveDecision(d.id))}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => run(() => dismissDecision(d.id))}>
              Dismiss
            </Button>
          </>
        ) : null}
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={pending} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-warn"
          disabled={pending}
          onClick={() => confirm("Delete this decision?") && run(() => deleteDecision(d.id))}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
