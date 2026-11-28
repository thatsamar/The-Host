import type { PanelActive, PanelHistory, PanelLayer } from "@/lib/foundations/panel";
import { FALLBACK_TEST_MINUTES, isConfiguration } from "@/lib/foundations/panel";
import { SMS_ADVISORS } from "@/lib/sms/navigation";
import { esc, OPS_STYLE } from "./page";
import { HOME_SCREEN_TAGS } from "./session";

// The /ops foundations panel's page (docs/foundations.md). It shows each
// advisor's architecture, audience, versions (number, size, checksum
// prefix, provenance, note) and history, with the owner's actions. It never
// renders foundation text: the master copies live in the private repository.

export interface PanelView {
  active: PanelActive[];
  layers: PanelLayer[];
  history: PanelHistory[];
  settings: { enabled: boolean; keyId: string | null; ownerPhone: boolean };
  /** A fixed result code from the last action (never anything the owner typed). */
  message?: { kind: "done" | "error"; code: string };
  now: Date;
}

/** What each result code says. Fixed text only. */
export const MESSAGES: Record<string, string> = {
  uploaded: "Uploaded and encrypted. It isn't live until you activate it.",
  activated: "Activated. You see it at once; everyone else within 5 minutes.",
  rolled_back: "Rolled back. You see it at once; everyone else within 5 minutes.",
  emergency: "Switched to legacy for everyone. Live on this server now; on every server within 5 minutes.",
  test_on: `Fallback test on for ${FALLBACK_TEST_MINUTES} minutes: your own questions to this advisor fall back to legacy and are counted. Everyone else is unaffected.`,
  test_off: "Fallback test ended.",
  bad_origin: "That request didn't come from this page. Reload and try again.",
  bad_layer: "Choose a layer.",
  empty: "Paste the text or choose a file.",
  both: "Paste the text or choose a file, not both.",
  too_large: "That's larger than a foundation should be. Check the file.",
  not_text: "That file isn't plain text or Markdown.",
  key_missing: "FOUNDATION_KEY isn't set on this deployment.",
  version_missing: "One of those versions isn't stored for this advisor.",
  version_retired: "One of those versions is retired.",
  version_unreadable: "One of those versions doesn't open with this deployment's key. Nothing was changed.",
  version_taken: "Someone uploaded at the same moment. Try again.",
  bad_versions: "Choose an identity and a foundation version.",
  bad_audience: "Choose who gets it: you only, or everyone.",
  no_such_configuration: "That earlier configuration isn't in the history.",
  not_on_c2: "The fallback test needs the advisor on C2.",
  bad_advisor: "Unknown advisor.",
  store_failed: "The database didn't answer. Nothing may have changed: reload to check.",
  failed: "That didn't work. Reload to check what changed.",
};

