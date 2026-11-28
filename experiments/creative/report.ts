/**
 * The intellectual study's pages (INTELLECT.md), in experiments/creative/out/:
 *
 *   primary.html      the simplified blind evaluation: for each question, the
 *                     answers under neutral numbers, and four choices only:
 *                     which advice I'd follow, which showed the most discernment,
 *                     which understood something the others missed, which
 *                     advisor I'd return to. The detailed rubric stays in
 *                     blind.html, for diagnosis.
 *   primary-key.html  which configuration wrote each number (open after judging)
 *   report.html       configuration-level results of the automated checks,
 *   report.json       per advisor and per kind of question, failure patterns,
 *                     repeatability and flagged facts; and, once the owner's
 *                     primary choices are given (SCORES_FILE, the JSON from
 *                     "Copy my choices"), which configuration won them, with
 *                     winning and losing examples.
 *
 * The checks never decide quality: the owner's choices do (EVALUATION.md).
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Case } from "./cases";
import { CONFIGS } from "./configs";
import { readJudgements, type Judgement } from "./judges";
import type { RunResult } from "./run.exp";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const strip = (t: string) => t.replace(/^\s*(Amar|Martine|Gio|Alden|Goldie): /, "");
const NAME: Record<string, string> = { tony: "Amar", martini: "Martine", gio: "Gio", alden: "Alden", goldie: "Goldie" };

/** The four questions of the primary evaluation, in the owner's order. */
export const PRIMARY = [
  ["follow", "Whose advice would I follow?"],
  ["discernment", "Which showed the most discernment?"],
  ["missed", "Which understood something the others missed?"],
  ["return", "Which advisor would I return to?"],
] as const;

/** Configurations shown on the primary page: the general baselines and production, unless PRIMARY_CONFIGS says otherwise. */
const primaryConfigs = () => (process.env.PRIMARY_CONFIGS ?? "G0,G,GS,A,P").split(",").map((s) => s.trim());

const STYLE = `:root{--bg:#f6f7f5;--card:#fff;--fg:#1c2321;--muted:#5b6662;--line:#d9dfdc;--accent:#1f5f57;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121615;--card:#1a201e;--fg:#e4e9e6;--muted:#9aa6a1;--line:#2c3532;--accent:#7cc4b8;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 Georgia,serif}main{max-width:900px;margin:0 auto;padding:28px 16px 80px;display:grid;gap:26px}
h1{font:600 26px/1.2 system-ui,sans-serif;margin:0}h2{font:600 20px/1.3 system-ui,sans-serif;margin:8px 0 0}h3{font:600 16px/1.3 system-ui,sans-serif;margin:0}
.q{font-style:italic;font-size:17px;margin:2px 0}.note{font:14px/1.5 system-ui,sans-serif;color:var(--muted)}
.r{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:grid;gap:8px}.text{white-space:pre-wrap;overflow-wrap:anywhere}
.n{font:600 12px system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:var(--accent)}.turn{font:13px system-ui,sans-serif;color:var(--muted);white-space:pre-wrap}
.choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 16px;font:14px system-ui,sans-serif;background:var(--card);border:1px solid var(--accent);border-radius:10px;padding:12px 14px}
.choices label{display:flex;justify-content:space-between;gap:8px;align-items:center}select,textarea{font:inherit}textarea{width:100%;box-sizing:border-box;min-height:40px;font:13px system-ui,sans-serif;grid-column:1/-1}
details summary{cursor:pointer;font:600 14px system-ui,sans-serif}.grid{display:grid;gap:10px}
button{font:600 14px system-ui,sans-serif;padding:8px 14px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--bg)}
table{border-collapse:collapse;font:13px system-ui,sans-serif;width:100%}td,th{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{position:sticky;top:0;background:var(--bg)}`;

