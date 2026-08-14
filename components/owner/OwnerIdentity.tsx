"use client";

/**
 * Signed-in owner identity: truncated email, a link to the account page,
 * and a sign-out control. Rendered only when the shell has a verified
 * `ownerEmail` (see app/owner/layout.tsx + middleware.ts) — demo mode never
 * mounts this component.
 *
 * Stacked (email above the Account/Sign out row) rather than one long row —
 * the sidebar mounts this in a fixed 184px-wide column, so a single row of
 * badge + two controls doesn't fit.
 *
 * Sign out is a plain <button>, not the shared Button component: Button's
 * own base classes (rounded-full px-6 py-3.5) are too wide for this column,
 * and overriding them via className fights Tailwind's generated rule order
 * with no guarantee of winning. py-3.5 here matches Button's own vertical
 * scale so the tap target still clears 44px.
 */

import { useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

const controlClasses =
  "rounded px-1 py-3.5 transition-colors hover:text-ink";

export function OwnerIdentity({ email }: { email: string }) {
  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        window.location.href = "/login";
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      <span
        className="block max-w-[10rem] truncate text-xs font-medium text-ink"
        title={email}
      >
        {email}
      </span>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Link href="/owner/account" className={controlClasses}>
          Account
        </Link>
        <span aria-hidden="true" className="text-line">
          ·
        </span>
        <form action="/auth/signout" method="post">
          <button type="submit" className={controlClasses}>
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
