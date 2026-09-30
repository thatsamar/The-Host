import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { signInRequired } from "@/lib/auth/access";
import { missingSupabaseConfig } from "@/lib/auth/sign-in-error";

// Sign-in, plus what a logged-out browser or a link preview needs to show the app.
const PUBLIC_PATHS = ["/login", "/join", "/icon", "/apple-icon", "/opengraph-image", "/manifest.webmanifest"];

/** Refreshes the auth session on every request and, where sign-in is on, gates the app behind it. */
export async function updateSession(request: NextRequest) {
  // Open app (the default): no sign-in anywhere; the sign-in and invitation
  // pages just lead to the start screen.
  if (!signInRequired()) {
    const path = request.nextUrl.pathname;
    if (path === "/login" || path.startsWith("/join/")) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  // Without Supabase settings nobody can sign in; send everything to /login,
  // which says which setting is missing.
  if (missingSupabaseConfig().length) {
    const path = request.nextUrl.pathname;
    if (PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`))) return NextResponse.next({ request });
    if (path.startsWith("/api/")) return NextResponse.json({ error: "Supabase is not configured" }, { status: 503 });
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims: it refreshes
  // the session cookie when needed.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

  if (!signedIn && !isPublic) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  if (signedIn && (path === "/login" || path.startsWith("/join/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}
