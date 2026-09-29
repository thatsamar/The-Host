import type { DecisionRow, MemoryType, ProductRow } from "@/lib/db/types";

export const MEMORY_TYPE_LABELS: Record<MemoryType, string> = {
  design_preference: "Design preference",
  courtney_preference: "Courtney's preference",
  amar_preference: "Amar's preference",
  shared_preference: "Shared preference",
  rejected_idea: "Rejected idea",
  approved_decision: "Approved decision",
  project_constraint: "Project constraint",
  budget_philosophy: "Budget philosophy",
  material: "Material",
  vendor: "Vendor",
  dimension: "Dimension",
  paint_color: "Paint color",
  furniture_under_consideration: "Furniture under consideration",
};

export const MEMORY_TYPE_SHORT: Record<MemoryType, string> = {
  design_preference: "Design",
  courtney_preference: "Courtney",
  amar_preference: "Amar",
  shared_preference: "Shared",
  rejected_idea: "Rejected",
  approved_decision: "Decided",
  project_constraint: "Constraint",
  budget_philosophy: "Budget",
  material: "Material",
  vendor: "Vendor",
  dimension: "Dimension",
  paint_color: "Paint",
  furniture_under_consideration: "Considering",
};

export const DECISION_STATUS_LABELS: Record<DecisionRow["status"], string> = {
  approved: "Approved",
  keep_looking: "Keep looking",
  rejected: "Rejected",
  pending: "Pending",
};

export const DECISION_STATUS_STYLES: Record<DecisionRow["status"], string> = {
  approved: "bg-olive-soft text-olive",
  keep_looking: "bg-tobacco-soft text-tobacco",
  rejected: "bg-oxblood-soft text-oxblood",
  pending: "bg-paper-sunk text-ink-muted",
};

export const PRODUCT_STATUS_LABELS: Record<ProductRow["status"], string> = {
  considering: "Considering",
  approved: "Approved",
  rejected: "Passed",
  purchased: "Purchased",
};

export function formatPrice(p: Pick<ProductRow, "price_amount" | "price_currency" | "price_basis">): string | null {
  if (p.price_amount == null) return null;
  let amount: string;
  try {
    amount = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: p.price_currency || "USD",
      maximumFractionDigits: 0,
    }).format(p.price_amount);
  } catch {
    amount = `${p.price_currency ?? ""} ${p.price_amount}`.trim();
  }
  return `${amount}${p.price_basis ? ` (${p.price_basis})` : ""}`;
}

/** Link to the chat message a memory, decision or product came from. */
export function sourceHref(projectId: string, row: { source_message_id: string | null; source_message?: { chat_id: string } | null }) {
  const chatId = row.source_message?.chat_id;
  return chatId && row.source_message_id ? `/p/${projectId}/c/${chatId}#msg-${row.source_message_id}` : null;
}
