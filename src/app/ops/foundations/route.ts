import { foundationsEnv } from "@/lib/env";
import { foundationLoader } from "@/lib/foundations/loader";
import { normalizePhone } from "@/lib/foundations/owner";
import { activate, emergencyLegacy, fallbackTest, panelKeys, PanelError, panelStore, rollbackTo, uploadVersion, MAX_LAYER_CHARS, type PanelDeps } from "@/lib/foundations/panel";
import { renderFoundationsPanel, MESSAGES } from "@/lib/ops/foundations-panel";
import { sameOrigin, sessionCookie, validSession } from "@/lib/ops/session";
import { SMS_ADVISORS } from "@/lib/sms/navigation";

// The /ops foundations panel (docs/foundations.md): behind the same sign-in
// as /ops. Every action is a POST from this page (same-origin checked, the
// session cookie is SameSite=Strict), recorded in the history as the owner's.
// No foundation text is ever returned, rendered or logged: an upload is
// encrypted here and only its version, size and checksum prefix are shown.

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };
/** A foundation is text; this leaves room for the form around it. */
const MAX_BODY_BYTES = MAX_LAYER_CHARS * 4 + 64 * 1024;

function signedIn(request: Request): boolean {
  const password = process.env.OPS_PASSWORD ?? "";
  return !!password && validSession(sessionCookie(request), password);
}

function settings() {
  try {
    const env = foundationsEnv();
    return { enabled: env.FOUNDATIONS_ENABLED, keyId: env.FOUNDATION_KEY ? (env.FOUNDATION_KEY_ID ?? "k1") : null, ownerPhone: !!normalizePhone(env.OWNER_PHONE) };
  } catch {
    return { enabled: false, keyId: null, ownerPhone: false };
  }
}

const back = (kind: "done" | "error", code: string, advisor?: string) =>
  new Response(null, { status: 303, headers: { Location: `/ops/foundations?${kind}=${encodeURIComponent(code)}${advisor ? `#${advisor}` : ""}`, ...noStore } });

export async function GET(request: Request): Promise<Response> {
  if (!process.env.OPS_PASSWORD) return new Response("Not found", { status: 404 });
  if (!signedIn(request)) return new Response(null, { status: 303, headers: { Location: "/ops", ...noStore } });
  const store = panelStore.make();
  if (!store) return new Response("Supabase isn't configured on this deployment.", { status: 503, headers: noStore });
  const url = new URL(request.url);
  const done = url.searchParams.get("done");
  const error = url.searchParams.get("error");
  const code = done ?? error;
  try {
    const [active, layers, history] = await Promise.all([store.active(), store.layers(), store.history()]);
    const page = renderFoundationsPanel({
      active,
      layers,
      history,
      settings: settings(),
      message: code && code in MESSAGES ? { kind: done ? "done" : "error", code } : undefined,
      now: new Date(),
    });
    return new Response(page, { headers: { "Content-Type": "text/html; charset=utf-8", ...noStore } });
  } catch {
    console.error("Foundations panel failed", JSON.stringify({ code: "PANEL_READ_FAILED" }));
    return new Response("The foundations tables couldn't be read. Has the migration been run on this project?", { status: 503, headers: noStore });
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!process.env.OPS_PASSWORD) return new Response("Not found", { status: 404 });
  if (!signedIn(request)) return new Response(null, { status: 303, headers: { Location: "/ops", ...noStore } });
  if (!sameOrigin(request)) return back("error", "bad_origin");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return back("error", "too_large");
  const store = panelStore.make();
  if (!store) return new Response("Supabase isn't configured on this deployment.", { status: 503, headers: noStore });

  const form = await request.formData().catch(() => null);
  const field = (name: string) => {
    const v = form?.get(name);
    return typeof v === "string" ? v : undefined;
  };
  const advisorId = field("advisor") ?? "";
  if (!SMS_ADVISORS.some((a) => a.id === advisorId)) return back("error", "bad_advisor");
  const deps: PanelDeps = { store, keys: panelKeys(foundationsEnv), invalidate: (id) => foundationLoader().invalidate(id) };
  const action = field("action");

  try {
    switch (action) {
      case "upload": {
        const file = form?.get("file");
        const pasted = (field("text") ?? "").trim();
        const chosen = file instanceof File && file.size > 0 ? file : null;
        if (pasted && chosen) return back("error", "both", advisorId);
        if (chosen && chosen.type && !/^text\/|^application\/octet-stream$/.test(chosen.type)) return back("error", "not_text", advisorId);
        const text = chosen ? await chosen.text() : pasted;
        await uploadVersion(deps, { advisorId, layer: field("layer"), text, provenance: field("provenance"), note: field("note") });
        return back("done", "uploaded", advisorId);
      }
      case "activate":
        await activate(deps, { advisorId, identity: field("identity"), foundation: field("foundation"), layer2: field("layer2"), audience: field("audience"), note: field("note") });
        return back("done", "activated", advisorId);
      case "rollback":
        await rollbackTo(deps, { advisorId, historyId: field("history") });
        return back("done", "rolled_back", advisorId);
      case "emergency_legacy":
        await emergencyLegacy(deps, { advisorId, note: "emergency" });
        return back("done", "emergency", advisorId);
      case "fallback_test_on":
      case "fallback_test_off":
        await fallbackTest(deps, { advisorId, on: action === "fallback_test_on" });
        return back("done", action === "fallback_test_on" ? "test_on" : "test_off", advisorId);
      default:
        return back("error", "failed", advisorId);
    }
  } catch (err) {
    const code = err instanceof PanelError ? err.code : "failed";
    // A fixed code and the action only: never anything from the form.
    console.error("Foundations panel action failed", JSON.stringify({ code: `PANEL_${code.toUpperCase()}`, action, advisor: advisorId }));
    return back("error", code in MESSAGES ? code : "failed", advisorId);
  }
}
