// Readable Markdown export that can also be imported back.
//
// Each record is rendered for people (headings, lists, text blocks) and also
// carries its exact data in an HTML comment that Markdown viewers hide:
//
//   <!-- gio:memories {"id":"…","type":"amar_preference",…} -->
//
// Long text (prompts, briefs, messages) goes in a fenced block right after
// the comment instead of inside it; the comment names the field with "$text".
// The importer reads only the comments and fenced blocks, so editing the
// human-readable parts doesn't break an import.

import { formatPrice } from "@/components/notebook/labels";
import { BundleFormatError, emptyBundle, EXPORT_FORMAT, EXPORT_TABLES, parseBundle, type ExportBundle } from "./bundle";
import type { Row } from "./store";

const MEMORY_LABELS: Record<string, string> = {
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

/** JSON that can't close the HTML comment it sits in. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/>/g, "\\u003e");
}

function fence(text: string): string {
  const longest = Math.max(0, ...(text.match(/~+/g) ?? []).map((m) => m.length));
  const marks = "~".repeat(Math.max(4, longest + 1));
  return `${marks}text\n${text}\n${marks}`;
}

/** Comment (and fenced text) for one record. */
function record(kind: string, row: Row, textField?: string): string {
  const value = textField ? row[textField] : undefined;
  if (textField && typeof value === "string") {
    const { [textField]: _omit, ...rest } = row;
    void _omit;
    return `<!-- gio:${kind} ${safeJson({ ...rest, $text: textField })} -->\n${fence(value)}`;
  }
  return `<!-- gio:${kind} ${safeJson(row)} -->`;
}

function date(value: unknown): string {
  if (typeof value !== "string") return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16).replace("T", " ");
}

const oneLine = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

export function toMarkdown(bundle: ExportBundle): string {
  const out: string[] = [];
  const push = (...lines: string[]) => out.push(...lines);
  const header = { format: bundle.format, version: bundle.version, exported_at: bundle.exported_at };

  push(
    "# Gio export",
    "",
    `Courtney and Amar's design notebook, exported ${date(bundle.exported_at)} UTC: projects, rooms, conversations, memory, decisions and pieces under consideration. Original library files stay in storage and are listed, not included.`,
    "",
    `<!-- gio-export ${safeJson(header)} -->`,
    "",
    "## Gio's system prompt",
    "",
    bundle.system_prompt === null ? record("system_prompt", { value: null }) : record("system_prompt", { value: bundle.system_prompt }, "value"),
    "",
  );
  if (bundle.system_prompt_versions.length) {
    push("### Earlier versions", "");
    for (const v of bundle.system_prompt_versions) {
      push(`#### ${date(v.created_at)} · ${oneLine(v.label)}${v.note ? ` · ${oneLine(v.note)}` : ""}`, "", record("system_prompt_versions", v, "content"), "");
    }
  }

  const byProject = <T extends Row>(rows: T[], projectId: unknown) => rows.filter((r) => r.project_id === projectId);
  const household = bundle.memories.filter((m) => m.project_id === null);
  if (household.length) {
    push("## Household-wide memory", "");
    for (const m of household) push(memoryLine(m), "");
  }

  for (const p of bundle.projects) {
    push(`## Project: ${oneLine(p.name)}`, "");
    if (p.location) push(`Place: ${oneLine(p.location)}`, "");
    push(record("projects", p, "brief"), "");

    const rooms = byProject(bundle.rooms, p.id);
    if (rooms.length) {
      push("### Rooms", "");
      for (const r of rooms) push(`#### ${oneLine(r.name)}`, "", record("rooms", r, "notes"), "");
    }

    const memories = byProject(bundle.memories, p.id);
    if (memories.length) {
      push("### Memory", "");
      for (const m of memories) push(memoryLine(m), "");
    }

    const decisions = byProject(bundle.decisions, p.id);
    if (decisions.length) {
      push("### Decisions", "");
      for (const d of decisions) {
        push(
          `- **${oneLine(d.status).replace("_", " ")}.** ${oneLine(d.title)}${d.detail ? ` — ${oneLine(d.detail)}` : ""}${d.review_state !== "approved" ? ` _(${d.review_state})_` : ""}`,
          `  ${record("decisions", d)}`,
          "",
        );
      }
    }

    const products = byProject(bundle.products, p.id);
    if (products.length) {
      push("### Pieces", "");
      for (const pr of products) {
        const price = formatPrice({
          price_amount: typeof pr.price_amount === "number" ? pr.price_amount : pr.price_amount ? Number(pr.price_amount) : null,
          price_currency: (pr.price_currency as string) ?? null,
          price_basis: (pr.price_basis as "sourced" | "estimated") ?? null,
        });
        const facts = [pr.dimensions, pr.material_color, pr.provenance, price, pr.verdict, pr.status].filter(Boolean).map(oneLine);
        push(`- **${oneLine(pr.name)}**${facts.length ? ` · ${facts.join(" · ")}` : ""}`, `  ${record("products", pr)}`, "");
      }
    }

    const files = byProject(bundle.files, p.id);
    if (files.length) {
      push("### Library files", "");
      for (const f of files) push(`- ${oneLine(f.name)} (${oneLine(f.status)})`, `  ${record("files", f)}`, "");
    }

    for (const c of byProject(bundle.chats, p.id)) {
      push(`### Conversation: ${oneLine(c.title) || "Untitled"}`, "", record("chats", c), "");
      for (const m of bundle.messages.filter((m) => m.chat_id === c.id)) {
        push(`**${oneLine(m.speaker)}** · ${date(m.created_at)}`, "", record("messages", m, "content"), "");
      }
    }
  }
  return out.join("\n");
}

