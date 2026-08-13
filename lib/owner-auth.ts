import "server-only";

/**
 * Owner-dashboard auth gate (Supabase Auth, shared project).
 *
 * /owner has no auth at all when NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset — that's "demo mode", and it
 * must behave byte-identically to the app before this feature existed (see
 * middleware.ts). Partial config (only one of the pair set) counts as
 * unconfigured — fail toward demo mode, not toward a half-working gate.
 *
 * The allowlist is server-only and separate from the Supabase project's user
 * pool: a user can authenticate (prove they have an account in the SHARED
 * sophosic-platform project) without being an owner of *this* app. Signing in
 * only proves identity; the allowlist is what grants access.
 */

const DEFAULT_ALLOWLIST = ["alex@sophosic.ai"];

export function isOwnerAuthConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * OWNER_ALLOWED_EMAILS, comma-separated, trimmed, lowercased.
 * - Unset (undefined) -> defaults to ["alex@sophosic.ai"].
 * - Explicitly set to "" -> [] (fail closed: nobody gets in).
 */
export function getOwnerAllowlist(): string[] {
  const raw = process.env.OWNER_ALLOWED_EMAILS;
  if (raw === undefined) return DEFAULT_ALLOWLIST;
  return raw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowedOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return getOwnerAllowlist().includes(email.trim().toLowerCase());
}

let warnedDisabled = false;

/** One console.warn, ever, naming both env vars — called from demo-mode paths. */
export function warnOwnerAuthDisabledOnce(): void {
  if (warnedDisabled) return;
  warnedDisabled = true;
  console.warn(
    "[owner-auth] NEXT_PUBLIC_SUPABASE_URL and/or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are unset — " +
      "/owner is running with NO SIGN-IN required (demo mode). Set both to enable the owner auth gate.",
  );
}

export function logOwnerAuthEvent(e: {
  type: "signin_required" | "denied" | "success" | "signout";
  email?: string;
  path?: string;
}): void {
  console.log(`[owner-auth] ${JSON.stringify(e)}`);
}
