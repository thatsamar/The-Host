// The shape of an advisor's architecture as the prompt sees it. Pure types:
// the loader (server-only) resolves them; prompt assembly only reads them.

export type ArchitectureId = "legacy" | "c2";

export type FoundationLayer = "identity" | "foundation" | "foundation_l2";

export interface FoundationVersions {
  identity: number;
  foundation: number;
  /** The experimental second layer, when it is active; null otherwise. */
  layer2: number | null;
}

/** Why the system fell back (fixed codes only: they go to the log and /ops). */
export type FallbackReason =
  | "store_unavailable"
  | "store_misconfigured"
  | "key_missing"
  | "layer_missing"
  | "decrypt_failed"
  | "checksum_mismatch";

export type ResolvedArchitecture =
  /** The current architecture: the companion's own prompt and capabilities. `fallback` is set when C2 was configured but couldn't be loaded. */
  | { kind: "legacy"; fallback?: FallbackReason }
  /** C2: identity and foundation from the private store (layer 2 appended when active). */
  | { kind: "c2"; identity: string; foundation: string; versions: FoundationVersions }
  /** Fallback has lasted past the threshold: the advisor is treated as unavailable. */
  | { kind: "unavailable"; fallback: FallbackReason };