const when = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "–");
const kb = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`);
const LAYER_NAMES: Record<string, string> = { identity: "Identity", foundation: "Foundation", foundation_l2: "Layer 2" };

function describeConfig(c: { architecture: string; identity_version: number | null; foundation_version: number | null; layer2_version: number | null; audience?: string | null }): string {
  if (c.architecture !== "c2") return "Legacy, for everyone";
  return `C2 for ${c.audience === "owner" ? "you only" : "everyone"} · identity v${c.identity_version}, foundation v${c.foundation_version}, layer 2 ${c.layer2_version ? `v${c.layer2_version}` : "off"}`;
}

const ACTION_NAMES: Record<string, string> = {
  activate: "Activated",
  rollback: "Rolled back",
  emergency_legacy: "Emergency: legacy for everyone",
  fallback_test_on: "Fallback test started",
  fallback_test_off: "Fallback test ended",
  upload: "Uploaded",
};

function versionLine(layers: PanelLayer[], advisor: string, layer: string, version: number | null): string {
  if (!version) return `<li>${LAYER_NAMES[layer]}: off</li>`;
  const v = layers.find((l) => l.advisor_id === advisor && l.layer === layer && l.version === version);
  if (!v) return `<li>${LAYER_NAMES[layer]} v${version} <span class="bad-text">not stored</span></li>`;
  const source = typeof v.provenance?.source === "string" ? v.provenance.source : "";
  return `<li>${LAYER_NAMES[layer]} <b>v${v.version}</b> · ${kb(v.bytes)} · <code>${esc(v.sha256.slice(0, 12))}…</code>${source ? ` · ${esc(source)}` : ""}${v.approval_note ? ` · <span class="note">${esc(v.approval_note)}</span>` : ""}</li>`;
}

function options(layers: PanelLayer[], advisor: string, layer: string, selected: number | null, none = false): string {
  const mine = layers.filter((l) => l.advisor_id === advisor && l.layer === layer && l.status === "approved");
  return `${none ? `<option value="none"${selected ? "" : " selected"}>Off</option>` : ""}${mine
    .map((l) => `<option value="${l.version}"${l.version === selected ? " selected" : ""}>v${l.version} · ${kb(l.bytes)} · ${esc(l.sha256.slice(0, 8))} · ${esc(when(l.approved_at))}</option>`)
    .join("")}`;
}

function advisorCard(view: PanelView, advisor: { id: string; name: string; category: string }): string {
  const a = view.active.find((x) => x.advisor_id === advisor.id);
  const row = a ?? { architecture: "legacy", identity_version: null, foundation_version: null, layer2_version: null, audience: "everyone" as const, fallback_test_until: null, last_action: null, note: null, updated_at: "", updated_by: "", last_loaded_at: null };
  const layers = view.layers.filter((l) => l.advisor_id === advisor.id);
  const history = view.history.filter((h) => h.advisor_id === advisor.id);
  const testing = !!row.fallback_test_until && Date.parse(row.fallback_test_until) > view.now.getTime();
  const hidden = `<input type="hidden" name="advisor" value="${esc(advisor.id)}">`;
  const form = (action: string, body: string, extra = "") => `<form method="post" action="/ops/foundations"${extra}>${hidden}<input type="hidden" name="action" value="${action}">${body}</form>`;
  const configs = history.filter(isConfiguration);
  const hasIdentity = layers.some((l) => l.layer === "identity" && l.status === "approved");
  const hasFoundation = layers.some((l) => l.layer === "foundation" && l.status === "approved");

  return `<section class="advisor" id="${esc(advisor.id)}">
<h2>${esc(advisor.name)} <span class="note">${esc(advisor.category)}</span></h2>
<div class="state ${row.architecture === "c2" ? (row.audience === "owner" ? "warn" : "ok") : ""}"><b>${esc(describeConfig(row))}</b>
${testing ? `<div class="bad-text">Fallback test on until ${esc(when(row.fallback_test_until))}</div>` : ""}
<div class="note">${a ? `Last change: ${esc(ACTION_NAMES[row.last_action ?? ""] ?? "changed")} ${esc(when(row.updated_at))} by ${esc(row.updated_by)}${row.note ? ` · ${esc(row.note)}` : ""} · last loaded ${esc(when(row.last_loaded_at))}` : "Never configured."}</div>
${row.architecture === "c2" ? `<ul class="versions">${versionLine(view.layers, advisor.id, "identity", row.identity_version)}${versionLine(view.layers, advisor.id, "foundation", row.foundation_version)}${versionLine(view.layers, advisor.id, "foundation_l2", row.layer2_version)}</ul>` : ""}
</div>

