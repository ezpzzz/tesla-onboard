/**
 * Shown when someone is signed in via Supabase but their email isn't on the
 * owner allowlist (see lib/owner-auth.ts). Lives OUTSIDE /owner — never
 * renders any dashboard data — and reads its own claims for display since
 * middleware doesn't pass state down to the page it redirects to.
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { Button } from "@/components/ui";

export default async function NotAuthorizedPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email ?? null;

  return (
    <OwnerAuthShell>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Not authorized</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {email ? (
            <>
              Signed in as <span className="font-medium text-ink">{email}</span> —
              this account isn&apos;t on the owner allowlist.
            </>
          ) : (
            "This account isn't on the owner allowlist."
          )}
        </p>
        <div className="mt-6 space-y-3">
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="secondary" fullWidth>
              Sign out
            </Button>
          </form>
          <Link
            href="/login"
            className="block text-sm font-medium text-muted hover:text-ink"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </OwnerAuthShell>
  );
}
