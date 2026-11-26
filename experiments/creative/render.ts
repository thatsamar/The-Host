/**
 * The owner's pages, in experiments/creative/out/:
 *   blind.html     each question's answers under neutral numbers, in shuffled order, with a
 *                  scoring form: intellectual quality first, then experiential (EVALUATION.md).
 *                  Controlled comparisons and end-to-end comparisons are separate sections.
 *   rewrites.html  the advisor's own answer beside what the rewrite step delivered
 *   key.html       which configuration wrote each numbered answer (open after judging)
 *   summary.json   length, rewrite and trim rates, cost and model per configuration
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadCases } from "./cases";
import { CONFIGS } from "./configs";
import type { RunResult } from "./run.exp";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function shuffled<T>(items: T[], seed: string, key: (t: T) => string): T[] {
  const h = (t: T) => createHash("sha256").update(seed + key(t)).digest("hex");
  return [...items].sort((a, b) => (h(a) < h(b) ? -1 : 1));
}

export const INTELLECTUAL = ["Depth of knowledge", "Independent judgment", "Taste and discernment", "Distinctiveness of perspective", "Understanding of the individual", "Ability to challenge assumptions", "Factual integrity"];
/** The owner's own questions about the experience (Nov 26): answered after the two lists, never instead of them. */
export const EXPERIENCE = [
  "Did I learn something interesting?",
  "Did it notice something I hadn't?",
  "Did it feel personal without trying to show personalization?",
  "Did it make me more confident in my decision?",
  "Did it make me curious?",
  "Would I want to continue the conversation?",
  "Would I seek this person's opinion again?",
];
export const EXPERIENTIAL = ["Authenticity of voice", "Conversational naturalness", "Appropriate length", "Warmth and restraint", "Absence of AI mannerisms", "Absence of forced personality"];

const NAME: Record<string, string> = { tony: "Amar", martini: "Martine", gio: "Gio", alden: "Alden", goldie: "Goldie" };

const STYLE = `:root{--bg:#f6f7f5;--card:#fff;--fg:#1c2321;--muted:#5b6662;--line:#d9dfdc;--accent:#1f5f57;--bad:#9a2f2c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121615;--card:#1a201e;--fg:#e4e9e6;--muted:#9aa6a1;--line:#2c3532;--accent:#7cc4b8;--bad:#ec9b96;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Georgia,"Times New Roman",serif}
main{max-width:860px;margin:0 auto;padding:32px max(16px,env(safe-area-inset-left,0px)) 80px max(16px,env(safe-area-inset-right,0px));display:grid;gap:30px}
h1{font:600 28px/1.2 system-ui,sans-serif;margin:0}h2{font:600 21px/1.3 system-ui,sans-serif;margin:0}h3{font:600 17px/1.3 system-ui,sans-serif;margin:0 0 4px}
.q{font-style:italic;font-size:17px;margin:4px 0}.note{font:14px/1.5 system-ui,sans-serif;color:var(--muted)}
.r{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:grid;gap:10px}
.text{white-space:pre-wrap;overflow-wrap:anywhere}.n{font:600 12px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}
.turn{font:13px system-ui,sans-serif;color:var(--muted)}.grid{display:grid;gap:12px}
details summary{cursor:pointer;font:600 14px system-ui,sans-serif}
.scores{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:4px 14px;font:13px system-ui,sans-serif}
.scores label{display:flex;justify-content:space-between;gap:8px;align-items:center}.scores select{font:inherit}
.group{grid-column:1/-1;font-weight:600;margin-top:6px}textarea{width:100%;box-sizing:border-box;font:13px system-ui,sans-serif;min-height:48px}
button{font:600 14px system-ui,sans-serif;padding:8px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--bg)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}@media (max-width:640px){.pair{grid-template-columns:1fr}}
table{border-collapse:collapse;font:14px system-ui,sans-serif}td,th{border-bottom:1px solid var(--line);padding:6px 10px;text-align:left}`;

