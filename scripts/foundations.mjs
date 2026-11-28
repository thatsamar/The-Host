#!/usr/bin/env node
// Operator commands for the advisors' private foundations (docs/foundations.md).
// None of them ever prints foundation text: only advisors, layers, versions,
// checksum prefixes and counts.
//
//   node scripts/foundations.mjs publish --advisor tony --layer foundation --file <private.md> --approved-by <name> [--note <text>] [--provenance <file.json>]
//   node scripts/foundations.mjs activate --advisor tony --architecture c2 --identity <n> --foundation <n> [--layer2 <n>|none] --by <name>
//   node scripts/foundations.mjs activate --advisor tony --architecture legacy --by <name>
//   node scripts/foundations.mjs rollback --advisor tony --by <name>        (back to the configuration before the current one)
//   (The /ops foundations panel does the same and sets the audience; activate here keeps the stored audience.)
//   node scripts/foundations.mjs status
//   node scripts/foundations.mjs verify-lockdown                            (with the public key: every table refuses)
//   node scripts/foundations.mjs export --out <dir>                         (encrypted rows and a manifest; no text)
//   node scripts/foundations.mjs verify-restore --in <dir>                  (decrypts every exported version and checks its checksum)
//
// Settings, from the environment (never pasted on a command line):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY),
//   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (verify-lockdown only),
//   FOUNDATION_KEY, FOUNDATION_KEY_ID (and FOUNDATION_KEY_PREVIOUS / _ID after a rotation).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LAYERS = ["identity", "foundation", "foundation_l2"];
export const TABLES = ["advisor_layers", "advisor_active", "advisor_active_history", "advisor_events"];

export const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const aad = (advisorId, layer, version) => Buffer.from(`${advisorId}|${layer}|${version}`, "utf8");

/** The same scheme as src/lib/foundations/crypto.ts (tests/foundations-crypto.test.ts keeps them in step). */
export function seal(plaintext, key, where) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(aad(where.advisorId, where.layer, where.version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), key_id: key.id, sha256: sha256(plaintext) };
}

export function open(sealed, keys, where) {
  const key = keys.find((k) => k.id === sealed.key_id);
  if (!key) throw new Error("key_missing");
  const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(sealed.iv, "base64"));
  decipher.setAAD(aad(where.advisorId, where.layer, where.version));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  const text = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  if (sha256(text) !== sealed.sha256) throw new Error("checksum_mismatch");
  return text;
}

function keys() {
  const out = [];
  const k = process.env.FOUNDATION_KEY;
  if (k) out.push({ id: process.env.FOUNDATION_KEY_ID || "k1", key: Buffer.from(k, "base64") });
  if (process.env.FOUNDATION_KEY_PREVIOUS && process.env.FOUNDATION_KEY_PREVIOUS_ID) out.push({ id: process.env.FOUNDATION_KEY_PREVIOUS_ID, key: Buffer.from(process.env.FOUNDATION_KEY_PREVIOUS, "base64") });
  for (const x of out) if (x.key.length !== 32) fail("FOUNDATION_KEY must be 32 random bytes, base64 (openssl rand -base64 32)");
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
  return out;
}

