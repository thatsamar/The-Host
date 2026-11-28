import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { keysFrom, open, seal, type FoundationKey, type SealedLayer } from "./crypto";
import type { ArchitectureId, Audience, FoundationLayer } from "./types";

// The /ops foundations panel's reads and actions (docs/foundations.md). The
// owner uploads, activates, rolls back, switches to legacy in an emergency
// and runs the fallback test here. Text goes one way only: an upload is
// encrypted on the server with FOUNDATION_KEY and stored; nothing here ever
// returns, renders or logs it (only versions, sizes and checksum prefixes).
// Every action is recorded in advisor_active_history with updated_by 'owner'.

export const LAYERS: FoundationLayer[] = ["identity", "foundation", "foundation_l2"];
/** The largest version the panel accepts (characters). */
export const MAX_LAYER_CHARS = 400_000;
/** How long the fallback test lasts unless it is ended sooner. */
export const FALLBACK_TEST_MINUTES = 10;

export type PanelAction = "activate" | "rollback" | "emergency_legacy" | "fallback_test_on" | "fallback_test_off" | "upload";

export interface PanelActive {
  advisor_id: string;
  architecture: ArchitectureId;
  identity_version: number | null;
  foundation_version: number | null;
  layer2_version: number | null;
  audience: Audience;
  fallback_test_until: string | null;
  last_action: string | null;
  note: string | null;
  updated_by: string;
  updated_at: string;
  last_loaded_at: string | null;
}

/** A stored version, as the panel shows it: never its text. */
export interface PanelLayer {
  advisor_id: string;
  layer: FoundationLayer;
  version: number;
  status: "approved" | "retired";
  key_id: string;
  sha256: string;
  /** Bytes of the encrypted text (the same as the text's own size). */
  bytes: number;
  provenance: Record<string, unknown> | null;
  approved_by: string;
  approved_at: string;
  approval_note: string | null;
}

export interface PanelHistory {
  id: number;
  advisor_id: string;
  architecture: ArchitectureId;
  identity_version: number | null;
  foundation_version: number | null;
  layer2_version: number | null;
  audience: Audience | null;
  fallback_test_until: string | null;
  action: string | null;
  note: string | null;
  updated_by: string;
  changed_at: string;
}

export interface PanelStore {
  active(): Promise<PanelActive[]>;
  layers(): Promise<PanelLayer[]>;
  history(): Promise<PanelHistory[]>;
  historyRow(id: number): Promise<PanelHistory | null>;
  sealed(advisorId: string, layer: FoundationLayer, version: number): Promise<(SealedLayer & { status: string }) | null>;
  latestVersion(advisorId: string, layer: FoundationLayer): Promise<number>;
  insertLayer(row: Record<string, unknown>): Promise<void>;
  /** Writes the advisor's configuration (the history trigger records it). */
  upsertActive(row: Record<string, unknown>): Promise<void>;
  insertHistory(row: Record<string, unknown>): Promise<void>;
}

export class PanelError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PanelError";
  }
}

const TIMEOUT_MS = 5_000;
const fail = (error: { code?: string } | null) => {
  if (error) throw new PanelError("store_failed");
};

export class SupabasePanelStore implements PanelStore {
  constructor(private db: SupabaseClient) {}

  async active() {
    const { data, error } = await this.db.from("advisor_active").select("*").abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    fail(error);
    return (data ?? []).map((r) => ({ audience: "everyone", fallback_test_until: null, last_action: null, note: null, ...r })) as PanelActive[];
  }

  async layers() {
    const { data, error } = await this.db
      .from("advisor_layers")
      .select("advisor_id, layer, version, status, key_id, sha256, ciphertext, provenance, approved_by, approved_at, approval_note")
      .order("version", { ascending: false })
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    fail(error);
    // The ciphertext is read only for its size, and dropped here.
    return (data ?? []).map(({ ciphertext, ...r }) => ({ ...r, bytes: Buffer.from(String(ciphertext), "base64").length })) as PanelLayer[];
  }

  async history() {
    const { data, error } = await this.db.from("advisor_active_history").select("*").order("id", { ascending: false }).limit(300).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    fail(error);
    return (data ?? []) as PanelHistory[];
  }

  async historyRow(id: number) {
    const { data, error } = await this.db.from("advisor_active_history").select("*").eq("id", id).maybeSingle();
    fail(error);
    return (data as PanelHistory | null) ?? null;
  }