<div class="actions">
<details><summary>Upload a new version</summary>
${form(
  "upload",
  `<label>Layer <select name="layer" required><option value="identity">Identity</option><option value="foundation">Foundation</option><option value="foundation_l2">Layer 2 (experimental)</option></select></label>
<label>Paste the text <textarea name="text" rows="6" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Paste here, or choose a .md file below"></textarea></label>
<label>Or a file <input type="file" name="file" accept=".md,.markdown,.txt,text/markdown,text/plain"></label>
<label>Provenance <input name="provenance" maxlength="500" placeholder="e.g. interview, written refinement, AI-assisted"></label>
<label>Approval note <input name="note" maxlength="500" placeholder="What changed, and that you approve it"></label>
<button type="submit">Encrypt and store</button>
<p class="note">Encrypted on the server with this deployment's key and stored as a new version. It is never shown again here: keep the master copy in the private repository.</p>`,
  ` enctype="multipart/form-data"`,
)}
</details>

<details${hasIdentity && hasFoundation ? "" : " disabled"}><summary>Activate versions</summary>
${
  hasIdentity && hasFoundation
    ? form(
        "activate",
        `<label>Identity <select name="identity" required>${options(view.layers, advisor.id, "identity", row.identity_version)}</select></label>
<label>Foundation <select name="foundation" required>${options(view.layers, advisor.id, "foundation", row.foundation_version)}</select></label>
<label>Layer 2 <select name="layer2">${options(view.layers, advisor.id, "foundation_l2", row.layer2_version, true)}</select></label>
<fieldset><legend>Who gets it</legend><label class="inline"><input type="radio" name="audience" value="owner" ${row.audience === "everyone" && row.architecture === "c2" ? "" : "checked"}> You only (rehearsal)</label><label class="inline"><input type="radio" name="audience" value="everyone" ${row.audience === "everyone" && row.architecture === "c2" ? "checked" : ""}> Everyone</label></fieldset>
<label>Note <input name="note" maxlength="500" placeholder="Why"></label>
<button type="submit">Check and activate</button>
<p class="note">Each version is decrypted on the server first; if any fails, nothing changes.</p>`,
      )
    : `<p class="note">Upload an identity and a foundation first.</p>`
}
</details>

${
  row.architecture === "c2"
    ? form(
        testing ? "fallback_test_off" : "fallback_test_on",
        `<button type="submit" class="secondary">${testing ? "End the fallback test" : `Fallback test (${FALLBACK_TEST_MINUTES} minutes, you only)`}</button>`,
      )
    : ""
}
${
  row.architecture === "c2"
    ? form("emergency_legacy", `<button type="submit" class="danger">Emergency: legacy for everyone</button>`, ` onsubmit="return confirm('Switch ${esc(advisor.name)} to legacy for everyone now?')"`)
    : ""
}
</div>

<details><summary>Configuration history (${configs.length} to roll back to)</summary>
<div class="wrap"><table><thead><tr><th>When</th><th>What</th><th>Configuration</th><th>Note</th><th></th></tr></thead><tbody>
${
  history
    .map((h, i) => {
      const isCurrent = i === history.findIndex(isConfiguration);
      const back = isConfiguration(h) && !isCurrent ? form("rollback", `<input type="hidden" name="history" value="${h.id}"><button type="submit" class="secondary small">Roll back to this</button>`) : isCurrent ? `<span class="note">current</span>` : "";
      return `<tr><td>${esc(when(h.changed_at))}</td><td>${esc(ACTION_NAMES[h.action ?? ""] ?? "Changed")} <span class="note">by ${esc(h.updated_by)}</span></td><td>${esc(describeConfig(h))}</td><td class="note">${esc(h.note ?? "")}</td><td>${back}</td></tr>`;
    })
    .join("") || `<tr><td colspan="5" class="note">No changes yet.</td></tr>`
}
</tbody></table></div>
</details>

