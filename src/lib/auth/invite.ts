import { createHash, timingSafeEqual } from "node:crypto";

// Invitations: one shared link, /join/<INVITE_CODE>. Whoever opens it gives an
// email and is signed in, no password. Set INVITE_CODE only on the deployments
// that should accept invitations; change it to retire every link sent so far.

const MIN_LENGTH = 8;

/** The deployment's invite code, or null when invitations are off. */
export function inviteCode(value = process.env.INVITE_CODE): string | null {
  const code = value?.trim();
  return code && code.length >= MIN_LENGTH ? code : null;
}

/**
 * The code from whatever someone pasted: the whole invitation link
 * (https://…/join/<code>) or just the phrase.
 */
export function codeFromInput(input: string): string {
  const text = input.trim();
  const match = text.match(/\/join\/([^/?#\s]+)/);
  if (!match) return text;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Compares in constant time, so the code can't be guessed a character at a time. */
export function isValidInvite(candidate: string, expected: string | null): boolean {
  if (!expected) return false;
  return timingSafeEqual(digest(candidate.trim()), digest(expected));
}

export function normalizeEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

export const INVITE_EXPIRED = "This invitation isn't valid anymore. Ask the person who sent it for a new link.";
export const JOIN_UNAVAILABLE = "Joining isn't available right now. Please try again a little later.";
export const ACCOUNT_OFF = "This account has been switched off.";

type AuthError = { message: string; code?: string } | null | undefined;

/**
 * Signs someone in from an invitation. The admin side mints a one-time sign-in
 * token (creating the account the first time); the person's own session then
 * redeems it, so no email is sent and no password is needed. Returning people
 * use the same link.
 */
export async function joinWithInvite(
  input: { code: string; email: string },
  deps: {
    expectedCode: string | null;
    mintToken: (email: string) => Promise<{ tokenHash?: string; error?: AuthError }>;
    redeemToken: (tokenHash: string) => Promise<{ error?: AuthError }>;
    log?: (...args: unknown[]) => void;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const log = deps.log ?? console.error;
  if (!isValidInvite(input.code, deps.expectedCode)) return { ok: false, error: INVITE_EXPIRED };
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };

  const minted = await deps.mintToken(email);
  if (minted.error || !minted.tokenHash) {
    log("Invite sign-in failed to mint a token:", minted.error?.code, minted.error?.message);
    return { ok: false, error: JOIN_UNAVAILABLE };
  }
  const redeemed = await deps.redeemToken(minted.tokenHash);
  if (redeemed.error) {
    if (redeemed.error.code === "user_banned") return { ok: false, error: ACCOUNT_OFF };
    log("Invite sign-in failed to redeem a token:", redeemed.error.code, redeemed.error.message);
    return { ok: false, error: JOIN_UNAVAILABLE };
  }
  return { ok: true };
}