  async sealed(advisorId: string, layer: FoundationLayer, version: number) {
    const { data, error } = await this.db.from("advisor_layers").select("ciphertext, iv, tag, key_id, sha256, status").eq("advisor_id", advisorId).eq("layer", layer).eq("version", version).maybeSingle();
    fail(error);
    return (data as (SealedLayer & { status: string }) | null) ?? null;
  }

  async latestVersion(advisorId: string, layer: FoundationLayer) {
    const { data, error } = await this.db.from("advisor_layers").select("version").eq("advisor_id", advisorId).eq("layer", layer).order("version", { ascending: false }).limit(1);
    fail(error);
    return (data?.[0] as { version: number } | undefined)?.version ?? 0;
  }

  async insertLayer(row: Record<string, unknown>) {
    const { error } = await this.db.from("advisor_layers").insert(row);
    // A unique violation means two uploads raced for the same version number.
    if (error) throw new PanelError(error.code === "23505" ? "version_taken" : "store_failed");
  }

  async upsertActive(row: Record<string, unknown>) {
    const { error } = await this.db.from("advisor_active").upsert(row, { onConflict: "advisor_id" });
    fail(error);
  }

  async insertHistory(row: Record<string, unknown>) {
    const { error } = await this.db.from("advisor_active_history").insert(row);
    fail(error);
  }
}

/** The panel's store: the service-role client (tests swap `make`). */
export const panelStore: { make: () => PanelStore | null } = {
  make: () => {
    const admin = createAdminClient();
    return admin ? new SupabasePanelStore(admin) : null;
  },
};

export interface PanelDeps {
  store: PanelStore;
  /** This deployment's foundation keys (keysFrom(foundationsEnv())). */
  keys: FoundationKey[];
  /** Called after any change, so this instance reloads the advisor (others follow within the cache's five minutes). */
  invalidate: (advisorId: string) => void;
  now?: () => Date;
}

const isLayer = (v: unknown): v is FoundationLayer => typeof v === "string" && (LAYERS as string[]).includes(v);
const versionOf = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const shortText = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** That a stored, approved version opens with this deployment's keys, without keeping its text. */
async function verify(deps: PanelDeps, advisorId: string, layer: FoundationLayer, version: number): Promise<void> {
  const sealed = await deps.store.sealed(advisorId, layer, version);
  if (!sealed) throw new PanelError("version_missing");
  if (sealed.status !== "approved") throw new PanelError("version_retired");
  if (!deps.keys.length) throw new PanelError("key_missing");
  try {
    open(sealed, deps.keys, { advisorId, layer, version });
  } catch {
    throw new PanelError("version_unreadable");
  }
}

async function current(deps: PanelDeps, advisorId: string): Promise<PanelActive | null> {
  return (await deps.store.active()).find((a) => a.advisor_id === advisorId) ?? null;
}

/** Encrypts and stores a new version. The text is used here and nowhere else; the result carries only its number. */
export async function uploadVersion(deps: PanelDeps, input: { advisorId: string; layer: unknown; text: string; provenance?: unknown; note?: unknown }): Promise<{ version: number; sha256: string; bytes: number }> {
  if (!isLayer(input.layer)) throw new PanelError("bad_layer");
  const text = input.text.replace(/\r\n/g, "\n").trim();
  if (!text) throw new PanelError("empty");
  if (text.length > MAX_LAYER_CHARS) throw new PanelError("too_large");
  const [key] = deps.keys;
  if (!key) throw new PanelError("key_missing");
  const version = (await deps.store.latestVersion(input.advisorId, input.layer)) + 1;
  const where = { advisorId: input.advisorId, layer: input.layer, version };
  const sealed = seal(text, key, where);
  // Check it opens before storing it.
  open(sealed, [key], where);
  const now = (deps.now?.() ?? new Date()).toISOString();
  const provenance = shortText(input.provenance);
  const note = shortText(input.note);
  await deps.store.insertLayer({ advisor_id: input.advisorId, layer: input.layer, version, ...sealed, provenance: provenance ? { source: provenance } : {}, approved_by: "owner", approved_at: now, approval_note: note || null });
  const row = await current(deps, input.advisorId);
  await deps.store.insertHistory({
    advisor_id: input.advisorId,
    architecture: row?.architecture ?? "legacy",
    identity_version: row?.identity_version ?? null,
    foundation_version: row?.foundation_version ?? null,
    layer2_version: row?.layer2_version ?? null,
    audience: row?.audience ?? "everyone",
    action: "upload",
    note: `${input.layer} v${version} uploaded${note ? `: ${note}` : ""}`.slice(0, 500),
    updated_by: "owner",
  });
  return { version, sha256: sealed.sha256, bytes: Buffer.byteLength(text, "utf8") };
}

