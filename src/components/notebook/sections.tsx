"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon, ExternalLinkIcon, MessageSquareIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  approveDecision,
  approveMemory,
  deleteDecision,
  deleteMemory,
  deleteProduct,
  dismissDecision,
  dismissMemory,
  updateDecision,
  updateMemory,
  updateProduct,
} from "@/app/memory-actions";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { DecisionRow, MemoryRow, ProductRow } from "@/lib/db/types";
import { cn } from "@/lib/utils";
import { DecisionForm, MemoryForm, selectClass } from "./forms";
import {
  DECISION_STATUS_LABELS,
  DECISION_STATUS_STYLES,
  formatPrice,
  MEMORY_TYPE_LABELS,
  MEMORY_TYPE_SHORT,
  PRODUCT_STATUS_LABELS,
  sourceHref,
} from "./labels";

export function PanelSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-stone pt-5">
      <h3 className="mb-3 flex items-baseline justify-between font-serif text-lg text-ink">
        {title}
        {count ? <span className="font-sans text-xs text-ink-muted">{count}</span> : null}
      </h3>
      {children}
    </section>
  );
}

function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn("mr-1.5 inline-block rounded-sm px-1.5 py-px align-[1px] text-[10px] font-medium uppercase tracking-wider", className)}>
      {children}
    </span>
  );
}

function SourceLink({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-[11px] text-ink-muted hover:text-oxblood">
      <MessageSquareIcon className="size-3" /> From the conversation
    </Link>
  );
}

