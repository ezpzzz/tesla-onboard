import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { OwnerShell } from "@/components/owner/OwnerShell";
import { isAllowedOwnerEmail, isOwnerAuthConfigured } from "@/lib/owner-auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function OwnerLayout({ children }: { children: ReactNode }) {
  if (!isOwnerAuthConfigured()) {
    return <OwnerShell>{children}</OwnerShell>;
  }

  // Defense-in-depth: middleware.ts already gates /owner on a verified,
  // allowlisted email. This is the second independent layer in case a
  // request ever reaches this layout without passing through middleware.
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = data?.claims?.email ?? null;
  if (!email || !isAllowedOwnerEmail(email)) {
    redirect("/login");
  }

  return <OwnerShell ownerEmail={email}>{children}</OwnerShell>;
}