async function client(secret = true) {
  const { createClient } = await import("@supabase/supabase-js");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = secret ? process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) fail(secret ? "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." : "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const short = (hex) => hex.slice(0, 12);

async function publish(a) {
  if (!a.advisor || !LAYERS.includes(a.layer) || !a.file || !a["approved-by"]) fail("publish needs --advisor, --layer (identity | foundation | foundation_l2), --file and --approved-by.");
  const [key] = keys();
  if (!key) fail("Set FOUNDATION_KEY and FOUNDATION_KEY_ID.");
  const text = readFileSync(a.file, "utf8").trim();
  if (!text) fail("The file is empty.");
  const provenance = a.provenance ? JSON.parse(readFileSync(a.provenance, "utf8")) : {};
  const db = await client();
  const { data: last, error: readError } = await db.from("advisor_layers").select("version").eq("advisor_id", a.advisor).eq("layer", a.layer).order("version", { ascending: false }).limit(1);
  if (readError) fail(`Couldn't read existing versions (${readError.code ?? "error"}).`);
  const version = (last?.[0]?.version ?? 0) + 1;
  const sealed = seal(text, key, { advisorId: a.advisor, layer: a.layer, version });
  // Check it opens before storing it.
  open(sealed, [key], { advisorId: a.advisor, layer: a.layer, version });
  const { error } = await db.from("advisor_layers").insert({ advisor_id: a.advisor, layer: a.layer, version, ...sealed, provenance, approved_by: a["approved-by"], approved_at: new Date().toISOString(), approval_note: a.note ?? null });
  if (error) fail(`Couldn't store it (${error.code ?? "error"}).`);
  console.log(`Published ${a.advisor} ${a.layer} v${version} (sha256 ${short(sealed.sha256)}…, key ${key.id}). Not active until activated.`);
}

const describe = (row) => (row ? (row.architecture === "c2" ? `c2 for ${row.audience === "owner" ? "the owner only" : "everyone"} (identity v${row.identity_version}, foundation v${row.foundation_version}, layer 2 ${row.layer2_version ? `v${row.layer2_version}` : "off"})` : "legacy") : "not configured (legacy)");

async function activate(a) {
  if (!a.advisor || !["legacy", "c2"].includes(a.architecture) || !a.by) fail("activate needs --advisor, --architecture (legacy | c2) and --by.");
  const db = await client();
  const row = { advisor_id: a.advisor, architecture: a.architecture, updated_by: a.by, updated_at: new Date().toISOString(), last_action: a.action ?? "activate", note: null, fallback_test_until: null };
  if (a.architecture === "c2") {
    const identity = Number(a.identity);
    const foundation = Number(a.foundation);
    const layer2 = a.layer2 && a.layer2 !== "none" ? Number(a.layer2) : null;
    if (!identity || !foundation) fail("c2 needs --identity <n> and --foundation <n>.");
    // Only approved versions that this deployment's keys can open.
    for (const [layer, version] of [["identity", identity], ["foundation", foundation], ...(layer2 ? [["foundation_l2", layer2]] : [])]) {
      const { data, error } = await db.from("advisor_layers").select("ciphertext, iv, tag, key_id, sha256, status").eq("advisor_id", a.advisor).eq("layer", layer).eq("version", version).maybeSingle();
      if (error || !data) fail(`${layer} v${version} isn't stored for ${a.advisor}.`);
      if (data.status !== "approved") fail(`${layer} v${version} is retired.`);
      try {
        open(data, keys(), { advisorId: a.advisor, layer, version });
      } catch (err) {
        fail(`${layer} v${version} doesn't open with these keys (${err.message}).`);
      }
    }
    Object.assign(row, { identity_version: identity, foundation_version: foundation, layer2_version: layer2 });
  } else Object.assign(row, { identity_version: null, foundation_version: null, layer2_version: null });
  const { data: before } = await db.from("advisor_active").select("*").eq("advisor_id", a.advisor).maybeSingle();
  const { error } = await db.from("advisor_active").upsert(row, { onConflict: "advisor_id" });
  if (error) fail(`Couldn't change it (${error.code ?? "error"}).`);
  console.log(`${a.advisor}: ${describe(before)} → ${describe(row)}. Live within 5 minutes.`);
}

async function rollback(a) {
  if (!a.advisor || !a.by) fail("rollback needs --advisor and --by.");
  const db = await client();
  const { data, error } = await db.from("advisor_active_history").select("*").eq("advisor_id", a.advisor).order("id", { ascending: false }).limit(300);
  if (error) fail(`Couldn't read the history (${error.code ?? "error"}).`);
  // Configurations only: uploads and fallback tests (from the /ops panel) aren't ones to go back to.
  const configs = (data ?? []).filter((h) => !["upload", "fallback_test_on", "fallback_test_off"].includes(h.action));
  const previous = configs[1];
  if (!previous) fail(`${a.advisor} has no earlier configuration; use activate --architecture legacy.`);
  await activate({ advisor: a.advisor, architecture: previous.architecture, identity: previous.identity_version, foundation: previous.foundation_version, layer2: previous.layer2_version ?? "none", by: a.by, action: "rollback" });
}

async function status() {
  const db = await client();
  const [{ data: active }, { data: layers }] = await Promise.all([db.from("advisor_active").select("*"), db.from("advisor_layers").select("advisor_id, layer, version, key_id, sha256, status, approved_by, approved_at")]);
  for (const r of active ?? []) console.log(`${r.advisor_id}: ${describe(r)}, changed ${r.updated_at} by ${r.updated_by}, last loaded ${r.last_loaded_at ?? "never"}`);
  for (const l of layers ?? []) console.log(`  ${l.advisor_id} ${l.layer} v${l.version} ${l.status}, key ${l.key_id}, sha256 ${short(l.sha256)}…, approved by ${l.approved_by} ${l.approved_at}`);
}

async function verifyLockdown() {
  const db = await client(false);
  let ok = true;
  for (const table of TABLES) {
    const read = await db.from(table).select("*").limit(1);
    const readable = !read.error && (read.data ?? []).length > 0;
    const write = await db.from(table).insert({ advisor_id: "lockdown-check" });
    // Only a permission error (42501) means refused: any other error got past the permission check.
    const writable = !write.error || write.error.code !== "42501";
    const readRefused = !!read.error && read.error.code === "42501";
    console.log(`${table}: read ${readable ? "ALLOWED" : readRefused ? "refused" : "returns nothing"}, write ${writable ? "ALLOWED" : "refused"}`);
    if (readable || writable) ok = false;
  }
  if (!ok) fail("The public key can reach the foundations: run the migration's lockdown again.");
  console.log("Locked down: the public key can't read or write any foundations table.");
}

async function exportAll(a) {
  if (!a.out) fail("export needs --out <dir>.");
  const db = await client();
  const { data, error } = await db.from("advisor_layers").select("advisor_id, layer, version, ciphertext, iv, tag, key_id, sha256, provenance, approved_by, approved_at, approval_note, status, created_at");
  if (error) fail(`Couldn't read the versions (${error.code ?? "error"}).`);
  const { data: history } = await db.from("advisor_active_history").select("*");
  mkdirSync(a.out, { recursive: true });
  writeFileSync(join(a.out, "advisor_layers.json"), JSON.stringify(data, null, 1));
  writeFileSync(join(a.out, "advisor_active_history.json"), JSON.stringify(history ?? [], null, 1));
  writeFileSync(join(a.out, "MANIFEST.json"), JSON.stringify({ exported_at: new Date().toISOString(), versions: data.length, sha256: data.map((r) => `${r.advisor_id}|${r.layer}|${r.version}|${r.sha256}`) }, null, 1));
  console.log(`Exported ${data.length} encrypted versions to ${a.out} (still encrypted; the key is not included).`);
}

function verifyRestore(a) {
  if (!a.in) fail("verify-restore needs --in <dir>.");
  const rows = JSON.parse(readFileSync(join(a.in, "advisor_layers.json"), "utf8"));
  const k = keys();
  let bad = 0;
  for (const r of rows) {
    try {
      open(r, k, { advisorId: r.advisor_id, layer: r.layer, version: r.version });
    } catch (err) {
      bad++;
      console.log(`${r.advisor_id} ${r.layer} v${r.version}: ${err.message}`);
    }
  }
  console.log(`${rows.length - bad} of ${rows.length} versions decrypt and match their checksums${readdirSync(a.in).includes("MANIFEST.json") ? "" : " (no manifest found)"}.`);
  if (bad) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const run = { publish, activate, rollback, status, "verify-lockdown": verifyLockdown, export: exportAll, "verify-restore": verifyRestore }[command];
  if (!run) fail("Commands: publish, activate, rollback, status, verify-lockdown, export, verify-restore (see the top of this file).");
  Promise.resolve(run(a)).catch((err) => fail(`Failed: ${err?.code ?? err?.name ?? "error"}`));
}
