/**
 * Legacy public access-denied screen. Tenant authorization now comes from
 * workspace membership + RLS rather than an app-level email allowlist. It
 * lives OUTSIDE /owner and never
 * renders any dashboard data — and reads its own claims for display since
 * middleware doesn't pass state down to the page it redirects to.
 *
 * When auth isn't configured (demo mode — see lib/owner-auth.ts
 * isOwnerAuthConfigured), middleware never gates /owner in the first place,
 * so this page shouldn't normally be reachable that way. But it's a public
 * route regardless, and constructing a Supabase client with empty/unset URL
 * env here would throw. So this branch renders an explanatory demo-mode
 * notice WITHOUT ever touching Supabase — no client, no network call, no
 * possible 500.
 */

import Link from "next/link";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import { createClient } from "@/lib/supabase/server";
import { OwnerAuthShell } from "@/components/owner/OwnerAuthShell";
import { Badge, Button } from "@/components/ui";
import { IconArrowRight } from "@/components/icons";

export default async function NotAuthorizedPage() {
  if (!isOwnerAuthConfigured()) {
    return (
      <OwnerAuthShell>
        <div className="text-center">
          <div className="flex justify-center">
            <Badge tone="brand">Demo mode</Badge>
          </div>
          <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">
            Sign-in isn&apos;t configured
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            This deployment hasn&apos;t set up Supabase Auth, so the owner
            dashboard is open without authentication.
          </p>
          <a
            href="/owner"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:text-brand-dark"
          >
            Go to dashboard <IconArrowRight className="h-4 w-4" />
          </a>
        </div>
      </OwnerAuthShell>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email ?? null;

  return (
    <OwnerAuthShell>
      <div className="text-center">
        <h1 className="text-xl font-semibold tracking-tight text-ink">Workspace access required</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          {email ? (
            <>
              Signed in as <span className="font-medium text-ink">{email}</span> —
              this account isn&apos;t linked to an OnlyEVs-enabled Sophosic workspace.
            </>
          ) : (
            "This account isn't linked to an OnlyEVs-enabled Sophosic workspace."
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
