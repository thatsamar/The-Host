"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MEMORY_TYPES, type MemoryType } from "@/lib/db/types";
import { HUMAN_SPEAKERS, type HumanSpeaker } from "@/lib/gio/speakers";
import type { ProductDraft } from "@/lib/memory/drafts";
import { cn } from "@/lib/utils";
import { DECISION_STATUS_LABELS, MEMORY_TYPE_LABELS } from "./labels";

export const selectClass =
  "h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-sm text-ink outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20";

export interface MemoryFormValue {
  type: MemoryType;
  content: string;
  attributedTo: HumanSpeaker | null;
  household: boolean;
}

export function MemoryForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  compact,
}: {
  initial: MemoryFormValue;
  submitLabel: string;
  onSubmit: (value: MemoryFormValue) => void;
  onCancel?: () => void;
  busy?: boolean;
  compact?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const set = (patch: Partial<MemoryFormValue>) => setValue((v) => ({ ...v, ...patch }));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.content.trim()) onSubmit({ ...value, content: value.content.trim() });
      }}
    >
      <Textarea
        aria-label="Memory"
        value={value.content}
        onChange={(e) => set({ content: e.target.value })}
        rows={compact ? 3 : 4}
        className="font-serif text-[15px] leading-relaxed md:text-[15px]"
        autoFocus
      />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <select className={selectClass} value={value.type} onChange={(e) => set({ type: e.target.value as MemoryType })}>
            {MEMORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {MEMORY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Whose">
          <select
            className={selectClass}
            value={value.attributedTo ?? ""}
            onChange={(e) => set({ attributedTo: (e.target.value || null) as HumanSpeaker | null })}
          >
            <option value="">Not specific</option>
            {HUMAN_SPEAKERS.map((s) => (
              <option key={s} value={s}>
                {s === "Both" ? "Both (shared)" : s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={value.household} onChange={(e) => set({ household: e.target.checked })} className="accent-[var(--accent)]" />
        Applies to every home (household-wide)
      </label>
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || !value.content.trim()}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export interface DecisionFormValue {
  title: string;
  detail: string;
  status: "approved" | "keep_looking" | "rejected" | "pending";
  product: (ProductDraft & { status: "considering" | "approved" | "rejected" | "purchased" }) | null;
}

export const EMPTY_PRODUCT: DecisionFormValue["product"] = {
  name: "",
  designer: null,
  vendor: null,
  url: null,
  dimensions: null,
  material_color: null,
  provenance: "unknown",
  price_amount: null,
  price_currency: "USD",
  price_basis: "estimated",
  price_source_url: null,
  placement: null,
  rationale: null,
  verdict: null,
  status: "considering",
};

const labelText = "block text-xs font-medium uppercase tracking-[0.08em] text-ink-muted";

/** A native label wrapping its control, so the two are linked for assistive tech. */
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className={labelText}>{label}</span>
      {children}
    </label>
  );
}

export function DecisionForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  busy,
  allowProduct = true,
}: {
  initial: DecisionFormValue;
  submitLabel: string;
  onSubmit: (value: DecisionFormValue) => void;
  onCancel?: () => void;
  busy?: boolean;
  allowProduct?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const set = (patch: Partial<DecisionFormValue>) => setValue((v) => ({ ...v, ...patch }));
  const setProduct = (patch: Partial<NonNullable<DecisionFormValue["product"]>>) =>
    setValue((v) => ({ ...v, product: v.product ? { ...v.product, ...patch } : v.product }));
  const text = (v: string | null) => v ?? "";
  const orNull = (v: string) => (v.trim() ? v : null);
  const p = value.product;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!value.title.trim()) return;
        if (p && !p.name.trim()) return;
        onSubmit(value);
      }}
    >
      <Field label="Decision">
        <Input value={value.title} onChange={(e) => set({ title: e.target.value })} autoFocus />
      </Field>
      <Field label="Why">
        <Textarea value={value.detail} onChange={(e) => set({ detail: e.target.value })} rows={3} />
      </Field>
      <Field label="Status">
        <select className={selectClass} value={value.status} onChange={(e) => set({ status: e.target.value as DecisionFormValue["status"] })}>
          {Object.entries(DECISION_STATUS_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>

      {allowProduct ? (
        <label className="flex items-center gap-2 pt-1 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={Boolean(p)}
            onChange={(e) => set({ product: e.target.checked ? (initial.product ?? EMPTY_PRODUCT) : null })}
            className="accent-[var(--accent)]"
          />
          Track a piece under consideration
        </label>
      ) : null}

      {p ? (
        <div className="grid grid-cols-2 gap-2 rounded-md border border-line bg-ground p-3">
          <Field label="Piece" className="col-span-2">
            <Input value={p.name} onChange={(e) => setProduct({ name: e.target.value })} placeholder="Danish rosewood lounge chair" />
          </Field>
          <Field label="Designer / maker">
            <Input value={text(p.designer)} onChange={(e) => setProduct({ designer: orNull(e.target.value) })} />
          </Field>
          <Field label="Vendor">
            <Input value={text(p.vendor)} onChange={(e) => setProduct({ vendor: orNull(e.target.value) })} />
          </Field>
          <Field label="Dimensions">
            <Input value={text(p.dimensions)} onChange={(e) => setProduct({ dimensions: orNull(e.target.value) })} placeholder='29"W × 32"D × 30"H' />
          </Field>
          <Field label="Material / color">
            <Input value={text(p.material_color)} onChange={(e) => setProduct({ material_color: orNull(e.target.value) })} />
          </Field>
          <Field label="Vintage vs. new">
            <select className={selectClass} value={p.provenance} onChange={(e) => setProduct({ provenance: e.target.value as ProductDraft["provenance"] })}>
              {["vintage", "new", "antique", "custom", "unknown"].map((v) => (
                <option key={v} value={v}>
                  {v[0].toUpperCase() + v.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Invest / save / skip">
            <select className={selectClass} value={p.verdict ?? ""} onChange={(e) => setProduct({ verdict: (e.target.value || null) as ProductDraft["verdict"] })}>
              <option value="">—</option>
              <option value="invest">Invest</option>
              <option value="save">Save</option>
              <option value="skip">Skip</option>
            </select>
          </Field>
          <Field label="Price">
            <Input
              inputMode="decimal"
              value={p.price_amount ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value.replace(/[^0-9.]/g, ""));
                setProduct({ price_amount: e.target.value.trim() && Number.isFinite(n) ? n : null });
              }}
              placeholder="1800"
            />
          </Field>
          <Field label="Price is">
            <select className={selectClass} value={p.price_basis ?? "estimated"} onChange={(e) => setProduct({ price_basis: e.target.value as "sourced" | "estimated" })}>
              <option value="estimated">Estimated</option>
              <option value="sourced">Sourced</option>
            </select>
          </Field>
          <Field label="Listing URL" className="col-span-2">
            <Input value={text(p.url ?? p.price_source_url)} onChange={(e) => setProduct({ url: orNull(e.target.value), price_source_url: orNull(e.target.value) })} />
          </Field>
          <Field label="Placement" className="col-span-2">
            <Input value={text(p.placement)} onChange={(e) => setProduct({ placement: orNull(e.target.value) })} />
          </Field>
          <Field label="Why it belongs" className="col-span-2">
            <Textarea value={text(p.rationale)} onChange={(e) => setProduct({ rationale: orNull(e.target.value) })} rows={2} />
          </Field>
        </div>
      ) : null}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={busy || !value.title.trim() || Boolean(p && !p.name.trim())}>
          {busy ? "Saving…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
