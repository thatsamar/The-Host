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
// Logs carry fixed codes, the advisor id and version numbers, never text.

export const CACHE_TTL_MS = 5 * 60_000;
/** A failed load is not retried for this long, so a broken store isn't hit on every answer. */
export const FAILURE_TTL_MS = 30_000;

export type Resolved = ResolvedArchitecture & { loadMs: number };

type Cached = { value: ResolvedArchitecture; at: number; failed?: boolean };

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

  async resolve(advisorId: string): Promise<Resolved> {
    const began = this.now();
    let env: ReturnType<typeof foundationsEnv>;
    try {
      env = this.deps.env();
    } catch {
      // Invalid foundation settings: nothing to do unless foundations were switched on.
      if (!/^(true|1)$/.test(process.env.FOUNDATIONS_ENABLED ?? "")) return { kind: "legacy", loadMs: 0 };
      return this.fallback(advisorId, "store_misconfigured", began, 60);
    }
    if (!env.FOUNDATIONS_ENABLED) return { kind: "legacy", loadMs: 0 };

    const cached = this.cache.get(advisorId);
    if (cached && this.now() - cached.at < (cached.failed ? FAILURE_TTL_MS : CACHE_TTL_MS)) {
      if (cached.value.kind === "legacy" && cached.value.fallback) return this.fallback(advisorId, cached.value.fallback, began, env.FOUNDATION_FALLBACK_MAX_MINUTES, false);
      return { ...cached.value, loadMs: this.now() - began };
    }

    const store = this.deps.store();
    if (!store) return this.fallback(advisorId, "store_misconfigured", began, env.FOUNDATION_FALLBACK_MAX_MINUTES);
    const keys = keysFrom(env);

    let value: ResolvedArchitecture;
    try {
      value = await this.load(store, advisorId, keys).catch(() => this.load(store, advisorId, keys));
    } catch (err) {
      const reason = err instanceof LoadError ? err.reason : "store_unavailable";
      if (err instanceof LoadError && err.row) this.lastRow.set(advisorId, err.row);
      return this.fallback(advisorId, reason, began, env.FOUNDATION_FALLBACK_MAX_MINUTES);
    }
    this.cache.set(advisorId, { value, at: this.now() });
    this.failingSince.delete(advisorId);
    if (value.kind === "c2") this.lastGood.set(advisorId, value);
    return { ...value, loadMs: this.now() - began };
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
      let sealed;
      try {
        sealed = await store.layer(advisorId, layer, version);
      } catch {
        throw new LoadError("store_unavailable", row);
      }
      if (!sealed) throw new LoadError("layer_missing", row);
      try {
        return open(sealed, keys, { advisorId, layer, version });
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
    return { kind: "c2", identity, foundation: layer2 ? `${foundation}\n\n${layer2}` : foundation, versions };
  }

  /** Option A, or unavailable past the threshold. Every call is logged and counted. */
  private fallback(advisorId: string, reason: FallbackReason, began: number, maxMinutes: number, cacheIt = true): Resolved {
    const now = this.now();
    const good = this.lastGood.get(advisorId);
    if (good) {
      // Still the approved C2 material, just not refreshed: logged, not a fallback.
      this.log("Foundation refresh failed", { code: "FOUNDATION_LAST_KNOWN_GOOD", advisor: advisorId, reason, versions: good.versions });
      if (cacheIt) this.cache.set(advisorId, { value: good, at: now, failed: true });
      return { ...good, loadMs: now - began };
    }
    const row = this.lastRow.get(advisorId);
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
      if (cacheIt) this.cache.set(advisorId, { value: { kind: "legacy", fallback: reason }, at: now, failed: true });
      return { kind: "unavailable", fallback: reason, loadMs: now - began };
    }
    this.log("Foundation fallback", { code: "FOUNDATION_FALLBACK", advisor: advisorId, reason, configured: row ? { identity: row.identity_version, foundation: row.foundation_version, layer2: row.layer2_version } : null });
    void store?.event(advisorId, "fallback", reason).catch(() => {});
    if (cacheIt) this.cache.set(advisorId, { value: { kind: "legacy", fallback: reason }, at: now, failed: true });
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
