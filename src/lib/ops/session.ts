import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signing in to /ops on a phone: one password (OPS_PASSWORD), then a cookie
 * that keeps the browser signed in for SESSION_DAYS. The cookie holds only an
 * expiry and a signature made with the password, so changing OPS_PASSWORD
 * signs every device out, and nothing in it identifies anyone.
 */

export const SESSION_COOKIE = "cinq_ops";
export const SESSION_DAYS = 30;

function sign(password: string, expires: number): string {
  return createHmac("sha256", password).update(`cinq-ops-session:${expires}`).digest("base64url");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function passwordMatches(given: string, password: string): boolean {
  return !!password && same(given, password);
}

export function newSession(password: string, now = Date.now()): { value: string; maxAge: number } {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  const expires = Math.floor(now / 1000) + maxAge;
  return { value: `${expires}.${sign(password, expires)}`, maxAge };
}

export function validSession(value: string | undefined, password: string, now = Date.now()): boolean {
  if (!value || !password) return false;
  const [expiresText, signature] = value.split(".");
  const expires = Number(expiresText);
  if (!Number.isInteger(expires) || expires * 1000 < now || !signature) return false;
  return same(signature, sign(password, expires));
}

/** The session cookie from a request's Cookie header. */
export function sessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=");
  }
  return undefined;
}

/**
 * The cookie is sent site-wide (Path=/) so the website can recognise the owner
 * for C2 rolled out to the owner only (foundations/owner.ts). It stays
 * HttpOnly, Secure and SameSite=Strict; the page's own code never sees it.
 */
export function sessionHeader(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

/** Signing out clears the cookie, and the one earlier versions set for /ops alone. */
export function signOutHeaders(): [string, string][] {
  return [
    ["Set-Cookie", sessionHeader("", 0)],
    ["Set-Cookie", `${SESSION_COOKIE}=; Path=/ops; Max-Age=0; HttpOnly; Secure; SameSite=Strict`],
  ];
}

/** The sign-in page: a password field a phone's password manager can fill and remember. */
export function signInPage(error = false): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Cinq Operations</title>${HOME_SCREEN_TAGS}
<style>
:root{--bg:#f5f6f4;--card:#fff;--fg:#1d2422;--muted:#5d6763;--line:#dce1de;--accent:#235f57;--bad:#9a2f2c;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#121715;--card:#1a201e;--fg:#e3e8e5;--muted:#9aa5a0;--line:#2c3532;--accent:#7cc3b7;--bad:#ec9b96;color-scheme:dark}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:0 max(16px,env(safe-area-inset-left,0px))}
form{width:100%;max-width:340px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:24px;display:grid;gap:12px}
h1{font-size:22px;margin:0}p{margin:0;color:var(--muted);font-size:14px}
label{font-size:13px;color:var(--muted)}input{font:inherit;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg)}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button{font:inherit;font-weight:600;padding:12px;border:0;border-radius:10px;background:var(--accent);color:var(--bg)}
.error{color:var(--bad);font-size:14px}.hidden{position:absolute;left:-9999px}
</style></head><body>
<form method="post" action="/ops">
<h1>Cinq Operations</h1>
<p>Sign in once; this device stays signed in for ${SESSION_DAYS} days.</p>
${error ? `<div class="error" role="alert">That password isn't right. Try again.</div>` : ""}
<input class="hidden" type="text" name="username" autocomplete="username" value="cinq-ops" tabindex="-1" aria-hidden="true" readonly>
<label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Sign in</button>
</form></body></html>`;
}

/** So "Add to Home Screen" gives the dashboard Cinq's icon and a short name. */
export const HOME_SCREEN_TAGS = `<link rel="apple-touch-icon" href="/apple-icon"><meta name="apple-mobile-web-app-title" content="Cinq Ops"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#235f57">`;