const page = (title: string, body: string, script = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${script ? `<script>${script}</script>` : ""}</body></html>`;

function shuffled<T>(items: T[], seed: string, key: (t: T) => string): T[] {
  const h = (t: T) => createHash("sha256").update(seed + key(t)).digest("hex");
  return [...items].sort((a, b) => (h(a) < h(b) ? -1 : 1));
}

function readResults(out: string): RunResult[] {
  return existsSync(`${out}results.jsonl`) ? readFileSync(`${out}results.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as RunResult).filter((r) => !r.error) : [];
}

function contextHtml(c: Case): string {
  if (!c.history?.length) return "";
  const lines = c.history.map((t) => `${t.daysAgo ? `[${t.daysAgo} days ago] ` : ""}${t.role === "user" ? "Person" : "Advisor"}: ${t.text}${t.photos?.length ? " [photo]" : ""}`).join("\n");
  return `<details><summary>Earlier messages (${c.history.length}), given to every answer except those without memory</summary><div class="turn">${esc(lines)}</div></details>`;
}

function answerHtml(label: string, r: RunResult, c: Case): string {
  const challenge = r.first && c.followUp ? `<div class="turn">First answer:</div><div class="text">${esc(strip(r.first.delivered || r.first.own))}</div><div class="turn">The person replies: “${esc(c.followUp.text)}”</div><div class="turn">Second answer (judge this one):</div>` : "";
  const thread = r.thread?.length
    ? r.thread.map((t, i) => `${i ? `<div class="turn">${t.later ? "Another day" : "Then"}: “${esc(t.user)}”</div>` : ""}<div class="text">${esc(strip(t.delivered))}</div>`).join("") + `<div class="turn">Then: “${esc(c.followUps?.at(-1)?.text ?? "")}”</div>`
    : "";
  return `<div class="r"><div class="n">${esc(label)}</div>${challenge}${thread}<div class="text">${esc(strip(r.delivered))}</div></div>`;
}

/** The primary page and its key. */
function renderPrimary(out: string, cases: Case[], results: RunResult[]): Map<string, string> {
  const want = primaryConfigs();
  const keyOf = new Map<string, string>();
  const sections: string[] = [];
  const keyRows: string[] = [];
  for (const c of cases.filter((x) => x.kind !== "voice")) {
    const runs = results.filter((r) => r.caseId === c.id && r.rep === 1 && want.includes(r.config));
    if (runs.length < 2) continue;
    const order = shuffled(runs, `primary${c.id}`, (r) => r.config);
    const labels = order.map((r, i) => {
      const label = `${c.id}-${i + 1}`;
      keyOf.set(label, r.config);
      keyRows.push(`<tr><td>${esc(label)}</td><td>${esc(r.config)}</td></tr>`);
      return label;
    });
    const opts = `<option value="">–</option>${labels.map((l) => `<option>${esc(l)}</option>`).join("")}<option>None stands out</option>`;
    const choices = PRIMARY.map(([k, q]) => `<label>${esc(q)} <select data-a="${esc(c.id)}" data-c="${k}">${opts}</select></label>`).join("");
    sections.push(
      `<section class="grid"><h3>${esc(NAME[c.advisor])} · ${esc(c.kind)}${c.source === "authentic" ? " · your real exchange" : ""}</h3><p class="q">“${esc(c.question || "(a photo, no words)")}”</p>${c.photos?.length ? `<p class="note">With ${c.photos.length} photo(s), not shown here.</p>` : ""}${c.material ? `<p class="note">${esc(c.material)}</p>` : ""}${contextHtml(c)}${order.map((r, i) => answerHtml(labels[i], r, c)).join("")}<div class="choices">${choices}<textarea data-a="${esc(c.id)}" data-c="note" placeholder="What decided it (optional)"></textarea></div></section>`,
    );
  }
  const script = `const K="cinq-primary-choices";let s={};try{s=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}
for(const el of document.querySelectorAll("[data-a]")){const k=el.dataset.a+"|"+el.dataset.c;if(k in s)el.value=s[k];el.addEventListener("change",()=>{s[k]=el.value;try{localStorage.setItem(K,JSON.stringify(s))}catch(e){}})}
document.getElementById("copy").addEventListener("click",()=>{const t=JSON.stringify(s,null,1);const o=document.getElementById("out");o.value=t;o.hidden=false;(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).catch(()=>{o.select()})});`;
  const intro = `<h1>Which would you follow?</h1><p class="note">For each question, the answers are shuffled under neutral numbers, names removed. Some come from Cinq, some from a general-purpose AI given the same information, with or without web search. Answer four questions only: whose advice you'd follow, which showed the most discernment, which understood something the others missed, and which advisor you'd return to. Choose "None stands out" when that's the truth. Don't reward length, polish, agreement or disagreement for its own sake. Your choices stay in this browser; "Copy my choices" exports them. The detailed rubric is in the diagnosis page; open the key only after judging.</p>`;
  writeFileSync(`${out}primary.html`, page("Cinq: which would you follow?", `${intro}${sections.join("")}<p><button id="copy">Copy my choices</button></p><textarea id="out" readonly hidden></textarea>`, script));
  writeFileSync(`${out}primary-key.html`, page("Cinq primary key", `<h1>Key</h1><table><tr><th>Answer</th><th>Configuration</th></tr>${keyRows.join("")}</table>`));
  return keyOf;
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);
const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);
const mean = (xs: number[]) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2)) : null);

