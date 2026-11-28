import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SealedLayer } from "./crypto";
import type { ArchitectureId, Audience, FoundationLayer } from "./types";

/** An advisor's active configuration (advisor_active). Never any text. */
export interface ActiveRow {
  advisor_id: string;
  architecture: ArchitectureId;
  identity_version: number | null;
  foundation_version: number | null;
  layer2_version: number | null;
  last_loaded_at: string | null;
  /** Who gets C2 (20261128000001); a row from before it means everyone. */
  audience?: Audience;
  /** While in the future, the owner's loads fail on purpose (the /ops fallback test). */
  fallback_test_until?: string | null;
}

export type AdvisorEventKind = "fallback" | "unavailable" | "leak_guard";

/** What the loader needs from storage. Every method may throw; the loader decides what that means. */
export interface FoundationStore {
  active(advisorId: string): Promise<ActiveRow | null>;
  layer(advisorId: string, layer: FoundationLayer, version: number): Promise<SealedLayer | null>;
  /** Best effort: when this advisor's foundation last loaded, for the unavailability threshold. */
  markLoaded(advisorId: string, at: Date): Promise<void>;
  /** Best effort: one counted event (fixed codes only, never text). */
  event(advisorId: string, kind: AdvisorEventKind, reason?: string): Promise<void>;
}

/** The tables: supabase/migrations/20261127000001_advisor_foundations.sql and 20261128000001_advisor_audience.sql. */
const QUERY_TIMEOUT_MS = 3_000;

export class SupabaseFoundationStore implements FoundationStore {
  constructor(private client: SupabaseClient) {}

  async active(advisorId: string): Promise<ActiveRow | null> {
    const { data, error } = await this.client
      .from("advisor_active")
      .select("advisor_id, architecture, identity_version, foundation_version, layer2_version, last_loaded_at, audience, fallback_test_until")
      .eq("advisor_id", advisorId)
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error("foundation_store_failed");
    return (data as ActiveRow | null) ?? null;
  }

  async layer(advisorId: string, layer: FoundationLayer, version: number): Promise<SealedLayer | null> {
    const { data, error } = await this.client
      .from("advisor_layers")
      .select("ciphertext, iv, tag, key_id, sha256")
      .eq("advisor_id", advisorId)
      .eq("layer", layer)
      .eq("version", version)
      .eq("status", "approved")
      .abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error("foundation_store_failed");
    return (data as SealedLayer | null) ?? null;
  }

  async markLoaded(advisorId: string, at: Date): Promise<void> {
    await this.client.from("advisor_active").update({ last_loaded_at: at.toISOString() }).eq("advisor_id", advisorId).abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  }

  async event(advisorId: string, kind: AdvisorEventKind, reason?: string): Promise<void> {
    await this.client.from("advisor_events").insert({ advisor_id: advisorId, kind, reason: reason ?? null }).abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS));
  }
}