/** Puts the advisor on C2 with these versions for this audience, once each version is checked to open. */
export async function activate(deps: PanelDeps, input: { advisorId: string; identity: unknown; foundation: unknown; layer2?: unknown; audience: unknown; note?: unknown; action?: PanelAction }): Promise<void> {
  const identity = versionOf(input.identity);
  const foundation = versionOf(input.foundation);
  const layer2 = input.layer2 === undefined || input.layer2 === null || input.layer2 === "" || input.layer2 === "none" ? null : versionOf(input.layer2);
  if (!identity || !foundation || (input.layer2 && input.layer2 !== "none" && layer2 === null)) throw new PanelError("bad_versions");
  if (input.audience !== "owner" && input.audience !== "everyone") throw new PanelError("bad_audience");
  await verify(deps, input.advisorId, "identity", identity);
  await verify(deps, input.advisorId, "foundation", foundation);
  if (layer2) await verify(deps, input.advisorId, "foundation_l2", layer2);
  await deps.store.upsertActive({
    advisor_id: input.advisorId,
    architecture: "c2",
    identity_version: identity,
    foundation_version: foundation,
    layer2_version: layer2,
    audience: input.audience,
    fallback_test_until: null,
    last_action: input.action ?? "activate",
    note: shortText(input.note) || null,
    updated_by: "owner",
    updated_at: (deps.now?.() ?? new Date()).toISOString(),
  });
  deps.invalidate(input.advisorId);
}

/** The current architecture for everyone, at once. */
export async function emergencyLegacy(deps: PanelDeps, input: { advisorId: string; note?: unknown; action?: PanelAction }): Promise<void> {
  await deps.store.upsertActive({
    advisor_id: input.advisorId,
    architecture: "legacy",
    identity_version: null,
    foundation_version: null,
    layer2_version: null,
    audience: "everyone",
    fallback_test_until: null,
    last_action: input.action ?? "emergency_legacy",
    note: shortText(input.note) || null,
    updated_by: "owner",
    updated_at: (deps.now?.() ?? new Date()).toISOString(),
  });
  deps.invalidate(input.advisorId);
}

/** Back to an earlier configuration from the history, in one step (C2 versions checked first). */
export async function rollbackTo(deps: PanelDeps, input: { advisorId: string; historyId: unknown }): Promise<void> {
  const id = versionOf(input.historyId);
  const row = id ? await deps.store.historyRow(id) : null;
  if (!row || row.advisor_id !== input.advisorId || !isConfiguration(row)) throw new PanelError("no_such_configuration");
  const note = `rolled back to change #${row.id}`;
  if (row.architecture === "legacy") return emergencyLegacy(deps, { advisorId: input.advisorId, note, action: "rollback" });
  await activate(deps, { advisorId: input.advisorId, identity: row.identity_version, foundation: row.foundation_version, layer2: row.layer2_version ?? "none", audience: row.audience ?? "everyone", note, action: "rollback" });
}

/** Starts or ends the owner's fallback test: while on, the owner's loads fail on purpose. Ends by itself after FALLBACK_TEST_MINUTES. */
export async function fallbackTest(deps: PanelDeps, input: { advisorId: string; on: boolean }): Promise<void> {
  const row = await current(deps, input.advisorId);
  if (!row || row.architecture !== "c2") throw new PanelError("not_on_c2");
  const now = deps.now?.() ?? new Date();
  await deps.store.upsertActive({
    ...withoutLoad(row),
    fallback_test_until: input.on ? new Date(now.getTime() + FALLBACK_TEST_MINUTES * 60_000).toISOString() : null,
    last_action: input.on ? "fallback_test_on" : "fallback_test_off",
    note: null,
    updated_by: "owner",
    updated_at: now.toISOString(),
  });
  deps.invalidate(input.advisorId);
}

/** The configuration to write back: everything but the app's own load time. */
const withoutLoad = (row: PanelActive): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...row };
  delete rest.last_loaded_at;
  return rest;
};

/** A history row that is a configuration one can roll back to (not an upload or a fallback test). */
export function isConfiguration(row: PanelHistory): boolean {
  if (row.action === "upload" || row.action === "fallback_test_on" || row.action === "fallback_test_off") return false;
  return row.architecture === "legacy" || (row.identity_version != null && row.foundation_version != null);
}

/** The keys from this deployment's settings, or none if they can't be read. */
export function panelKeys(env: () => Parameters<typeof keysFrom>[0]): FoundationKey[] {
  try {
    return keysFrom(env());
  } catch {
    return [];
  }
}