/** Configuration-level results of the automated checks. */
export function summarize(cases: Case[], results: RunResult[], judgements: Judgement[]) {
  const caseOf = new Map(cases.map((c) => [c.id, c]));
  const resultOf = new Map(results.map((r) => [r.key, r]));
  const js = judgements.filter((j) => resultOf.has(j.key) && !("error" in j.data) && !("unparsed" in j.data));
  const configs = [...new Set(results.map((r) => r.config))];
  const rows = (filter: (r: RunResult) => boolean) =>
    configs
      .map((cfg) => {
        const rs = results.filter((r) => r.config === cfg && filter(r));
        const mine = (type: Judgement["type"]) => js.filter((j) => j.type === type && resultOf.get(j.key)!.config === cfg && filter(resultOf.get(j.key)!));
        const checks = mine("check");
        const ordinary = checks.filter((j) => !caseOf.get(resultOf.get(j.key)!.caseId)?.followUp);
        const challenge = checks.filter((j) => caseOf.get(resultOf.get(j.key)!.caseId)?.followUp);
        const integrity = mine("integrity");
        const memory = mine("memory").flatMap((j) => {
          const c = caseOf.get(resultOf.get(j.key)!.caseId)!;
          return arr(j.data.facts).map((f: { n?: number; used?: boolean; mentioned?: boolean; intrusive?: boolean }) => ({ ...f, kind: c.facts?.[(f.n ?? 0) - 1]?.kind }));
        });
        const consistency = mine("consistency");
        const convergence = mine("convergence");
        const machinery = mine("machinery");
        const mnum = (k: string) => mean(machinery.map((j) => num(j.data[k])).filter((x): x is number => x !== null));
        const thread = mine("thread");
        const threadYes = (k: string) => pct(thread.filter((j) => (j.data[k] as { verdict?: string } | undefined)?.verdict === "yes").length, thread.length);
        const facts = mine("facts").flatMap((j) => arr(j.data.claims) as { status?: string }[]);
        const score = (j: Judgement) => (j.data.verdict === "pass" ? 1 : j.data.verdict === "partly" ? 0.5 : 0);
        return {
          config: cfg,
          answers: rs.length,
          avgChars: rs.length ? Math.round(rs.reduce((n, r) => n + strip(r.delivered).length, 0) / rs.length) : null,
          costPerAnswer: rs.length ? Number((rs.reduce((n, r) => n + r.costUsd, 0) / rs.length).toFixed(3)) : null,
          checkPass: pct(ordinary.reduce((n, j) => n + score(j), 0), ordinary.length),
          challengePass: pct(challenge.reduce((n, j) => n + score(j), 0), challenge.length),
          claimedExperience: integrity.filter((j) => arr(j.data.claimedExperience).length).length,
          overCertainPerAnswer: mean(integrity.map((j) => arr(j.data.overCertain).length)),
          unseen: integrity.filter((j) => arr(j.data.unseen).length).length,
          memoryUsed: pct(memory.filter((f) => f.kind === "use" && f.used).length, memory.filter((f) => f.kind === "use").length),
          memoryMentioned: pct(memory.filter((f) => f.kind === "use" && f.mentioned).length, memory.filter((f) => f.kind === "use").length),
          memoryIntrusive: memory.filter((f) => f.intrusive).length,
          sensitiveLeaked: memory.filter((f) => f.kind === "withhold" && f.mentioned).length,
          inventedUnknown: memory.filter((f) => f.kind === "absent" && (f.used || f.mentioned)).length,
          sameAcrossRuns: pct(consistency.filter((j) => j.data.recommendation === "same").length, consistency.length),
          differentAcrossRuns: pct(consistency.filter((j) => j.data.recommendation === "different").length, consistency.length),
          sameRecommendationAsGeneral: pct(convergence.filter((j) => j.data.sameRecommendation === true).length, convergence.length),
          reasonOverlapWithGeneral: mean(convergence.map((j) => num(j.data.reasonOverlap)).filter((x): x is number => x !== null)),
          addsSomethingGeneralMissed: pct(convergence.filter((j) => typeof j.data.xNotInY === "string" && j.data.xNotInY.trim()).length, convergence.length),
          sentences: mnum("sentences"),
          researchNarration: mnum("researchNarration"),
          logistics: mnum("logistics"),
          repeats: mnum("repeats"),
          ideas: mean(machinery.map((j) => arr(j.data.ideas).length)),
          headingsOrLists: pct(machinery.filter((j) => j.data.headingsOrLists === true).length, machinery.length),
          labelledEnding: pct(machinery.filter((j) => j.data.labelledEnding === true).length, machinery.length),
          threadDeveloping: threadYes("developing"),
          threadPossibilities: threadYes("possibilities"),
          threadEmotional: threadYes("emotional"),
          threadInterpretation: threadYes("interpretation"),
          factsChecked: facts.length,
          factsWrong: facts.filter((f) => f.status === "wrong").length,
        };
      })
      .filter((r) => r.answers);
  const byAdvisor = Object.fromEntries(Object.keys(NAME).map((a) => [NAME[a], rows((r) => r.advisor === a)]));
  const byKind = Object.fromEntries([...new Set(results.map((r) => r.kind))].map((k) => [k, rows((r) => r.kind === k)]));
  // Failure patterns: every failed check, grouped by kind, with the answer.
  const failures = js
    .filter((j) => j.type === "check" && j.data.verdict === "fail")
    .map((j) => ({ ...resultOf.get(j.key)!, reason: String(j.data.reason ?? "") }))
    .map((r) => ({ key: r.key, kind: r.kind, advisor: NAME[r.advisor], config: r.config, reason: r.reason, answer: strip(r.delivered) }));
  const flags = js
    .filter((j) => j.type === "integrity" && (arr(j.data.claimedExperience).length || arr(j.data.unseen).length))
    .map((j) => ({ key: j.key, claimedExperience: j.data.claimedExperience, unseen: j.data.unseen }));
  const wrongFacts = js.filter((j) => j.type === "facts").flatMap((j) => (arr(j.data.claims) as { claim?: string; status?: string; note?: string }[]).filter((c) => c.status === "wrong").map((c) => ({ key: j.key, ...c })));
  const drift = js.filter((j) => j.type === "consistency" && j.data.recommendation === "different").map((j) => ({ key: j.key, note: j.data.note }));
  return { overall: rows(() => true), byAdvisor, byKind, failures, flags, wrongFacts, drift };
}

