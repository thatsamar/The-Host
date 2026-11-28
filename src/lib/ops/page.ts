import type { FoundationsView } from "./foundations";
import { RECOVERY_WINDOW_MS, SILENT_AFTER_MS, type Report, type Spread } from "./report";
import { SMS_ADVISORS } from "@/lib/sms/navigation";
import { RETENTION_DAYS } from "@/lib/sms/metrics";
import { HOME_SCREEN_TAGS } from "./session";

export const esc = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const secs = (ms: number | null) => (ms === null ? "–" : ms < 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 1000)} s`);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const usd = (n: number | null) => (n === null ? "–" : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const num = (n: number) => n.toLocaleString("en-US");
const advisorName = (id: string) => {
  const a = SMS_ADVISORS.find((x) => x.id === id);
  return a ? `${a.name} (${a.category})` : id;
};
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "–");

function tile(label: string, value: string, sub = "", state: "ok" | "warn" | "bad" | "" = ""): string {
  return `<div class="tile ${state}"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;
}

function chips(map: Record<string, number>, name: (k: string) => string = (k) => k): string {
  const entries = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `<span class="chip">${esc(name(k))} <b>${num(v)}</b></span>`).join(" ") : `<span class="note">none</span>`;
}

function spreadRow(label: string, s: Spread, note = ""): string {
  return `<tr><td>${esc(label)}</td><td>${num(s.count)}</td><td>${secs(s.p50)}</td><td>${secs(s.p95)}</td><td>${secs(s.max)}</td><td class="note">${esc(note)}</td></tr>`;
}

/** The plain-language summary at the top: what a product owner would ask first. */
export function summaryLines(r: Report): string[] {
  const lines: string[] = [];
  if (!r.usage.requests) return ["No one texted Cinq in this period."];
  lines.push(
    `${num(r.adoption.people)} ${r.adoption.people === 1 ? "person" : "people"} used Cinq: ${num(r.adoption.newPeople)} new and ${num(r.adoption.returningPeople)} returning. ${num(r.adoption.repeatPeople)} came back on more than one day.`,
  );
  if (r.reliability.questions) {
    lines.push(
      `${pct(r.reliability.ackedWithinTarget, r.reliability.questions)} of questions were acknowledged within 2 seconds. Half of all answers went out within ${secs(r.latency.answer.p50)}, and 95% within ${secs(r.latency.answer.p95)}.`,
    );
  }
  lines.push(
    r.reliability.silent
      ? `${num(r.reliability.silent)} ${r.reliability.silent === 1 ? "request" : "requests"} ended in silence. That must be zero.`
      : "No request ended in silence.",
  );
  if (r.recovery.problems) {
    lines.push(`${num(r.recovery.problems)} ${r.recovery.problems === 1 ? "request" : "requests"} went wrong; in ${num(r.recovery.recovered)} of them the person had an answer within 30 minutes.`);
  } else {
    lines.push("Nothing went wrong.");
  }
  const perRequest = (r.cost.modelUsd + (r.cost.smsUsd ?? 0)) / r.usage.requests;
  lines.push(`Serving each request cost about ${usd(perRequest)}${r.cost.smsUsd === null ? " in AI use (texting fees not included)" : ", AI and texting together"}.`);
  return lines;
}

