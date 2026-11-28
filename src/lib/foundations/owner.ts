import "server-only";
import { timingSafeEqual } from "node:crypto";
import { foundationsEnv } from "@/lib/env";
import { sessionCookie, validSession } from "@/lib/ops/session";

// Who the owner is, for staged rollout (docs/foundations.md): an advisor whose
// C2 is for the owner only gives it to these requests and to no one else.
// By text: the sender's number matches OWNER_PHONE (both normalized to
// E.164). On the website: the request carries this deployment's /ops sign-in
// (OPS_PASSWORD's session cookie). Neither the number nor the answer is ever
// logged.

/** A phone number in E.164 (+ and 8 to 15 digits), or null. A 10-digit number is taken as US or Canada. */
export function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  let e164: string;
  if (trimmed.startsWith("+")) e164 = `+${digits}`;
  else if (trimmed.startsWith("00")) e164 = `+${digits.slice(2)}`;
  else if (digits.length === 10) e164 = `+1${digits}`;
  else if (digits.length === 11 && digits.startsWith("1")) e164 = `+${digits}`;
  else return null;
  return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
}

function ownerPhone(): string | null {
  try {
    return normalizePhone(foundationsEnv().OWNER_PHONE);
  } catch {
    return null;
  }
}

/** Whether a text came from the owner's number. Unset or unreadable OWNER_PHONE means no one is the owner. */
export function isOwnerPhone(from: string, owner = ownerPhone()): boolean {
  const sender = normalizePhone(from);
  if (!owner || !sender) return false;
  const a = Buffer.from(sender);
  const b = Buffer.from(owner);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Whether a website request carries this deployment's /ops sign-in. */
export function isOwnerRequest(request: Request, password = process.env.OPS_PASSWORD ?? ""): boolean {
  return validSession(sessionCookie(request), password);
}
