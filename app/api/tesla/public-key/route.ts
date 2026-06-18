import { NextResponse } from "next/server";
import { loadPublicKeyPem } from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves the partner public key. A rewrite (see next.config.ts) exposes this at
 * the exact path Tesla expects:
 *   /.well-known/appspecific/com.tesla.3p.public-key.pem
 *
 * Only needed if you register a partner account (vehicle pairing / telemetry).
 * Generate the key with `node scripts/tesla-setup.mjs genkeys`.
 */
export async function GET() {
  const pem = loadPublicKeyPem();
  if (!pem) {
    return new NextResponse("Public key not configured", { status: 404 });
  }
  return new NextResponse(pem, {
    headers: {
      "Content-Type": "application/x-pem-file",
      // Immutable public key; let Tesla / CDNs cache it.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
