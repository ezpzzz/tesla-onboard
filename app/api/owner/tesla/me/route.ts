import { NextRequest, NextResponse } from "next/server";
import { getConfig, unseal } from "@/lib/tesla-server";
import type { TeslaProfile } from "@/lib/tesla";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner-side mirror of `/api/tesla/me`. Reads the owner's own sealed cookie. */
export async function GET(request: NextRequest) {
  const { sessionSecret } = getConfig();
  const sealed = request.cookies.get("rtr_owner_tesla")?.value;
  const profile =
    sealed && sessionSecret
      ? unseal<TeslaProfile>(sealed, sessionSecret, "rtr_owner_tesla")
      : null;
  return NextResponse.json(
    { profile },
    { headers: { "Cache-Control": "no-store" } },
  );
}