<details><summary>Stored versions (${layers.length})</summary>
<div class="wrap"><table><thead><tr><th>Layer</th><th>Version</th><th>Size</th><th>Checksum</th><th>Key</th><th>Approved</th><th>Provenance</th><th>Note</th></tr></thead><tbody>
${
  layers
    .map(
      (l) =>
        `<tr><td>${esc(LAYER_NAMES[l.layer] ?? l.layer)}</td><td>v${l.version}${l.status === "retired" ? ` <span class="note">retired</span>` : ""}</td><td>${kb(l.bytes)}</td><td><code>${esc(l.sha256.slice(0, 12))}…</code></td><td>${esc(l.key_id)}</td><td>${esc(when(l.approved_at))} by ${esc(l.approved_by)}</td><td class="note">${esc(typeof l.provenance?.source === "string" ? l.provenance.source : Object.keys(l.provenance ?? {}).length ? "recorded" : "")}</td><td class="note">${esc(l.approval_note ?? "")}</td></tr>`,
    )
    .join("") || `<tr><td colspan="8" class="note">None stored.</td></tr>`
}
</tbody></table></div>
</details>
</section>`;
}

export function renderFoundationsPanel(view: PanelView): string {
  const s = view.settings;
  const message = view.message ? `<div class="banner ${view.message.kind}" role="status">${esc(MESSAGES[view.message.code] ?? MESSAGES.failed)}</div>` : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Cinq Foundations</title>${HOME_SCREEN_TAGS}
${OPS_STYLE}
<style>
main{grid-template-columns:minmax(0,1fr)}main>*,details,.actions>*{min-width:0}.state,.banner,.summary li{overflow-wrap:anywhere}
.advisor{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;display:grid;gap:12px}
.state{border-left:4px solid var(--line);padding-left:12px}.state.ok{border-color:var(--ok)}.state.warn{border-color:var(--warn)}
.versions{margin:6px 0 0;padding-left:18px;font-size:14px}code{font-size:13px}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}.actions details{flex:1 1 100%}
form{display:grid;gap:10px;margin-top:10px}.actions>form{margin:0}
label{display:grid;gap:4px;font-size:13px;color:var(--muted)}label.inline{display:flex;gap:6px;align-items:center;color:var(--fg);font-size:15px}
fieldset{border:1px solid var(--line);border-radius:10px;padding:8px 12px;display:flex;flex-wrap:wrap;gap:16px}legend{font-size:13px;color:var(--muted)}
input,select,textarea{font:inherit;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);min-width:0}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:13px}
button{font:inherit;font-weight:600;padding:11px 14px;border:0;border-radius:10px;background:var(--accent);color:var(--bg);cursor:pointer}
button.secondary{background:var(--bg);color:var(--fg);border:1px solid var(--line)}button.danger{background:var(--bad);color:var(--bg)}button.small{padding:6px 10px;font-size:13px}
details[disabled] summary{color:var(--muted)}
.banner.done{border-color:var(--ok)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style></head><body><main>
<div class="top"><div><h1>Foundations</h1><div class="note">Each advisor's architecture and versions · never any foundation text</div></div><nav class="tabs"><a href="/ops">Dashboard</a><a href="/ops?signout=1">Sign out</a></nav></div>
${message}
<section class="summary"><h2>This deployment</h2><ul>
<li>Foundations ${s.enabled ? `<span class="ok-text">on</span>` : `<span class="bad-text">off</span> (FOUNDATIONS_ENABLED): every advisor answers on legacy whatever is set here`}</li>
<li>Foundation key ${s.keyId ? `<span class="ok-text">set</span> (id ${esc(s.keyId)})` : `<span class="bad-text">not set</span>: uploads and activation are refused`}</li>
<li>Owner's number for Cinq by text ${s.ownerPhone ? `<span class="ok-text">set</span>` : `<span class="bad-text">not set</span> (OWNER_PHONE): by text, "you only" reaches no one`}</li>
<li>On the website, "you only" means this browser while it is signed in here.</li>
<li>A change reaches your own questions at once and everyone else's within 5 minutes.</li>
</ul></section>
${SMS_ADVISORS.map((a) => advisorCard(view, a)).join("\n")}
</main></body></html>`;
}
