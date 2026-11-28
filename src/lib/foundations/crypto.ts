import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Each version of an advisor's private material is encrypted before it is
// stored (AES-256-GCM, a fresh 12-byte nonce per version) with a key held
// only in the server's environment. The row's advisor, layer and version are
// bound in as additional authenticated data, so a ciphertext copied into
// another row fails to decrypt. The plaintext's SHA-256 is stored too and
// checked after decryption. scripts/foundations.mjs encrypts with the same
// scheme (tests/foundations-crypto.test.ts keeps them in step).

export interface SealedLayer {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
  key_id: string;
  sha256: string; // hex, of the plaintext
}

export interface FoundationKey {
  id: string;
  key: Buffer;
}

export class FoundationCryptoError extends Error {
  constructor(readonly code: "decrypt_failed" | "checksum_mismatch" | "key_missing") {
    super(code);
    this.name = "FoundationCryptoError";
  }
}

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

const aad = (advisorId: string, layer: string, version: number) => Buffer.from(`${advisorId}|${layer}|${version}`, "utf8");

export function seal(plaintext: string, key: FoundationKey, where: { advisorId: string; layer: string; version: number }): SealedLayer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(aad(where.advisorId, where.layer, where.version));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), key_id: key.id, sha256: sha256(plaintext) };
}

export function open(sealed: SealedLayer, keys: FoundationKey[], where: { advisorId: string; layer: string; version: number }): string {
  const key = keys.find((k) => k.id === sealed.key_id);
  if (!key) throw new FoundationCryptoError("key_missing");
  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(sealed.iv, "base64"));
    decipher.setAAD(aad(where.advisorId, where.layer, where.version));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    plaintext = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new FoundationCryptoError("decrypt_failed");
  }
  const want = Buffer.from(sealed.sha256, "hex");
  const got = Buffer.from(sha256(plaintext), "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new FoundationCryptoError("checksum_mismatch");
  return plaintext;
}

/** The keys this deployment holds: the current one, and the one before the last rotation. */
export function keysFrom(env: { FOUNDATION_KEY?: string; FOUNDATION_KEY_ID?: string; FOUNDATION_KEY_PREVIOUS?: string; FOUNDATION_KEY_PREVIOUS_ID?: string }): FoundationKey[] {
  const keys: FoundationKey[] = [];
  if (env.FOUNDATION_KEY) keys.push({ id: env.FOUNDATION_KEY_ID ?? "k1", key: Buffer.from(env.FOUNDATION_KEY, "base64") });
  if (env.FOUNDATION_KEY_PREVIOUS && env.FOUNDATION_KEY_PREVIOUS_ID) keys.push({ id: env.FOUNDATION_KEY_PREVIOUS_ID, key: Buffer.from(env.FOUNDATION_KEY_PREVIOUS, "base64") });
  return keys;
}