/** The owner's primary choices (SCORES_FILE), tallied by configuration, with winning and losing examples. */
function ownerChoices(keyOf: Map<string, string>) {
  const file = process.env.SCORES_FILE;
  if (!file || !existsSync(file)) return null;
  const choices = JSON.parse(readFileSync(file, "utf8")) as Record<string, string>;
  const tally: Record<string, Record<string, number>> = {};
  const shown: Record<string, number> = {};
  for (const cfg of keyOf.values()) shown[cfg] = (shown[cfg] ?? 0) + 1;
  const wins: { caseId: string; question: string; config: string }[] = [];
  for (const [k, label] of Object.entries(choices)) {
    const [caseId, question] = k.split("|");
    const cfg = keyOf.get(label);
    if (!cfg) continue;
    tally[question] ??= {};
    tally[question][cfg] = (tally[question][cfg] ?? 0) + 1;
    wins.push({ caseId, question, config: cfg });
  }
  return { tally, shown, wins, notes: Object.entries(choices).filter(([k]) => k.endsWith("|note")).map(([k, v]) => ({ caseId: k.split("|")[0], note: v })) };
}

function table(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "<p class=note>No results yet.</p>";
  const cols = Object.keys(rows[0]);
  return `<table><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr>${rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(String(r[c] ?? "–"))}</td>`).join("")}</tr>`).join("")}</table>`;
}

