import { NextRequest, NextResponse } from "next/server";
import { parseCanonicalJson, type AuthorizeManifest } from "@evhost/email-ingest-contract";
import { authenticateEmailCaptureRequest } from "@/lib/email/internal-route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const KEYS = ["version","aliasId","envelopeRecipientHash","sourceMessageId","requestedInboundId","timestamp","nonce"] as const;

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateEmailCaptureRequest(request, "authorize");
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = parseCanonicalJson<AuthorizeManifest>(auth.body, KEYS);
    const { data, error } = await auth.service.rpc("authorize_onlyevs_email_alias", {
      p_alias_hash: body.envelopeRecipientHash, p_inbound_id: body.requestedInboundId,
      p_rfc_message_id: body.sourceMessageId,
    });
    if (error || !Array.isArray(data) || !data[0]) return NextResponse.json({ error: "Alias not accepting mail." }, { status: 403 });
    return NextResponse.json(data[0], { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid capture manifest." }, { status: 400 }); }
}
