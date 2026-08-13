import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client for owner sign-in (password + magic link) and
 * account actions (password change, sign-out). Only ever constructed on
 * pages already gated behind `isOwnerAuthConfigured()` — callers check that
 * first (see app/login/page.tsx, app/owner/account/page.tsx).
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  );
}
