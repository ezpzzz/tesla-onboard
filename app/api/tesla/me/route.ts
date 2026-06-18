import { NextRequest, NextResponse } from "next/server";
import { getConfig, unseal } from "@/lib/tesla-server";
import type { TeslaProfile } from "@/lib/tesla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Return the normalized profile from the sealed session cookie (or null). */
export async function GET(request: NextRequest) {
  const { sessionSecret } = getConfig();
  const sealed = request.cookies.get("rtr_tesla")?.value;
  const profile =
    sealed && sessionSecret ? unseal<TeslaProfile>(sealed, sessionSecret) : null;
  return NextResponse.json(
    { profile },
    { headers: { "Cache-Control": "no-store" } },
  );
}
