import { NextRequest, NextResponse } from "next/server";
import { parseCanonicalJson, type CaptureFinalizeManifest, type CaptureInitManifest } from "@evhost/email-ingest-contract";
import { authenticateEmailCaptureRequest } from "@/lib/email/internal-route";

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
    const parsed = phase === "init"
      ? parseCanonicalJson<CaptureInitManifest>(auth.body, INIT_KEYS)
      : parseCanonicalJson<CaptureFinalizeManifest>(auth.body, FINAL_KEYS);
    const rpc = phase === "init" ? "init_onlyevs_email_capture" : "finalize_onlyevs_email_capture";
    const args = phase === "init" ? {
      p_inbound_id: parsed.inboundId, p_alias_revision: (parsed as CaptureInitManifest).acceptedAliasRevision,
      p_raw_sha256: (parsed as CaptureInitManifest).rawSha256, p_normalized_sha256: (parsed as CaptureInitManifest).normalizedSha256,
      p_raw_bytes: (parsed as CaptureInitManifest).rawBytes, p_normalized_bytes: (parsed as CaptureInitManifest).normalizedBytes,
      p_auth_verdict: (parsed as CaptureInitManifest).authVerdict, p_kek_version: parsed.kekVersion,
    } : {
      p_inbound_id: parsed.inboundId, p_object_key: (parsed as CaptureFinalizeManifest).objectKey,
      p_ciphertext_sha256: (parsed as CaptureFinalizeManifest).ciphertextSha256,
      p_ciphertext_bytes: (parsed as CaptureFinalizeManifest).ciphertextBytes,
      p_wrapped_dek_sha256: (parsed as CaptureFinalizeManifest).wrappedDekSha256,
      p_kek_version: parsed.kekVersion, p_delete_after: (parsed as CaptureFinalizeManifest).deleteAfter,
    };
    const { data, error } = await auth.service.rpc(rpc, args);
    if (error) return NextResponse.json({ error: "Capture conflict." }, { status: 409 });
    return NextResponse.json({ id: data.id, state: data.state }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid capture manifest." }, { status: 400 }); }
}
