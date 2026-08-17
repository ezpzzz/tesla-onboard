import { NextRequest, NextResponse } from "next/server";
import { parseCanonicalJson, type CaptureFinalizeManifest, type CaptureInitManifest } from "@evhost/email-ingest-contract";
import { authenticateEmailCaptureRequest } from "@/lib/email/internal-route";
import { finalizeEmailCapture, initEmailCapture, type InboundEmailRow, type RpcResult } from "@/lib/email/capture-db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const INIT_KEYS = ["version","phase","inboundId","acceptedAliasRevision","rawSha256","normalizedSha256","rawBytes","normalizedBytes","authVerdict","kekVersion","timestamp","nonce"] as const;
const FINAL_KEYS = ["version","phase","inboundId","objectKey","ciphertextSha256","ciphertextBytes","wrappedDekSha256","kekVersion","deleteAfter","timestamp","nonce"] as const;

export async function POST(request: NextRequest) {
  const phase = request.nextUrl.searchParams.get("phase");
  if (phase !== "init" && phase !== "finalize") return NextResponse.json({ error: "Invalid capture phase." }, { status: 400 });
  try {
    const auth = await authenticateEmailCaptureRequest(request, phase);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    let outcome: RpcResult<InboundEmailRow>;
    if (phase === "init") {
      const parsed = parseCanonicalJson<CaptureInitManifest>(auth.body, INIT_KEYS);
      outcome = await initEmailCapture(auth.db, {
        inboundId: parsed.inboundId, aliasRevision: parsed.acceptedAliasRevision,
        rawSha256: parsed.rawSha256, normalizedSha256: parsed.normalizedSha256,
        rawBytes: parsed.rawBytes, normalizedBytes: parsed.normalizedBytes,
        authVerdict: parsed.authVerdict, kekVersion: parsed.kekVersion,
      });
    } else {
      const parsed = parseCanonicalJson<CaptureFinalizeManifest>(auth.body, FINAL_KEYS);
      outcome = await finalizeEmailCapture(auth.db, {
        inboundId: parsed.inboundId, objectKey: parsed.objectKey,
        ciphertextSha256: parsed.ciphertextSha256, ciphertextBytes: parsed.ciphertextBytes,
        wrappedDekSha256: parsed.wrappedDekSha256, kekVersion: parsed.kekVersion, deleteAfter: parsed.deleteAfter,
      });
    }
    if (outcome.error || !outcome.data) return NextResponse.json({ error: "Capture conflict." }, { status: 409 });
    return NextResponse.json({ id: outcome.data.id, state: outcome.data.state }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid capture manifest." }, { status: 400 }); }
}
