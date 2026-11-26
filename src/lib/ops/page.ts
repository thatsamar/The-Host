import type { Report, Spread } from "./report";
import { SMS_ADVISORS } from "@/lib/sms/navigation";

const esc = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const secs = (ms: number | null) => (ms === null ? "–" : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const usd = (n: number | null) => (n === null ? "–" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("en-US");
const advisorName = (id: string) => SMS_ADVISORS.find((a) => a.id === id)?.name ?? id;

function spreadRow(label: string, s: Spread, note = ""): string {
  return `<tr><td>${esc(label)}</td><td>${num(s.count)}</td><td>${secs(s.p50)}</td><td>${secs(s.p95)}</td><td>${secs(s.max)}</td><td class="note">${esc(note)}</td></tr>`;
}

function tile(label: string, value: string, sub = "", state: "ok" | "warn" | "bad" | "" = ""): string {
  return `<div class="tile ${state}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}

function pairs(map: Record<string, number>, name: (k: string) => string = (k) => k): string {
  const entries = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `<span class="chip">${esc(name(k))} <b>${num(v)}</b></span>`).join(" ") : `<span class="note">none</span>`;
}

/** The /ops page: aggregate operations only, nothing from any conversation. */
export function renderOpsPage(report: Report, opts: { days: number; recorded: boolean }): string {
  const r = report;
  const silentState = r.reliability.silent ? "bad" : "ok";
  const ackRate = pct(r.reliability.acked, r.reliability.questions);
  const tabs = [1, 7, 30]
    .map((d) => `<a href="?days=${d}" class="${d === opts.days ? "on" : ""}">${d === 1 ? "24 hours" : `${d} days`}</a>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Cinq Operations</title>
<style>
:root{--bg:#f5f6f4;--card:#fff;--fg:#1d2422;--muted:#5d6763;--line:#dce1de;--accent:#235f57;--ok:#2d6a3a;--warn:#8a5b10;--bad:#9a2f2c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121715;--card:#1a201e;--fg:#e3e8e5;--muted:#9aa5a0;--line:#2c3532;--accent:#7cc3b7;--ok:#8fd09c;--warn:#e3b56b;--bad:#ec9b96;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left,0px)) 60px max(16px,env(safe-area-inset-right,0px));display:grid;gap:28px}
h1{font-size:26px;margin:0}h2{font-size:17px;margin:0 0 10px}
.top{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between}
.tabs{display:flex;gap:6px}.tabs a{padding:5px 11px;border:1px solid var(--line);border-radius:999px;color:var(--fg);text-decoration:none;font-size:14px}.tabs a.on{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tile .label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.tile .value{font-size:24px;font-variant-numeric:tabular-nums}.tile .sub{font-size:13px;color:var(--muted)}
.tile.ok{border-left:4px solid var(--ok)}.tile.warn{border-left:4px solid var(--warn)}.tile.bad{border-left:4px solid var(--bad)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;min-width:560px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);font-size:14px}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:500}tr:last-child td{border-bottom:none}
.chip{display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 9px;margin:2px 0;font-size:13px}
.note{color:var(--muted);font-size:13px}.banner{background:var(--card);border:1px solid var(--bad);border-radius:10px;padding:12px 14px}
p{margin:0 0 6px;max-width:75ch}
</style></head><body><main>
<div class="top"><div><h1>Cinq Operations</h1><div class="note">Cinq by text, ${esc(r.from.slice(0, 16).replace("T", " "))} to ${esc(r.to.slice(0, 16).replace("T", " "))} UTC. Aggregates only: no words, photos or numbers.</div></div><nav class="tabs">${tabs}</nav></div>
${opts.recorded ? "" : `<div class="banner"><b>No records yet.</b> The baseline tables haven't been created, or nothing has been recorded in this window. Apply <code>supabase/migrations/20261126000001_sms_metrics.sql</code> in Supabase.</div>`}

<section><h2>At a glance</h2><div class="tiles">
${tile("Requests", num(r.usage.requests), `${num(r.usage.activeNumbers)} active numbers`)}
${tile("Answered", num(r.usage.answered), pct(r.usage.answered, r.usage.requests) + " of requests")}
${tile("Ended in silence", num(r.reliability.silent), "must be 0", silentState)}
${tile("Questions acknowledged", ackRate, `${num(r.reliability.acked)} of ${num(r.reliability.questions)}`, r.reliability.acked < r.reliability.questions ? "warn" : "ok")}
${tile("Ack submitted, p95", secs(r.latency.ack.p95), `median ${secs(r.latency.ack.p50)}`)}
${tile("Answer submitted, p95", secs(r.latency.answer.p95), `median ${secs(r.latency.answer.p50)}`)}
${tile("Delivery failures", num(r.delivery.failed), `of ${num(r.delivery.submitted)} texts`, r.delivery.failed ? "warn" : "ok")}
${tile("Model cost", usd(r.cost.modelUsd), r.cost.perAnsweredUsd === null ? "" : `${usd(r.cost.perAnsweredUsd)} per answer`)}
</div></section>

<section><h2>Latency</h2><p class="note">Measured from the moment the webhook reached us. "Submitted" means Twilio accepted the text; reaching the phone is carrier delivery, below.</p>
<div class="wrap"><table><thead><tr><th>Step</th><th>Count</th><th>Median</th><th>95th pct</th><th>Slowest</th><th></th></tr></thead><tbody>
${spreadRow("Acknowledgment submitted", r.latency.ack)}
${spreadRow("“Still thinking” submitted", r.latency.stillThinking, "only for slow answers")}
${spreadRow("Answer submitted", r.latency.answer)}
${spreadRow("Submitted → delivered (carrier)", r.latency.delivered, "from Twilio’s delivery reports")}
</tbody></table></div></section>

<section><h2>Reliability</h2>
<p>How requests ended: ${pairs(r.reliability.outcomes)}</p>
<p>Ended in silence: <b>${num(r.reliability.silent)}</b> (${num(r.reliability.silentErrors)} failed before any reply, ${num(r.reliability.unfinished)} never finished). Error classes: ${pairs(r.reliability.errorClasses)}</p>
<p>“Still thinking” sent: <b>${num(r.reliability.stillThinkingSent)}</b> · stalled: <b>${num(r.reliability.outcomes.stalled ?? 0)}</b> · fallback: <b>${num(r.reliability.outcomes.fallback ?? 0)}</b> · session save failures: <b>${num(r.reliability.saveFailures)}</b> · sends Twilio refused: <b>${num(r.reliability.sendFailures)}</b></p>
<p>Ignored: ${num(r.usage.duplicatesIgnored)} duplicate deliveries, ${num(r.usage.optedOutIgnored)} texts from opted-out numbers.</p>
<p class="note">Recovery (automatic retry and RETRY) isn’t built yet; it arrives with step A3, and its rate will show here.</p></section>

<section><h2>Delivery</h2>
<div class="wrap"><table><thead><tr><th>Kind</th><th>Submitted</th><th>Delivered</th><th>Failed</th><th>Delivered rate</th></tr></thead><tbody>
${Object.entries(r.delivery.byKind)
  .map(([k, v]) => `<tr><td>${esc(k.replace("_", " "))}</td><td>${num(v.submitted)}</td><td>${num(v.delivered)}</td><td>${num(v.failed)}</td><td>${pct(v.delivered, v.submitted)}</td></tr>`)
  .join("") || `<tr><td colspan="5" class="note">No texts in this window.</td></tr>`}
</tbody></table></div>
<p class="note">Still awaiting a report: ${num(r.delivery.pending)}. Twilio error codes: ${pairs(r.delivery.errorCodes)}</p></section>

<section><h2>Grouping baseline</h2>
<p>Against the approved starting windows (4 s after a photo, 1.5 s after a text). Nothing is grouped yet; this shows how often grouping would apply.</p>
<p>Photo-only texts: <b>${num(r.grouping.photoOnly)}</b>, followed within 4 s by another text: <b>${num(r.grouping.photoThenMore)}</b>. Texts followed by another within 1.5 s: <b>${num(r.grouping.textThenText)}</b> of ${num(r.grouping.textRequests)}.</p>
<p>Texts that arrived while the previous one was still being answered: <b>${num(r.grouping.overlaps)}</b>. Gaps between a number’s texts: ${pairs(r.grouping.gaps)}</p></section>

<section><h2>Usage and cost</h2>
<p>Answered by advisor: ${pairs(r.usage.byAdvisor, advisorName)} · photos received: <b>${num(r.usage.photos)}</b></p>
<p>Model calls: ${pairs(r.cost.modelCalls)} · web searches: <b>${num(r.cost.searches)}</b></p>
<p>Tokens: input ${num(r.cost.tokens.input)}, output ${num(r.cost.tokens.output)}, cache read ${num(r.cost.tokens.cacheRead)}, cache write ${num(r.cost.tokens.cacheWrite)}.</p>
<p>Estimated model cost <b>${usd(r.cost.modelUsd)}</b>${r.cost.unpricedCalls ? ` (${num(r.cost.unpricedCalls)} calls on an unlisted model counted in tokens only)` : ""}; SMS segments ${pairs(r.cost.segments, (k) => k.replace("_", " "))}${r.cost.smsUsd === null ? "" : ` ≈ <b>${usd(r.cost.smsUsd)}</b>`}.</p>
<p class="note">Model cost uses list prices (cache writes estimated); web searches and Twilio fees aren’t priced${r.cost.smsUsd === null ? " (set OPS_SMS_SEGMENT_USD to estimate SMS)" : ""}. Cost is tracked, never traded against the quality of an answer.</p></section>

<section><h2>Day by day (UTC)</h2>
<div class="wrap"><table><thead><tr><th>Day</th><th>Requests</th><th>Answered</th><th>Silent</th><th>Ack p95</th><th>Answer p95</th><th>Model cost</th></tr></thead><tbody>
${r.days.map((d) => `<tr><td>${esc(d.day)}</td><td>${num(d.requests)}</td><td>${num(d.answered)}</td><td>${num(d.silent)}</td><td>${secs(d.ackP95)}</td><td>${secs(d.answerP95)}</td><td>${usd(d.modelCost)}</td></tr>`).join("") || `<tr><td colspan="7" class="note">No requests in this window.</td></tr>`}
</tbody></table></div></section>
</main></body></html>`;
}
