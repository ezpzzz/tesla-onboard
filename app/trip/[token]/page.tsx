import crypto from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface InvitationRow {
  workspace_id: string;
  shop_slug: string;
}

export default async function GuestTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) notFound();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const supabase = await createClient();
  const { data: invitationData } = await supabase.rpc("get_onlyevs_trip_invitation", {
    p_public_token_hash: tokenHash,
  });
  const invitation = (Array.isArray(invitationData) ? invitationData[0] : invitationData) as InvitationRow | null;
  if (!invitation) notFound();

  const tenantRef = `${invitation.workspace_id}~${invitation.shop_slug}`;
  const query = new URLSearchParams({ tenant: tenantRef, trip: token });
  redirect(`/?${query.toString()}`);
}
