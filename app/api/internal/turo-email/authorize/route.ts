import { NextRequest, NextResponse } from "next/server";
import { parseCanonicalJson, type AuthorizeManifest } from "@evhost/email-ingest-contract";
import { authenticateEmailCaptureRequest } from "@/lib/email/internal-route";
import { authorizeEmailAlias } from "@/lib/email/capture-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const KEYS = ["version","aliasId","envelopeRecipientHash","sourceMessageId","requestedInboundId","timestamp","nonce"] as const;

export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateEmailCaptureRequest(request, "authorize");
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = parseCanonicalJson<AuthorizeManifest>(auth.body, KEYS);
    const { data, error } = await authorizeEmailAlias(auth.db, {
      aliasHash: body.envelopeRecipientHash, inboundId: body.requestedInboundId,
      rfcMessageId: body.sourceMessageId,
    });
    if (error || !Array.isArray(data) || !data[0]) return NextResponse.json({ error: "Alias not accepting mail." }, { status: 403 });
    return NextResponse.json(data[0], { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid capture manifest." }, { status: 400 }); }
}