export function renderIntellect(out: string, cases: Case[]): void {
  const results = readResults(out).filter((r) => cases.some((c) => c.id === r.caseId));
  const keyOf = renderPrimary(out, cases, results);
  const s = summarize(cases, results, readJudgements(out));
  const owner = ownerChoices(keyOf);
  writeFileSync(`${out}report.json`, JSON.stringify({ ...s, owner }, null, 2));
  const legend = `<p class="note">${CONFIGS.filter((c) => results.some((r) => r.config === c.id)).map((c) => `<b>${c.id}</b> ${esc(c.name)}`).join(" · ")}</p>`;
  const ownerHtml = owner
    ? `<h2>Your choices</h2><p class="note">How often each configuration was chosen, per question, out of the questions where it was shown.</p>${table(
        Object.keys(owner.shown).map((cfg) => ({ config: cfg, shown: owner.shown[cfg], ...Object.fromEntries(Object.keys(owner.tally).map((q) => [q, owner.tally[q][cfg] ?? 0])) })),
      )}`
    : `<p class="note">Your primary choices aren't in yet. Paste them back and they appear here, with winning and losing examples.</p>`;
  const body = `<h1>Intellectual study: what the checks found</h1><p class="note">Automated checks, one quick call each. They flag; they never decide quality. Percentages are of the answers checked. Convergence compares each answer with the general-purpose answer to the same question (G for controlled, GS for end-to-end).</p>${legend}${ownerHtml}
<h2>All questions</h2>${table(s.overall)}
${Object.entries(s.byAdvisor).map(([a, rows]) => `<h2>${esc(a)}</h2>${table(rows)}`).join("")}
<h2>By kind of question</h2>${Object.entries(s.byKind).map(([k, rows]) => `<details><summary>${esc(k)}</summary>${table(rows)}</details>`).join("")}
<h2>Failed checks</h2>${table(s.failures.map((f) => ({ ...f, answer: f.answer.slice(0, 300) })))}
<h2>Flags: claimed experience, or details not in the messages</h2>${table(s.flags.map((f) => ({ key: f.key, claimedExperience: JSON.stringify(f.claimedExperience), unseen: JSON.stringify(f.unseen) })))}
<h2>Facts found wrong</h2>${table(s.wrongFacts)}
<h2>Different recommendations across runs</h2>${table(s.drift)}`;
  writeFileSync(`${out}report.html`, page("Cinq intellectual study: report", body));
}
