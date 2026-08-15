import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { OwnerTenantProvider } from "@/components/owner/OwnerTenantProvider";
import { OwnerDataProvider } from "@/lib/owner/use-owner-data";
import { isOwnerAuthConfigured } from "@/lib/owner-auth";
import {
  ownerAvatarUrl,
  ownerDisplayName,
  type OwnerAuthUserLike,
} from "@/lib/owner/owner-avatar";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  if (!isOwnerAuthConfigured()) {
    return (
      <OwnerTenantProvider>
        <OwnerDataProvider>
          <OwnerShell>{children}</OwnerShell>
        </OwnerDataProvider>
      </OwnerTenantProvider>
    );
  }

  // Defense-in-depth: proxy.ts already gates /owner on a verified email.
  // This is the second independent layer in case a
  // request ever reaches this layout without passing through middleware.
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data.user;
  const email = user?.email ?? null;
  if (!email) {
    redirect("/login");
  }
  if (error || !user) redirect("/login");
  const ownerUser = user as OwnerAuthUserLike;

  return (
    <OwnerTenantProvider>
      <OwnerDataProvider>
        <OwnerShell
          ownerEmail={email}
          ownerName={ownerDisplayName(ownerUser)}
          ownerAvatarUrl={ownerAvatarUrl(ownerUser)}
        >
          {children}
        </OwnerShell>
      </OwnerDataProvider>
    </OwnerTenantProvider>
  );
}
