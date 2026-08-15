import "server-only";

/**
 * Owner-dashboard auth gate (dedicated EVhost Supabase project).
 *
 * /owner has no auth at all when NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset — that's "demo mode", and it
 * must be visually and behaviorally equivalent to the app before this
 * feature existed (see proxy.ts), modulo the force-dynamic rendering
 * and OwnerShell markup-wrapper deltas that equivalence necessarily carries.
 * Partial config (only one of the pair set) counts as unconfigured — fail
 * toward demo mode, not toward a half-working gate.
 *
 * Signing in proves identity. Tenant access is resolved from EVhost-owned
 * workspace_users membership and enforced by RLS policies, so this deployment
 * does not carry a global email allowlist.
 */

export function isOwnerAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

let warnedDisabled = false;

/** One console.warn, ever, naming both env vars — called from demo-mode paths. */
export function warnOwnerAuthDisabledOnce(): void {
  if (warnedDisabled) return;
  warnedDisabled = true;
  console.warn(
    "[owner-auth] NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset — " +
      "/owner is running with NO SIGN-IN required (demo mode). Set both to enable the owner auth gate. " +
      "NEXT_PUBLIC_* env vars are inlined into the client bundle at BUILD time, not read at runtime — " +
      "setting them only in the running environment (without rebuilding) will NOT enable this gate.",
  );
}

export function logOwnerAuthEvent(e: {
  type: "signin_required" | "denied" | "success" | "signout";
  email?: string;
  path?: string;
}): void {
  console.log(`[owner-auth] ${JSON.stringify(e)}`);
}