const page = (title: string, body: string, script = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

/** The speaker label production adds ("Gio: ") would give the configuration away, so the blind pages leave it off. */
export const unlabeled = (text: string) => text.replace(/^\s*(Amar|Martine|Gio|Alden|Goldie): /, "");

function scoreForm(label: string, challenge: "hold" | "update" | null, memory: "use" | "withhold" | null = null): string {
  const sel = (crit: string) =>
    `<label>${esc(crit)} <select data-a="${esc(label)}" data-c="${esc(crit)}"><option value="">–</option>${[1, 2, 3, 4, 5].map((v) => `<option>${v}</option>`).join("")}</select></label>`;
  const follow = challenge
    ? `<label class="group" style="font-weight:400">After the follow-up (${challenge === "hold" ? "pushback, no new information" : "legitimate new information"}): <select data-a="${esc(label)}" data-c="Follow-up"><option value="">–</option><option>Held its view, with reasons</option><option>Changed for a good reason</option><option>Caved to pressure</option><option>Stubborn despite new information</option><option>Unclear</option></select></label>`
    : "";
  const ask = (q: string) => `<label>${esc(q)} <select data-a="${esc(label)}" data-c="${esc(q)}"><option value="">–</option><option>Yes</option><option>Somewhat</option><option>No</option></select></label>`;
  const mem = memory
    ? `<label class="group" style="font-weight:400">The earlier messages (${memory === "use" ? "a good answer is shaped by them" : "a good answer leaves them out"}): <select data-a="${esc(label)}" data-c="Memory"><option value="">–</option><option>Understood, without reciting</option><option>Recited or displayed them</option><option>Ignored what mattered</option><option>Brought in what didn't belong</option></select></label>`
    : "";
  return `<details><summary>Score this answer</summary><div class="scores"><div class="group">Intellectual quality (takes precedence)</div>${INTELLECTUAL.map(sel).join("")}<div class="group">Experiential quality</div>${EXPERIENTIAL.map(sel).join("")}<div class="group">The experience</div>${EXPERIENCE.map(ask).join("")}${mem}${follow}<label class="group" style="font-weight:400"><span><input type="checkbox" data-a="${esc(label)}" data-c="Invented fact or claimed experience"> Invented a fact or claimed an experience (fails the answer)</span></label><textarea data-a="${esc(label)}" data-c="Notes" placeholder="Notes"></textarea></div></details>`;
}

interface Entry {
  label: string;
  config: string;
  rep: number;
  r: RunResult;
  text: string;
  firstText?: string;
}

function entryHtml(e: Entry, question: string, challenge: "hold" | "update" | null, memory: "use" | "withhold" | null = null): string {
  const pick = (t: { own: string; delivered: string }) => unlabeled(e.config === "B" ? t.own : t.delivered);
  let exchange = "";
  if (e.r.followUp) {
    exchange = `<div class="turn">First answer</div><div class="text">${esc(unlabeled(e.firstText ?? ""))}</div><div class="turn">The person replies: “${esc(e.r.followUp.text)}”</div><div class="turn">Second answer (judge this one)</div>`;
  } else if (e.r.thread?.length) {
    exchange = e.r.thread
      .map((t, i) => `${i ? `<div class="turn">${t.later ? "Another day" : "The person replies"}: “${esc(t.user)}”</div>` : ""}<div class="text">${esc(pick(t))}</div>`)
      .join("");
    exchange += `<div class="turn">Then: “${esc(lastAsked(e.r))}” (judge the whole thread: does it compound?)</div>`;
  }
  return `<div class="r"><div class="n">${esc(e.label)}</div>${exchange}<div class="text">${esc(unlabeled(e.text))}</div>${scoreForm(e.label, challenge, memory)}</div>`;
}

/** The person's last message in a sequence. */
function lastAsked(r: RunResult): string {
  const c = loadCases().find((x) => x.id === r.caseId);
  return c?.followUps?.at(-1)?.text ?? "";
}

export function render(dir: string): void {
  const results = readFileSync(`${dir}results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult).filter((r) => !r.error);
  const keyRows: string[] = [];
  const sections: Record<"controlled" | "end-to-end", string[]> = { controlled: [], "end-to-end": [] };
  const voiceRows: string[] = [];
  const voice = new Map<string, string[]>();
  for (const c of loadCases()) {
    if (c.kind === "voice") continue;
    for (const family of ["controlled", "end-to-end"] as const) {
      const runs = results.filter((r) => r.caseId === c.id && r.family === family);
      if (!runs.length) continue;
      const entries: Entry[] = [];
      for (const r of runs) {
        entries.push({ label: "", config: r.config, rep: r.rep, r, text: r.delivered, firstText: r.first?.delivered });
        // B: A's own answer, before production's rewrite and trim.
        if (r.config === "A") entries.push({ label: "", config: "B", rep: r.rep, r, text: r.own, firstText: r.first?.own });
      }
      const tag = family === "controlled" ? "c" : "e";
      const first = shuffled(entries.filter((e) => e.rep === 1), c.id + family, (e) => e.config);
      const more = shuffled(entries.filter((e) => e.rep > 1), c.id + family + "more", (e) => `${e.config}${e.rep}`);
      first.forEach((e, i) => (e.label = `${c.id}-${tag}${i + 1}`));
      more.forEach((e, i) => (e.label = `${c.id}-${tag}${first.length + i + 1}`));
      for (const e of [...first, ...more]) keyRows.push(`<tr><td>${esc(e.label)}</td><td>${esc(e.config)}</td><td>${e.rep}</td><td>${esc(family)}</td></tr>`);
      const challenge = c.followUp?.expect ?? null;
      const source = c.source === "authentic" ? "authentic exchange" : c.source === "owner" ? "your question" : "draft question";
      sections[family].push(
        `<section class="grid"><h3>${esc(NAME[c.advisor])} · ${esc(c.kind)} · ${source}</h3><p class="q">“${esc(c.question)}”</p>${c.history?.length ? `<p class="note">With ${c.history.length} earlier messages as context.</p>` : ""}${first.map((e) => entryHtml(e, c.question, challenge, c.memory ?? null)).join("")}${more.length ? `<details><summary>More runs of the same question, to judge variation</summary><div class="grid">${more.map((e) => entryHtml(e, c.question, challenge, c.memory ?? null)).join("")}</div></details>` : ""}</section>`,
      );
    }
  }
  // Voice: the same question to all five, without names. Could you tell who is speaking?
  const groups = [...new Set(loadCases().filter((c) => c.kind === "voice" && c.group).map((c) => c.group!))];
  for (const g of groups) {
    const cases = loadCases().filter((c) => c.group === g);
    const runs = results.filter((r) => r.rep === 1 && cases.some((c) => c.id === r.caseId));
    for (const cfg of [...new Set(runs.map((r) => r.config))]) {
      const set = shuffled(runs.filter((r) => r.config === cfg), g + cfg, (r) => r.advisor);
      const label = (i: number) => `v-${g}-${cfg.toLowerCase()}-${i + 1}`;
      set.forEach((r, i) => voiceRows.push(`<tr><td>${esc(label(i))}</td><td>${esc(NAME[r.advisor])}</td><td>${esc(r.config)}</td><td>1</td></tr>`));
      const guess = (l: string) => `<label>Whose voice? <select data-a="${esc(l)}" data-c="Voice"><option value="">–</option>${Object.values(NAME).map((n) => `<option>${n}</option>`).join("")}<option>Can't tell</option></select></label>`;
      const html = `<div class="grid"><p class="note">Set ${(voice.get(g)?.length ?? 0) + 1}: one configuration, five advisors, shuffled.</p>${set.map((r, i) => `<div class="r"><div class="n">${esc(label(i))}</div><div class="text">${esc(unlabeled(r.delivered))}</div><div class="scores">${guess(label(i))}</div></div>`).join("")}</div>`;
      voice.set(g, [...(voice.get(g) ?? []), html]);
    }
  }
  const voiceSection = groups.length
    ? `<h2>Could you tell who is speaking?</h2><p class="note">The same question went to all five advisors. Each set is one configuration, shuffled, with names removed. Guess the advisor; the key says who it was.</p>${groups.map((g) => `<section class="grid"><h3>“${esc(loadCases().find((c) => c.group === g)!.question)}”</h3>${(voice.get(g) ?? []).join("")}</section>`).join("")}`
    : "";
  const intro = `<h1>Cinq blind comparison</h1>
<p class="note">Read each answer as the person would. Score intellectual quality first: it takes precedence; the questions about the experience come after it. Don't reward an answer for being longer, more entertaining, more agreeable, shorter, more obscure, cleverer or better written, or for disagreeing for its own sake. An invented fact or claimed experience fails the answer. Your scores stay in this browser; use "Copy my scores" to send them back. Open the key only after judging.</p>`;
  const body = `${intro}<h2>Controlled comparisons</h2><p class="note">Identical research inputs (no web search), and identical factual-integrity, privacy and safety instructions and date for every configuration. Differences here come from the instructions around the brief.</p>${sections.controlled.join("")}<h2>End-to-end comparisons</h2><p class="note">With web search, as a person would actually get the answer. Differences here can also come from research, so they are kept separate.</p>${sections["end-to-end"].join("")}${voiceSection}<p><button id="copy">Copy my scores</button></p><textarea id="out" readonly hidden></textarea>`;
  const script = `const K="cinq-blind-scores";let s={};try{s=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}
for(const el of document.querySelectorAll("[data-a]")){const k=el.dataset.a+"|"+el.dataset.c;if(k in s){if(el.type==="checkbox")el.checked=s[k];else el.value=s[k]}
el.addEventListener("change",()=>{s[k]=el.type==="checkbox"?el.checked:el.value;try{localStorage.setItem(K,JSON.stringify(s))}catch(e){}})}
document.getElementById("copy").addEventListener("click",()=>{const t=JSON.stringify(s,null,1);const o=document.getElementById("out");o.value=t;o.hidden=false;
(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).catch(()=>{o.select()})});`;
  writeFileSync(`${dir}blind.html`, page("Cinq blind comparison", body, script));
  writeFileSync(
    `${dir}key.html`,
    page("Cinq comparison key", `<h1>Key</h1><p class="note">${CONFIGS.map((c) => `<b>${c.id}</b> ${esc(c.name)}`).join(" · ")} · <b>B</b> A's own answer before the rewrite and trim</p><table><tr><th>Answer</th><th>Configuration</th><th>Run</th><th>Family</th></tr>${keyRows.join("")}</table>${voiceRows.length ? `<h2>Whose voice</h2><table><tr><th>Answer</th><th>Advisor</th><th>Configuration</th><th>Run</th></tr>${voiceRows.join("")}</table>` : ""}`),
  );

  const changed = results.filter((r) => (r.rewritten || r.trimmed) && r.own.trim() !== r.delivered.trim());
  const pipelineRuns = results.filter((r) => CONFIGS.find((c) => c.id === r.config)?.textPipeline).length;
  writeFileSync(
    `${dir}rewrites.html`,
    page(
      "Cinq rewrites",
      `<h1>The advisor's own answer, and what the person received</h1><p class="note">Every run where production's text pipeline changed the advisor's answer: rewritten by the quick low-effort call that never sees the brief, or trimmed to whole sentences. ${changed.length} of ${pipelineRuns} text-pipeline runs.</p>${changed
        .map(
          (r) =>
            `<section><h3>${esc(NAME[r.advisor])} · ${esc(r.caseId)} · ${esc(r.config)} run ${r.rep} · ${r.rewritten ? "rewritten" : "trimmed"}</h3><div class="pair"><div class="r"><div class="n">The advisor's own answer · ${r.own.length} characters</div><div class="text">${esc(r.own)}</div></div><div class="r"><div class="n">What the person received · ${r.delivered.length} characters</div><div class="text">${esc(r.delivered)}</div></div></div></section>`,
        )
        .join("")}`,
    ),
  );

  const summary = CONFIGS.map((cfg) => {
    const rs = results.filter((r) => r.config === cfg.id);
    const avg = (f: (r: RunResult) => number) => (rs.length ? Math.round(rs.reduce((n, r) => n + f(r), 0) / rs.length) : null);
    return {
      config: cfg.id,
      name: cfg.name,
      family: cfg.family,
      runs: rs.length,
      avgDeliveredChars: avg((r) => r.delivered.length),
      avgOwnChars: avg((r) => r.own.length),
      rewriteRate: rs.length ? Number((rs.filter((r) => r.rewritten).length / rs.length).toFixed(2)) : null,
      trimRate: rs.length ? Number((rs.filter((r) => r.trimmed).length / rs.length).toFixed(2)) : null,
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