/** The /ops page: aggregates only, never anything from a conversation. */
/** Each advisor's architecture: labels, versions and counts only (src/lib/ops/foundations.ts). */
function foundationsSection(view: FoundationsView | undefined): string {
  if (!view) return "";
  if (!view.available) return `<section><h2>Advisor architecture</h2><p class="note">Not set up on this project yet: every advisor runs on the current architecture.</p></section>`;
  const rows = view.advisors
    .map((a) => {
      const reasons = Object.entries(a.reasons).map(([k, v]) => `${k} ${v}`).join(", ");
      const alert = a.unavailable24h ? ' class="bad-text"' : a.fallbacks24h ? ' class="bad-text"' : "";
      return `<tr><td>${esc(a.advisor)}</td><td>${esc(a.architecture)}${a.audience ? ` <span class="note">(${esc(a.audience)})</span>` : ""}${a.fallbackTest ? ` <span class="bad-text">fallback test</span>` : ""}</td><td>${esc(a.versions)}</td><td>${esc(a.lastLoaded ?? "")}</td><td${alert}>${num(a.fallbacks24h)}${reasons ? ` <span class="note">(${esc(reasons)})</span>` : ""}</td><td${a.unavailable24h ? ' class="bad-text"' : ""}>${num(a.unavailable24h)}</td><td>${num(a.leakGuard24h)}</td><td class="note">${esc(a.updated)}</td></tr>`;
    })
    .join("");
  const costs = view.costs
    .map((c) => `<tr><td>${esc(c.architecture)}</td><td>${num(c.answers)}</td><td>${secs(c.medianMs)}</td><td>${c.costPerAnswer === null ? "" : usd(c.costPerAnswer)}</td></tr>`)
    .join("");
  return `<section><h2>Advisor architecture</h2><p class="note">Which architecture each advisor answers on, and whether its private foundation loaded. A fallback means the advisor answered on its current architecture because its foundation couldn't be loaded; unavailable means that lasted past the threshold. Counts are for the last 24 hours. No foundation text is ever shown here. <a href="/ops/foundations">Manage foundations</a>: upload, activate, roll back, emergency legacy, fallback test.</p>
<div class="wrap"><table><thead><tr><th>Advisor</th><th>Architecture</th><th>Versions</th><th>Last loaded (UTC)</th><th>Fallbacks</th><th>Unavailable</th><th>Leak guard</th><th>Changed</th></tr></thead><tbody>
${rows || `<tr><td colspan="8" class="note">No advisor configured: all on the current architecture.</td></tr>`}
</tbody></table></div>
<h3>By architecture (Cinq by text, this period)</h3>
<div class="wrap"><table><thead><tr><th>Architecture</th><th>Answers</th><th>Median answer time</th><th>AI cost per answer</th></tr></thead><tbody>
${costs || `<tr><td colspan="4" class="note">None.</td></tr>`}
</tbody></table></div></section>`;
}

/** The dashboard's styles, shared with the foundations panel. */
export const OPS_STYLE = `<style>
:root{--bg:#f5f6f4;--card:#fff;--fg:#1d2422;--muted:#5d6763;--line:#dce1de;--accent:#235f57;--ok:#2d6a3a;--warn:#8a5b10;--bad:#9a2f2c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121715;--card:#1a201e;--fg:#e3e8e5;--muted:#9aa5a0;--line:#2c3532;--accent:#7cc3b7;--ok:#8fd09c;--warn:#e3b56b;--bad:#ec9b96;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:28px max(16px,env(safe-area-inset-left,0px)) 60px max(16px,env(safe-area-inset-right,0px));display:grid;gap:30px}
h1{font-size:26px;margin:0}h2{font-size:19px;margin:0 0 4px}h3{font-size:15px;margin:14px 0 6px}
.top{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between}
.tabs{display:flex;gap:6px}.tabs a{padding:5px 11px;border:1px solid var(--line);border-radius:999px;color:var(--fg);text-decoration:none;font-size:14px}.tabs a.on{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.summary{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}.summary ul{margin:0;padding-left:20px;display:grid;gap:6px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:10px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.tile .label{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}.tile .value{font-size:24px;font-variant-numeric:tabular-nums}.tile .sub{font-size:13px;color:var(--muted)}
.tile.ok{border-left:4px solid var(--ok)}.tile.warn{border-left:4px solid var(--warn)}.tile.bad{border-left:4px solid var(--bad)}
.wrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;margin-top:8px}
table{border-collapse:collapse;width:100%;min-width:520px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--line);font-size:14px}th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;font-weight:500}tr:last-child td{border-bottom:none}
.chip{display:inline-block;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:2px 9px;margin:2px 0;font-size:13px}
.note{color:var(--muted);font-size:13px}.banner{background:var(--card);border:1px solid var(--bad);border-radius:10px;padding:12px 14px}
.bad-text{color:var(--bad);font-weight:600}.ok-text{color:var(--ok);font-weight:600}
p{margin:6px 0;max-width:78ch}details{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 16px}summary{cursor:pointer;font-weight:600}
</style>`;

