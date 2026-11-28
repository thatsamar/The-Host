import "server-only";
import { foundationsEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { FoundationCryptoError, keysFrom, open, type FoundationKey } from "./crypto";
import { SupabaseFoundationStore, type ActiveRow, type FoundationStore } from "./store";
import type { FallbackReason, FoundationVersions, ResolvedArchitecture } from "./types";

// Resolves an advisor's architecture once per answer (docs/foundations.md).
//
// - FOUNDATIONS_ENABLED off: always the current architecture, nothing read.
// - Active configuration and layers are cached per server instance for
//   CACHE_TTL_MS, so a version change or rollback takes effect within it,
//   without a redeploy.
// - A failed load is retried once; then the last copy this instance loaded
//   is used if it has one; then Option A (approved): the advisor answers on
//   its current architecture, every time logged (FOUNDATION_FALLBACK) and
//   counted (advisor_events, shown on /ops).
// - If C2 hasn't loaded for longer than FOUNDATION_FALLBACK_MAX_MINUTES, the
//   advisor is treated as unavailable until it loads again.
// - Staged rollout: with audience 'owner', only the owner (owner.ts: the
//   owner's number by text, the /ops sign-in on the website) gets C2; anyone
//   else gets the current architecture, which is not a fallback. The owner's
//   own requests always read the configuration fresh, so a change made in
//   /ops reaches the owner at once; everyone else within CACHE_TTL_MS.
// - The fallback test (/ops): while fallback_test_until is in the future, the
//   owner's loads fail on purpose (FOUNDATION_FALLBACK, reason fallback_test).
// Logs carry fixed codes, the advisor id and version numbers, never text.

export const CACHE_TTL_MS = 5 * 60_000;
/** A failed load is not retried for this long, so a broken store isn't hit on every answer. */
export const FAILURE_TTL_MS = 30_000;

export type Resolved = ResolvedArchitecture & { loadMs: number };

type Cached = { value: ResolvedArchitecture; row?: ActiveRow | null; at: number; failed?: boolean };

/** Who is asking, as far as the loader needs to know: never their number or anything else about them. */
export interface Requester {
  owner?: boolean;
}

class LoadError extends Error {
  constructor(
    readonly reason: FallbackReason,
    readonly row?: ActiveRow,
  ) {
    super(reason);
    this.name = "FoundationLoadError";
  }
}

export interface LoaderDeps {
  store: () => FoundationStore | null;
  env: () => ReturnType<typeof foundationsEnv>;
  now?: () => number;
  log?: (message: string, data: Record<string, unknown>) => void;
}

export class FoundationLoader {
  private cache = new Map<string, Cached>();
  private lastGood = new Map<string, Extract<ResolvedArchitecture, { kind: "c2" }>>();
  /** The configuration last read, so a store outage knows whether the advisor is on C2. */
  private lastRow = new Map<string, ActiveRow>();
  /** When this instance started failing to load C2 for an advisor. */
  private failingSince = new Map<string, number>();
  /** Decrypted versions, which never change once stored. */
  private layers = new Map<string, string>();

  constructor(private deps: LoaderDeps) {}

  private now() {
    return this.deps.now?.() ?? Date.now();
  }

  private log(message: string, data: Record<string, unknown>) {
    (this.deps.log ?? ((m, d) => console.error(m, JSON.stringify(d))))(message, data);
  }

  /**
   * Without waiting: the current architecture when foundations are off (so the
   * default path adds no step before the answer starts), else null.
   */
  quick(): Resolved | null {
    try {
      return this.deps.env().FOUNDATIONS_ENABLED ? null : { kind: "legacy", loadMs: 0 };
    } catch {
      return /^(true|1)$/.test(process.env.FOUNDATIONS_ENABLED ?? "") ? null : { kind: "legacy", loadMs: 0 };
    }
  }

  /** After a change in /ops: this instance reads the configuration again on its next answer (others within CACHE_TTL_MS). */
  invalidate(advisorId: string): void {
    this.cache.delete(advisorId);
  }

  async resolve(advisorId: string, requester: Requester = {}): Promise<Resolved> {
    const began = this.now();
    const owner = !!requester.owner;
    let env: ReturnType<typeof foundationsEnv>;
    try {
      env = this.deps.env();
    } catch {
      // Invalid foundation settings: nothing to do unless foundations were switched on.
      if (!/^(true|1)$/.test(process.env.FOUNDATIONS_ENABLED ?? "")) return { kind: "legacy", loadMs: 0 };
      return this.fallback(advisorId, "store_misconfigured", began, 60, true, owner);
    }
    if (!env.FOUNDATIONS_ENABLED) return { kind: "legacy", loadMs: 0 };

    // The owner always reads the configuration fresh (the versions themselves stay cached).
    const cached = this.cache.get(advisorId);
    if (cached && !owner && this.now() - cached.at < (cached.failed ? FAILURE_TTL_MS : CACHE_TTL_MS)) {
      if (cached.value.kind === "legacy" && cached.value.fallback) return this.fallback(advisorId, cached.value.fallback, began, env.FOUNDATION_FALLBACK_MAX_MINUTES, false, owner);
      return this.forRequester(advisorId, cached.value, cached.row ?? null, owner, began);
    }

    const store = this.deps.store();
    if (!store) return this.fallback(advisorId, "store_misconfigured", began, env.FOUNDATION_FALLBACK_MAX_MINUTES, true, owner);
    const keys = keysFrom(env);

    let value: ResolvedArchitecture;
    try {
      value = await this.load(store, advisorId, keys).catch(() => this.load(store, advisorId, keys));
    } catch (err) {
      const reason = err instanceof LoadError ? err.reason : "store_unavailable";
      if (err instanceof LoadError && err.row) this.lastRow.set(advisorId, err.row);
      return this.fallback(advisorId, reason, began, env.FOUNDATION_FALLBACK_MAX_MINUTES, true, owner);
    }
    const row = this.lastRow.get(advisorId) ?? null;
    this.cache.set(advisorId, { value, row, at: this.now() });
    this.failingSince.delete(advisorId);
    if (value.kind === "c2") this.lastGood.set(advisorId, value);
    return this.forRequester(advisorId, value, row, owner, began);
  }

  /** The loaded architecture for this requester: the audience, and the owner's fallback test. */
  private forRequester(advisorId: string, value: ResolvedArchitecture, row: ActiveRow | null, owner: boolean, began: number): Resolved {
    const loadMs = this.now() - began;
    if (value.kind !== "c2") return { ...value, loadMs };
    // Owner only: everyone else stays on the current architecture (not a fallback, not counted).
    if (row?.audience === "owner" && !owner) return { kind: "legacy", loadMs };
    if (owner && row?.fallback_test_until && Date.parse(row.fallback_test_until) > this.now()) {
      this.log("Foundation fallback", { code: "FOUNDATION_FALLBACK", advisor: advisorId, reason: "fallback_test", configured: { identity: row.identity_version, foundation: row.foundation_version, layer2: row.layer2_version } });
      void this.deps.store()?.event(advisorId, "fallback", "fallback_test").catch(() => {});
      return { kind: "legacy", fallback: "fallback_test", loadMs };
    }
    return { ...value, loadMs };
  }

  private async load(store: FoundationStore, advisorId: string, keys: FoundationKey[]): Promise<ResolvedArchitecture> {
    let row: ActiveRow | null;
    try {
      row = await store.active(advisorId);
    } catch {
      throw new LoadError("store_unavailable");
    }
    if (row) this.lastRow.set(advisorId, row);
    if (!row || row.architecture !== "c2") return { kind: "legacy" };
    if (!keys.length) throw new LoadError("key_missing", row);
    if (row.identity_version == null || row.foundation_version == null) throw new LoadError("layer_missing", row);
    const read = async (layer: "identity" | "foundation" | "foundation_l2", version: number) => {
      const known = this.layers.get(`${advisorId}|${layer}|${version}`);
      if (known !== undefined) return known;
      let sealed;
      try {
        sealed = await store.layer(advisorId, layer, version);
      } catch {
        throw new LoadError("store_unavailable", row);
      }
      if (!sealed) throw new LoadError("layer_missing", row);
      try {
        const text = open(sealed, keys, { advisorId, layer, version });
        this.layers.set(`${advisorId}|${layer}|${version}`, text);
        return text;
      } catch (err) {
        const code = err instanceof FoundationCryptoError ? err.code : "decrypt_failed";
        throw new LoadError(code === "key_missing" ? "key_missing" : code, row);
      }
    };
    const [identity, foundation, layer2] = await Promise.all([
      read("identity", row.identity_version),
      read("foundation", row.foundation_version),
      row.layer2_version != null ? read("foundation_l2", row.layer2_version) : Promise.resolve(null),
    ]);
    const versions: FoundationVersions = { identity: row.identity_version, foundation: row.foundation_version, layer2: row.layer2_version };
    // Best effort, at most once per cache period: when C2 last loaded, for the threshold.
    const loadedAt = row.last_loaded_at ? Date.parse(row.last_loaded_at) : 0;
    if (this.now() - loadedAt > CACHE_TTL_MS) void store.markLoaded(advisorId, new Date(this.now())).catch(() => {});
    const affiliations = affiliationsText();
    return { kind: "c2", identity, foundation: layer2 ? `${foundation}\n\n${layer2}` : foundation, versions, ...(affiliations ? { affiliations } : {}) };
  }

  /** Option A, or unavailable past the threshold. Every call is logged and counted. */
  private fallback(advisorId: string, reason: FallbackReason, began: number, maxMinutes: number, cacheIt = true, owner = false): Resolved {
    const now = this.now();
    const row = this.lastRow.get(advisorId);
    // C2 for the owner only, and this isn't the owner: the current architecture, which is no fallback for them.
    if (row?.audience === "owner" && !owner) return { kind: "legacy", loadMs: now - began };
    const good = this.lastGood.get(advisorId);
    if (good) {
      // Still the approved C2 material, just not refreshed: logged, not a fallback.
      this.log("Foundation refresh failed", { code: "FOUNDATION_LAST_KNOWN_GOOD", advisor: advisorId, reason, versions: good.versions });
      if (cacheIt) this.cache.set(advisorId, { value: good, row, at: now, failed: true });
      return { ...good, loadMs: now - began };
    }
    // Nothing says this advisor is on C2 (a store outage before any configuration was read, with C2 unknown): the current architecture, still logged.
    if (row && row.architecture !== "c2") return { kind: "legacy", loadMs: now - began };
    if (!this.failingSince.has(advisorId)) this.failingSince.set(advisorId, now);
    const lastLoaded = row?.last_loaded_at ? Date.parse(row.last_loaded_at) : NaN;
    const since = Math.min(this.failingSince.get(advisorId)!, Number.isFinite(lastLoaded) ? lastLoaded : Infinity);
    const unavailable = row?.architecture === "c2" && now - since > maxMinutes * 60_000;
    const store = this.deps.store();
    if (unavailable) {
      this.log("Advisor unavailable", { code: "FOUNDATION_UNAVAILABLE", advisor: advisorId, reason, minutes: Math.round((now - since) / 60_000) });
      void store?.event(advisorId, "unavailable", reason).catch(() => {});
      if (cacheIt) this.cache.set(advisorId, { value: { kind: "legacy", fallback: reason }, row, at: now, failed: true });
      return { kind: "unavailable", fallback: reason, loadMs: now - began };
    }
    this.log("Foundation fallback", { code: "FOUNDATION_FALLBACK", advisor: advisorId, reason, configured: row ? { identity: row.identity_version, foundation: row.foundation_version, layer2: row.layer2_version } : null });
    void store?.event(advisorId, "fallback", reason).catch(() => {});
    if (cacheIt) this.cache.set(advisorId, { value: { kind: "legacy", fallback: reason }, row, at: now, failed: true });
    return { kind: "legacy", fallback: reason, loadMs: now - began };
  }
}

let shared: FoundationLoader | undefined;

/** The app's loader: the service-role store and this deployment's settings. */
export function foundationLoader(): FoundationLoader {
  shared ??= new FoundationLoader({
    store: () => {
      const admin = createAdminClient();
      return admin ? new SupabaseFoundationStore(admin) : null;
    },
    env: () => foundationsEnv(),
  });
  return shared;
}

/** Best effort: count a leak-guard hit for /ops (never the text). */
export function recordLeakGuard(advisorId: string, channel: "web" | "text"): void {
  const admin = createAdminClient();
  if (!admin) return;
  void new SupabaseFoundationStore(admin).event(advisorId, "leak_guard", channel).catch(() => {});
}

/** PHOTO_NOTE_ENABLED, read safely: a bad foundation setting never turns the note on. */
export function photoNoteEnabled(): boolean {
  try {
    return foundationsEnv().PHOTO_NOTE_ENABLED;
  } catch {
    return false;
  }
}

/** What a route logs about the architecture: labels, versions and timing, never text. */
export function architectureLog(resolved: Resolved): Record<string, unknown> {
  return {
    architecture: resolved.kind,
    ...(resolved.kind === "c2" ? { foundationVersions: resolved.versions } : {}),
    ...(resolved.kind !== "c2" && resolved.fallback ? { foundationFallback: resolved.fallback } : {}),
    foundationLoadMs: resolved.loadMs,
  };
}

/** The founder's affiliations reference, a private runtime setting (never in the repository); empty when unset or invalid. */
function affiliationsText(): string | undefined {
  try {
    return foundationsEnv().CINQ_AFFILIATIONS || undefined;
  } catch {
    return undefined;
  }
}
