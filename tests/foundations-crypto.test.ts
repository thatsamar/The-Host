import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FoundationCryptoError, keysFrom, open, seal } from "@/lib/foundations/crypto";
import * as script from "../scripts/foundations.mjs";

// Stand-in text only: real foundations never enter the repository.
const TEXT = "STAND-IN FOUNDATION: an example principle, written for tests.";
const key = { id: "k1", key: randomBytes(32) };
const where = { advisorId: "tony", layer: "foundation", version: 3 };

describe("foundation encryption", () => {
  it("round-trips, and stores no text in the clear", () => {
    const sealed = seal(TEXT, key, where);
    expect(JSON.stringify(sealed)).not.toContain("STAND-IN");
    expect(open(sealed, [key], where)).toBe(TEXT);
  });

  it("refuses a tampered ciphertext, a row copied elsewhere, a wrong key and a wrong checksum", () => {
    const sealed = seal(TEXT, key, where);
    const flipped = Buffer.from(sealed.ciphertext, "base64");
    flipped[0] ^= 1;
    expect(() => open({ ...sealed, ciphertext: flipped.toString("base64") }, [key], where)).toThrow(FoundationCryptoError);
    expect(() => open(sealed, [key], { ...where, version: 4 })).toThrow("decrypt_failed");
    expect(() => open(sealed, [key], { ...where, advisorId: "gio" })).toThrow("decrypt_failed");
    expect(() => open(sealed, [{ id: "k1", key: randomBytes(32) }], where)).toThrow("decrypt_failed");
    expect(() => open(sealed, [{ id: "k2", key: key.key }], where)).toThrow("key_missing");
    expect(() => open({ ...sealed, sha256: "0".repeat(64) }, [key], where)).toThrow("checksum_mismatch");
  });

  it("opens versions sealed with the key before a rotation", () => {
    const old = { id: "k0", key: randomBytes(32) };
    const sealed = seal(TEXT, old, where);
    const keys = keysFrom({ FOUNDATION_KEY: randomBytes(32).toString("base64"), FOUNDATION_KEY_ID: "k1", FOUNDATION_KEY_PREVIOUS: old.key.toString("base64"), FOUNDATION_KEY_PREVIOUS_ID: "k0" });
    expect(keys.map((k) => k.id)).toEqual(["k1", "k0"]);
    expect(open(sealed, keys, where)).toBe(TEXT);
  });

  it("uses the same scheme as the operator script, both ways", () => {
    const byScript = script.seal(TEXT, key, where);
    expect(open(byScript, [key], where)).toBe(TEXT);
    expect(script.open(seal(TEXT, key, where), [key], where)).toBe(TEXT);
  });
});