export function renderOpsPage(report: Report, opts: { days: number; recorded: boolean; foundations?: FoundationsView }): string {
  const r = report;
  const tabs = [1, 7, 30]
    .map((d) => `<a href="?days=${d}" class="${d === opts.days ? "on" : ""}">${d === 1 ? "24 hours" : `${d} days`}</a>`)
    .join("");
  const perRequest = r.usage.requests ? (r.cost.modelUsd + (r.cost.smsUsd ?? 0)) / r.usage.requests : null;
  const missingIn = r.measurement.days.reduce((n, d) => n + Math.max(0, (d.twilioIn ?? 0) - d.recordedIn), 0);
  const missingOut = r.measurement.days.reduce((n, d) => n + Math.max(0, (d.twilioOut ?? 0) - d.recordedOut), 0);
  const measurementOk = r.measurement.twilioReachable && missingIn === 0 && missingOut === 0 && r.measurement.deliveryReportsMissing === 0;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Cinq Operations</title>${HOME_SCREEN_TAGS}
${OPS_STYLE}</head><body><main>
<div class="top"><div><h1>Cinq Operations</h1><div class="note">Cinq by text · ${esc(day(r.from))} to ${esc(day(r.to))} (UTC) · records since ${esc(day(r.recordsSince))} · aggregates only: no words, photos or phone numbers</div></div><nav class="tabs">${tabs}<a href="?signout=1">Sign out</a></nav></div>
${opts.recorded ? "" : `<div class="banner"><b>No records yet.</b> Either the measurement tables haven't been created, or no one texted in this period.</div>`}

<section class="summary"><h2>In short</h2><ul>${summaryLines(r).map((l) => `<li>${esc(l)}</li>`).join("")}</ul></section>

<section><h2>Adoption</h2><p class="note">Is Cinq becoming part of people's lives? A person is one phone number; "returning" means they had texted before this period (as far back as records go).</p>
<div class="tiles">
${tile("People", num(r.adoption.people), "texted Cinq")}
${tile("New", num(r.adoption.newPeople), "first time")}
${tile("Returning", num(r.adoption.returningPeople), "had texted before")}
${tile("Came back", num(r.adoption.repeatPeople), "on 2 or more days")}
${tile("Requests per person", r.adoption.medianRequestsPerPerson === null ? "–" : num(r.adoption.medianRequestsPerPerson), "median")}
</div>
<h3>Advisors</h3>
<div class="wrap"><table><thead><tr><th>Advisor</th><th>People</th><th>Answers</th></tr></thead><tbody>
${SMS_ADVISORS.map((a) => `<tr><td>${esc(advisorName(a.id))}</td><td>${num(r.adoption.peopleByAdvisor[a.id] ?? 0)}</td><td>${num(r.usage.byAdvisor[a.id] ?? 0)}</td></tr>`).join("")}
</tbody></table></div>
<h3>Week by week</h3>
<div class="wrap"><table><thead><tr><th>Week of</th><th>People</th><th>New</th><th>Returning</th><th>Requests</th></tr></thead><tbody>
${r.adoption.weekly.map((w) => `<tr><td>${esc(day(`${w.week}T00:00:00Z`))}</td><td>${num(w.people)}</td><td>${num(w.newPeople)}</td><td>${num(w.returningPeople)}</td><td>${num(w.requests)}</td></tr>`).join("") || `<tr><td colspan="5" class="note">No weeks recorded yet.</td></tr>`}
</tbody></table></div></section>

<section><h2>Reliability</h2><p class="note">Does Cinq answer, quickly, every time? Times run from the moment a text reached Cinq to the moment Twilio accepted the reply. Reaching the phone takes a few seconds more; that is shown below.</p>
<div class="tiles">
${tile("Acknowledged within 2 s", pct(r.reliability.ackedWithinTarget, r.reliability.questions), `median ${secs(r.latency.ack.p50)}`, r.reliability.questions && r.reliability.ackedWithinTarget < r.reliability.questions ? "warn" : "ok")}
${tile("Typical answer", secs(r.latency.answer.p50), `95% within ${secs(r.latency.answer.p95)}`)}
${tile("Ended in silence", num(r.reliability.silent), "must be 0", r.reliability.silent ? "bad" : "ok")}
${tile("Went wrong", num(r.recovery.problems), r.recovery.problems ? `${pct(r.recovery.recovered, r.recovery.problems)} recovered` : "nothing", r.recovery.problems ? "warn" : "ok")}
${tile("Reached phones", pct(r.delivery.delivered, r.delivery.delivered + r.delivery.failed), `${num(r.delivery.failed)} failed`, r.delivery.failed ? "warn" : "ok")}
</div>
<h3>What went wrong</h3>
<p>${chips(r.recovery.byKind)}</p>
<p class="note">"Recovered" means the same person had an answer within ${RECOVERY_WINDOW_MS / 60_000} minutes, today because they tried again. Automatic recovery and RETRY come with step A3, and will show here. "Ended in silence" counts requests that failed before any reply, or were still open ${SILENT_AFTER_MS / 60_000} minutes later. That is a measure taken after the fact, not how fast a person is told: telling people within seconds is part of step A3.</p></section>

<section><h2>Cost</h2><p class="note">What it costs to serve Cinq. Tracked, never traded against the quality of an answer.</p>
<div class="tiles">
${tile("Per request", usd(perRequest), r.cost.smsUsd === null ? "AI only" : "AI and texting")}
${tile("Per answer", usd(r.cost.perAnsweredUsd))}
${tile("AI, this period", usd(r.cost.modelUsd), `${num(Object.values(r.cost.modelCalls).reduce((a, b) => a + b, 0))} model calls`)}
${tile("Texting, this period", r.cost.smsUsd === null ? "not priced" : usd(r.cost.smsUsd), `${num(Object.values(r.cost.segments).reduce((a, b) => a + b, 0))} segments`)}
</div>
<p class="note">AI cost uses list prices (cache writes estimated); web searches aren't priced.</p></section>

<section><h2>Is the measurement complete?</h2><p class="note">This dashboard is only as good as its records. Each day, Twilio's own count of texts is checked against what Cinq recorded, so a lost record shows as a gap instead of a quiet day.</p>
<p>${
    !r.measurement.twilioReachable
      ? `<span class="bad-text">Couldn't check against Twilio.</span> Its counts were unavailable this time.`
      : measurementOk
        ? `<span class="ok-text">Complete.</span> Every text Twilio handled on these days was recorded.`
        : `<span class="bad-text">Records missing:</span> ${num(missingIn)} incoming and ${num(missingOut)} outgoing texts that Twilio handled aren't recorded, and ${num(r.measurement.deliveryReportsMissing)} delivery reports never arrived.`
  }</p>
${
  r.measurement.days.length
    ? `<div class="wrap"><table><thead><tr><th>Day</th><th>Texts in (Twilio)</th><th>Recorded</th><th>Texts out (Twilio)</th><th>Recorded</th></tr></thead><tbody>
${r.measurement.days.map((d) => `<tr><td>${esc(day(`${d.day}T00:00:00Z`))}</td><td>${d.twilioIn === null ? "–" : num(d.twilioIn)}</td><td>${num(d.recordedIn)}</td><td>${d.twilioOut === null ? "–" : num(d.twilioOut)}</td><td>${num(d.recordedOut)}</td></tr>`).join("")}
</tbody></table></div>`
    : ""
}
<p class="note">A request whose final record was lost counts as "ended in silence", so a lost record can make reliability look worse, never better. Twilio's outgoing count can include its own automatic STOP and HELP replies. Records are deleted after ${RETENTION_DAYS} days.</p></section>

${foundationsSection(opts.foundations)}

<details><summary>Engineering detail</summary>
<h3>Latency</h3>
<div class="wrap"><table><thead><tr><th>Step</th><th>Count</th><th>Median</th><th>95%</th><th>Slowest</th><th></th></tr></thead><tbody>
${spreadRow("Acknowledgment submitted", r.latency.ack)}
${spreadRow("“Still thinking” submitted", r.latency.stillThinking, "slow answers only")}
${spreadRow("Answer submitted", r.latency.answer)}
${spreadRow("Submitted → delivered", r.latency.delivered, "carrier, from Twilio’s reports")}
</tbody></table></div>
<h3>Outcomes</h3><p>${chips(r.reliability.outcomes)}</p>
<p>Error classes: ${chips(r.reliability.errorClasses)} · session save failures ${num(r.reliability.saveFailures)} · sends Twilio refused ${num(r.reliability.sendFailures)} · duplicates ignored ${num(r.usage.duplicatesIgnored)} · from opted-out numbers ${num(r.usage.optedOutIgnored)}</p>
<h3>Delivery by kind</h3>
<div class="wrap"><table><thead><tr><th>Kind</th><th>Submitted</th><th>Delivered</th><th>Failed</th></tr></thead><tbody>
${Object.entries(r.delivery.byKind).map(([k, v]) => `<tr><td>${esc(k.replace("_", " "))}</td><td>${num(v.submitted)}</td><td>${num(v.delivered)}</td><td>${num(v.failed)}</td></tr>`).join("") || `<tr><td colspan="4" class="note">None.</td></tr>`}
</tbody></table></div>
<p>Twilio error codes: ${chips(r.delivery.errorCodes)} · awaiting a report: ${num(r.delivery.pending)}</p>
<h3>Grouping baseline</h3>
<p>Photo-only texts ${num(r.grouping.photoOnly)}, followed within 4 s by another text: ${num(r.grouping.photoThenMore)}. Texts followed by another within 1.5 s: ${num(r.grouping.textThenText)} of ${num(r.grouping.textRequests)}. Texts arriving while the previous one was still being answered: ${num(r.grouping.overlaps)}. Gaps: ${chips(r.grouping.gaps)}</p>
<h3>Model use</h3>
<p>Calls ${chips(r.cost.modelCalls)} · web searches ${num(r.cost.searches)} · tokens in ${num(r.cost.tokens.input)}, out ${num(r.cost.tokens.output)}, cache read ${num(r.cost.tokens.cacheRead)}, cache write ${num(r.cost.tokens.cacheWrite)}${r.cost.unpricedCalls ? ` · ${num(r.cost.unpricedCalls)} calls on an unlisted model` : ""}</p>
<h3>Day by day (UTC)</h3>
<div class="wrap"><table><thead><tr><th>Day</th><th>Requests</th><th>Answered</th><th>Silent</th><th>Ack 95%</th><th>Answer 95%</th><th>AI cost</th></tr></thead><tbody>
${r.days.map((d) => `<tr><td>${esc(d.day)}</td><td>${num(d.requests)}</td><td>${num(d.answered)}</td><td>${num(d.silent)}</td><td>${secs(d.ackP95)}</td><td>${secs(d.answerP95)}</td><td>${usd(d.modelCost)}</td></tr>`).join("") || `<tr><td colspan="7" class="note">None.</td></tr>`}
</tbody></table></div>
</details>
</main></body></html>`;
}