function memoryLine(m: Row): string {
  const label = MEMORY_LABELS[String(m.type)] ?? String(m.type);
  const state = m.review_state !== "approved" ? ` _(${m.review_state})_` : "";
  return `- **${label}.** ${oneLine(m.content)}${state}\n  ${record("memories", m)}`;
}

// ---------------------------------------------------------------------------

const COMMENT = /^\s*<!-- gio:([a-z_]+) (.*) -->\s*$/;
const HEADER = /^\s*<!-- gio-export (.*) -->\s*$/;

export function fromMarkdown(markdown: string): ExportBundle {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const bundle = emptyBundle();
  let header: Record<string, unknown> | null = null;
  const tables = new Set<string>(EXPORT_TABLES);

  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(HEADER);
    if (h) {
      header = JSON.parse(h[1]);
      continue;
    }
    const m = lines[i].match(COMMENT);
    if (!m) continue;
    const kind = m[1];
    let row: Row;
    try {
      row = JSON.parse(m[2]);
    } catch {
      throw new BundleFormatError(`Line ${i + 1}: the data comment is damaged.`);
    }
    if (typeof row.$text === "string") {
      const field = row.$text;
      delete row.$text;
      // The fenced block follows, after optional blank lines.
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      const open = lines[j]?.match(/^(~{4,})text$/);
      if (!open) throw new BundleFormatError(`Line ${i + 1}: expected a text block after the data comment.`);
      const end = lines.indexOf(open[1], j + 1);
      if (end === -1) throw new BundleFormatError(`Line ${j + 1}: a text block isn't closed.`);
      row[field] = lines.slice(j + 1, end).join("\n");
      i = end;
    }
    if (kind === "system_prompt") bundle.system_prompt = (row.value as string | null) ?? null;
    else if (tables.has(kind)) (bundle[kind as keyof ExportBundle] as Row[]).push(row);
  }

  if (!header || header.format !== EXPORT_FORMAT) {
    throw new BundleFormatError("That Markdown file isn't a Gio export.");
  }
  bundle.version = Number(header.version);
  bundle.exported_at = String(header.exported_at);
  return parseBundle(bundle);
}