function RowMenu({ onEdit, onDelete }: { onEdit?: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="shrink-0 rounded p-0.5 text-ink-muted hover:bg-paper-sunk hover:text-ink" aria-label="Options">
        <MoreHorizontalIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[9rem]">
        {onEdit ? (
          <DropdownMenuItem onSelect={onEdit}>
            <PencilIcon /> Edit
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="text-oxblood" onSelect={onDelete}>
          <Trash2Icon className="!text-oxblood" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export function ProposalsSection({ projectId, memories, decisions }: { projectId: string; memories: MemoryRow[]; decisions: DecisionRow[] }) {
  const count = memories.length + decisions.length;
  return (
    <PanelSection title="Proposals" count={count}>
      {count === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          After each answer, Gio proposes anything worth remembering here. Nothing is saved until you approve it.
        </p>
      ) : (
        <ul className="space-y-3">
          {memories.map((m) => (
            <MemoryProposal key={m.id} memory={m} projectId={projectId} />
          ))}
          {decisions.map((d) => (
            <DecisionProposal key={d.id} decision={d} projectId={projectId} />
          ))}
        </ul>
      )}
    </PanelSection>
  );
}

function ProposalActions({ onApprove, onEdit, onDismiss, pending }: { onApprove: () => void; onEdit: () => void; onDismiss: () => void; pending: boolean }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Button size="sm" className="h-7 px-2.5 text-xs" onClick={onApprove} disabled={pending}>
        <CheckIcon className="size-3.5" /> Approve
      </Button>
      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" onClick={onEdit} disabled={pending}>
        <PencilIcon className="size-3.5" /> Edit
      </Button>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onDismiss} disabled={pending}>
        <XIcon className="size-3.5" /> Dismiss
      </Button>
    </div>
  );
}

function MemoryProposal({ memory, projectId }: { memory: MemoryRow; projectId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => {
    await fn();
    router.refresh();
  });
  return (
    <li className="rounded-md border border-stone bg-paper-raised p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tobacco">Memory · {MEMORY_TYPE_LABELS[memory.type]}</p>
      {editing ? (
        <div className="mt-2">
          <MemoryForm
            compact
            initial={{ type: memory.type, content: memory.content, attributedTo: memory.attributed_to, household: !memory.project_id }}
            submitLabel="Save & approve"
            busy={pending}
            onCancel={() => setEditing(false)}
            onSubmit={(v) => run(() => approveMemory(memory.id, v, projectId))}
          />
        </div>
      ) : (
        <>
          <p className="mt-1 font-serif text-[15px] leading-snug text-ink">{memory.content}</p>
          {memory.evidence ? <p className="mt-1 text-xs italic text-ink-muted">&ldquo;{memory.evidence}&rdquo;</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
            {memory.attributed_to ? <span>{memory.attributed_to === "Both" ? "Courtney & Amar" : memory.attributed_to}</span> : null}
            {!memory.project_id ? <span>· household-wide</span> : null}
            <SourceLink href={sourceHref(projectId, memory)} />
          </p>
          <ProposalActions
            pending={pending}
            onApprove={() => run(() => approveMemory(memory.id))}
            onEdit={() => setEditing(true)}
            onDismiss={() => run(() => dismissMemory(memory.id))}
          />
        </>
      )}
    </li>
  );
}

function DecisionProposal({ decision, projectId }: { decision: DecisionRow; projectId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => {
    await fn();
    router.refresh();
  });
  return (
    <li className="rounded-md border border-stone bg-paper-raised p-3">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-tobacco">
        Decision · {DECISION_STATUS_LABELS[decision.status]}
      </p>
      {editing ? (
        <div className="mt-2">
          <DecisionForm
            allowProduct={false}
            initial={{ title: decision.title, detail: decision.detail ?? "", status: decision.status, product: null }}
            submitLabel="Save & approve"
            busy={pending}
            onCancel={() => setEditing(false)}
            onSubmit={(v) => run(() => approveDecision(decision.id, { title: v.title, detail: v.detail || null, status: v.status }))}
          />
        </div>
      ) : (
        <>
          <p className="mt-1 font-serif text-[15px] leading-snug text-ink">{decision.title}</p>
          {decision.detail ? <p className="mt-0.5 text-sm text-ink-soft">{decision.detail}</p> : null}
          {decision.evidence ? <p className="mt-1 text-xs italic text-ink-muted">&ldquo;{decision.evidence}&rdquo;</p> : null}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-muted">
            {decision.decided_by ? <span>{decision.decided_by === "Both" ? "Courtney & Amar" : decision.decided_by}</span> : null}
            <SourceLink href={sourceHref(projectId, decision)} />
          </p>
          <ProposalActions
            pending={pending}
            onApprove={() => run(() => approveDecision(decision.id))}
            onEdit={() => setEditing(true)}
            onDismiss={() => run(() => dismissDecision(decision.id))}
          />
        </>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

export function MemorySection({ projectId, memories }: { projectId: string; memories: MemoryRow[] }) {
  return (
    <PanelSection title="Memory" count={memories.length}>
      {memories.length ? (
        <ul className="space-y-2.5">
          {memories.map((m) => (
            <MemoryItem key={m.id} memory={m} projectId={projectId} />
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-ink-muted">
          Nothing remembered yet. Approved preferences, constraints and past calls live here and shape every answer.
        </p>
      )}
    </PanelSection>
  );
}

function MemoryItem({ memory, projectId }: { memory: MemoryRow; projectId: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  if (editing) {
    return (
      <li className="rounded-md border border-stone bg-paper-raised p-3">
        <MemoryForm
          compact
          initial={{ type: memory.type, content: memory.content, attributedTo: memory.attributed_to, household: !memory.project_id }}
          submitLabel="Save"
          busy={pending}
          onCancel={() => setEditing(false)}
          onSubmit={(v) =>
            start(async () => {
              await updateMemory(memory.id, v, projectId);
              setEditing(false);
              router.refresh();
            })
          }
        />
      </li>
    );
  }
  return (
    <li className="group flex items-start gap-2 text-sm leading-snug text-ink-soft">
      <span className="min-w-0 flex-1">
        <Chip className="bg-olive-soft text-olive">{MEMORY_TYPE_SHORT[memory.type]}</Chip>
        {memory.content}
        {!memory.project_id ? <span className="ml-1 text-[11px] text-ink-muted">· household</span> : null}
      </span>
      <RowMenu
        onEdit={() => setEditing(true)}
        onDelete={() => {
          if (!confirm("Forget this memory?")) return;
          start(async () => {
            await deleteMemory(memory.id);
            router.refresh();
          });
        }}
      />
    </li>
  );
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export function DecisionsSection({ projectId, decisions }: { projectId: string; decisions: DecisionRow[] }) {
  return (
    <PanelSection title="Decisions" count={decisions.length}>
      {decisions.length ? (
        <ul className="space-y-3">
          {decisions.map((d) => (
            <DecisionItem key={d.id} decision={d} projectId={projectId} />
          ))}
        </ul>
      ) : (
        <p className="text-sm leading-relaxed text-ink-muted">No decisions logged for this project.</p>
      )}
    </PanelSection>
  );
}

function DecisionItem({ decision, projectId }: { decision: DecisionRow; projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <li className="text-sm leading-snug">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-ink">{decision.title}</span>
          {decision.detail ? <span className="block pt-0.5 text-ink-muted">{decision.detail}</span> : null}
        </div>
        <RowMenu
          onDelete={() => {
            if (!confirm("Delete this decision?")) return;
            start(async () => {
              await deleteDecision(decision.id);
              router.refresh();
            });
          }}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          aria-label="Decision status"
          disabled={pending}
          className={cn("h-7 w-auto rounded-sm border-0 px-1.5 text-[11px] font-medium uppercase tracking-wider", DECISION_STATUS_STYLES[decision.status])}
          value={decision.status}
          onChange={(e) =>
            start(async () => {
              await updateDecision(decision.id, { status: e.target.value });
              router.refresh();
            })
          }
        >
          {Object.entries(DECISION_STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {decision.decided_by ? <span className="text-[11px] text-ink-muted">{decision.decided_by === "Both" ? "Both" : decision.decided_by}</span> : null}
        <SourceLink href={sourceHref(projectId, decision)} />
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Pieces under consideration
// ---------------------------------------------------------------------------

export function ProductsSection({ projectId, products }: { projectId: string; products: ProductRow[] }) {
  const active = products.filter((p) => p.status !== "rejected");
  const passed = products.length - active.length;
  return (
    <PanelSection title="Pieces" count={active.length}>
      {products.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-muted">
          Pieces you save from a recommendation appear here with their dimensions, price and verdict.
        </p>
      ) : (
        <ul className="space-y-3">
          {[...active, ...products.filter((p) => p.status === "rejected")].map((p) => (
            <ProductItem key={p.id} product={p} projectId={projectId} />
          ))}
        </ul>
      )}
      {passed ? <p className="mt-2 text-[11px] text-ink-muted">{passed} passed on</p> : null}
    </PanelSection>
  );
}

function ProductItem({ product: p, projectId }: { product: ProductRow; projectId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const price = formatPrice(p);
  const facts = [p.dimensions, p.material_color, p.provenance && p.provenance !== "unknown" ? p.provenance : null].filter(Boolean);
  return (
    <li className={cn("rounded-md border border-stone bg-paper-raised p-3 text-sm", p.status === "rejected" && "opacity-60")}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-serif text-[15px] leading-snug text-ink">{p.name}</p>
          {p.designer || p.vendor ? <p className="text-xs text-ink-muted">{[p.designer, p.vendor].filter(Boolean).join(" · ")}</p> : null}
        </div>
        <RowMenu
          onDelete={() => {
            if (!confirm(`Remove ${p.name}?`)) return;
            start(async () => {
              await deleteProduct(p.id);
              router.refresh();
            });
          }}
        />
      </div>
      {facts.length ? <p className="mt-1 text-xs text-ink-soft">{facts.join(" · ")}</p> : null}
      {p.placement ? <p className="mt-0.5 text-xs text-ink-soft">Placement: {p.placement}</p> : null}
      {p.rationale ? <p className="mt-0.5 text-xs text-ink-muted">{p.rationale}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {p.verdict ? <Chip className="bg-tobacco-soft text-tobacco">{p.verdict}</Chip> : null}
        {price ? <span className="text-xs text-ink">{price}</span> : null}
        {p.url ? (
          <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-oxblood hover:underline">
            Listing <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}
        <select
          aria-label="Piece status"
          disabled={pending}
          className={cn(selectClass, "ml-auto h-7 w-auto text-xs")}
          value={p.status}
          onChange={(e) =>
            start(async () => {
              await updateProduct(p.id, e.target.value);
              router.refresh();
            })
          }
        >
          {Object.entries(PRODUCT_STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="mt-1">
        <SourceLink href={sourceHref(projectId, p)} />
      </div>
    </li>
  );
}
