/**
 * Turns the results into the owner's pages, in experiments/creative/out/:
 *   blind.html      every question's answers under neutral numbers, in shuffled order
 *   rewrites.html   the advisor's own answer beside what the rewrite step delivered
 *   key.html        which configuration wrote each numbered answer (open after judging)
 *   summary.json    length, rewrite and trim rates, cost and model per configuration
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { CASES } from "./cases";
import { CONFIGS } from "./configs";
import type { RunResult } from "./run.exp";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A stable shuffle, so the numbers don't move when the pages are rebuilt. */
function shuffled<T>(items: T[], seed: string, key: (t: T) => string): T[] {
  return [...items].sort((a, b) => {
    const h = (t: T) => createHash("sha256").update(seed + key(t)).digest("hex");
    return h(a) < h(b) ? -1 : 1;
  });
}

const PAGE = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>:root{--bg:#f6f7f5;--card:#fff;--fg:#1c2321;--muted:#5b6662;--line:#d9dfdc;--accent:#1f5f57;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121615;--card:#1a201e;--fg:#e4e9e6;--muted:#9aa6a1;--line:#2c3532;--accent:#7cc4b8;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Georgia,"Times New Roman",serif}
main{max-width:820px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-left,0px)) 80px max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1{font:600 28px/1.2 system-ui,sans-serif;margin:0}h2{font:600 20px/1.3 system-ui,sans-serif;margin:0 0 6px}p.q{font-style:italic;font-size:18px}
.r{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;white-space:pre-wrap;overflow-wrap:anywhere}
.n{font:600 12px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent);margin-bottom:6px}
.note{font:14px/1.5 system-ui,sans-serif;color:var(--muted)}.grid{display:grid;gap:12px}.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:640px){.pair{grid-template-columns:1fr}}details summary{cursor:pointer;font:600 14px system-ui,sans-serif}
table{border-collapse:collapse;font:14px system-ui,sans-serif}td,th{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left}</style></head><body><main>${body}</main></body></html>`;

interface Entry {
  label: string;
  config: string;
  rep: number;
  text: string;
}

export function render(dir: string): void {
  const results = readFileSync(`${dir}results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult).filter((r) => !r.error);
  const keyRows: string[] = [];
  const blind: string[] = [`<h1>Cinq blind comparison</h1><p class="note">Every answer to each question, numbered at random. Read them as the person would and judge: quality of judgment, authority, tone, personality, independence, usefulness and naturalness. Which configuration wrote which is in the key, to open only after you've judged. Questions marked draft stand in for authentic exchanges still to come.</p>`];
  for (const c of CASES) {
    const runs = results.filter((r) => r.caseId === c.id);
    if (!runs.length) continue;
    const entries: Entry[] = [];
    for (const r of runs) {
      entries.push({ label: "", config: r.config, rep: r.rep, text: r.delivered });
      // B: the advisor's own answer before production's rewrite and trim.
      if (r.config === "A") entries.push({ label: "", config: "B", rep: r.rep, text: r.own });
    }
    const first = shuffled(entries.filter((e) => e.rep === 1), c.id, (e) => e.config);
    const more = shuffled(entries.filter((e) => e.rep > 1), c.id + "more", (e) => `${e.config}${e.rep}`);
    first.forEach((e, i) => (e.label = `${c.id}-${i + 1}`));
    more.forEach((e, i) => (e.label = `${c.id}-${first.length + i + 1}`));
    for (const e of [...first, ...more]) keyRows.push(`<tr><td>${esc(e.label)}</td><td>${esc(e.config)}</td><td>${e.rep}</td></tr>`);
    blind.push(`<section><h2>${esc(SMS_NAME[c.advisor])}${c.source === "draft" ? " · draft question" : ""}</h2><p class="q">“${esc(c.question)}”</p><div class="grid">${first.map((e) => `<div class="r"><div class="n">${esc(e.label)}</div>${esc(e.text)}</div>`).join("")}</div>${more.length ? `<details><summary>More runs of the same question (to judge variation)</summary><div class="grid">${more.map((e) => `<div class="r"><div class="n">${esc(e.label)}</div>${esc(e.text)}</div>`).join("")}</div></details>` : ""}</section>`);
  }
  writeFileSync(`${dir}blind.html`, PAGE("Cinq blind comparison", blind.join("")));
  writeFileSync(`${dir}key.html`, PAGE("Cinq comparison key", `<h1>Key</h1><p class="note">${CONFIGS.map((c) => `<b>${c.id}</b> ${esc(c.name)}`).join(" · ")} · <b>B</b> A's own answer before the rewrite and trim</p><table><tr><th>Answer</th><th>Configuration</th><th>Run</th></tr>${keyRows.join("")}</table>`));

  const changed = results.filter((r) => (r.rewritten || r.trimmed) && r.own.trim() !== r.delivered.trim());
  writeFileSync(
    `${dir}rewrites.html`,
    PAGE("Cinq rewrites", `<h1>Own answer and delivered answer</h1><p class="note">Every run where production's text pipeline changed the advisor's answer: rewritten by the quick low-effort call that never sees the brief, or trimmed to whole sentences. ${changed.length} of ${results.filter((r) => ["P", "A", "C", "H"].includes(r.config)).length} text-pipeline runs.</p>${changed
      .map((r) => `<section><h2>${esc(SMS_NAME[r.advisor])} · ${esc(r.caseId)} · ${esc(r.config)} run ${r.rep} · ${r.rewritten ? "rewritten" : "trimmed"}</h2><div class="pair"><div class="r"><div class="n">The advisor's own answer · ${r.own.length} characters</div>${esc(r.own)}</div><div class="r"><div class="n">What the person received · ${r.delivered.length} characters</div>${esc(r.delivered)}</div></div></section>`)
      .join("")}`),
  );

  const summary = CONFIGS.map((cfg) => {
    const rs = results.filter((r) => r.config === cfg.id);
    const avg = (f: (r: RunResult) => number) => (rs.length ? Math.round(rs.reduce((n, r) => n + f(r), 0) / rs.length) : null);
    return {
      config: cfg.id,
      name: cfg.name,
      runs: rs.length,
      avgDeliveredChars: avg((r) => r.delivered.length),
      avgOwnChars: avg((r) => r.own.length),
      rewriteRate: rs.length ? rs.filter((r) => r.rewritten).length / rs.length : null,
      trimRate: rs.length ? rs.filter((r) => r.trimmed).length / rs.length : null,
      avgInstructionChars: avg((r) => r.instructionChars),
      avgMs: avg((r) => r.ms),
      costUsd: Number(rs.reduce((n, r) => n + r.costUsd, 0).toFixed(3)),
      models: [...new Set(rs.map((r) => r.model))],
      routerModels: [...new Set(rs.map((r) => r.routerModel).filter(Boolean))],
      effort: [...new Set(rs.map((r) => r.effort))],
    };
  });
  writeFileSync(`${dir}summary.json`, JSON.stringify(summary, null, 2));
}

const SMS_NAME: Record<string, string> = { tony: "Amar", martini: "Martine", gio: "Gio", alden: "Alden", goldie: "Goldie" };
