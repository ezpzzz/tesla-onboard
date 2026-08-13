import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session cookie for one request and reports the
 * verified email (or null). Copied near-verbatim from the current Supabase
 * SSR middleware pattern — do not "simplify" the response-rebuild: it's what
 * lets a token refresh mid-request actually reach the browser.
 *
 * Callers MUST treat `response` as the base to return from middleware (or
 * clone its cookies onto a redirect) — a fresh `NextResponse.next()` here
 * would silently drop the refreshed session cookie.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; email: string | null }> {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          // Cache-Control / Expires / Pragma: responses that carry auth
          // cookies must never be cached by a CDN or reverse proxy.
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  // No statements between client creation and getClaims() — a token refresh
  // that completes after the response is otherwise built would be lost.
  const { data } = await supabase.auth.getClaims();
  // Verified JWT claims only — never user_metadata, which the user controls.
  const email = data?.claims?.email ?? null;

  return { response: supabaseResponse, email };
}
