import crypto from "node:crypto";
import { notFound, redirect } from "next/navigation";
import { GuestTripGate } from "@/components/guest/GuestTripGate";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

interface InvitationRow {
  trip_id: string;
  workspace_id: string;
  shop_slug: string;
  company_name: string;
  vehicle_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
}

export default async function GuestTripPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_PATTERN.test(token)) notFound();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const supabase = await createClient();
  const [{ data: invitationData }, { data: userData }] = await Promise.all([
    supabase.rpc("get_onlyevs_trip_invitation", { p_public_token_hash: tokenHash }),
    supabase.auth.getUser(),
  ]);
  const invitation = (Array.isArray(invitationData) ? invitationData[0] : invitationData) as InvitationRow | null;
  if (!invitation) notFound();

  if (userData.user) {
    const { data: binding, error } = await supabase.rpc("bind_onlyevs_trip_guest", {
      p_public_token_hash: tokenHash,
    });
    const row = (Array.isArray(binding) ? binding[0] : binding) as { tenant_ref?: string } | null;
    if (!error && row?.tenant_ref) {
      const query = new URLSearchParams({ tenant: row.tenant_ref, trip: token });
      redirect(`/?${query.toString()}`);
    }
  }

  return (
    <GuestTripGate
      token={token}
      companyName={invitation.company_name}
      vehicleName={invitation.vehicle_name}
      startsAt={invitation.starts_at}
      endsAt={invitation.ends_at}
      timezone={invitation.timezone}
    />
  );
}
