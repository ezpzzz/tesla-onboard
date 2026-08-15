import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for Server Components, Route Handlers, and
 * Server Actions. `setAll` is wrapped in try/catch because Server Components
 * can't write cookies (Next throws) — that's expected there and harmless,
 * since the middleware (lib/supabase/middleware.ts) is what actually refreshes
 * and persists the session on every /owner and /login request.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — no-op, see comment above.
          }
        },
      },
    },
  );
}

/**
 * Cookie-free server client for deliberately public, RLS-limited reads. Never
 * use this for owner data: its purpose is to prevent an unrelated signed-in
 * user cookie from changing a public resolver query from `anon` to
 * `authenticated`.
 */
export function createAnonymousClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    {
      cookies: {
        getAll() {
          return [];
        },
        setAll() {
          // Public resolver calls never establish or refresh sessions.
        },
      },
    },
  );
}

/**
 * Privileged server-only client for the narrow reminder-material RPC. Owner
 * authorization and rate limiting happen first through the cookie-scoped
 * client; this key is never used by a browser or a React component.
 */
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
