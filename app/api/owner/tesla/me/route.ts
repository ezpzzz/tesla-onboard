import { NextRequest, NextResponse } from "next/server";
import {
  OWNER_IMPORT_TOKEN_PATTERN,
  ownerImportTokenHash,
} from "@/lib/owner/import-session";
import { createClient } from "@/lib/supabase/server";
import type { TeslaProfile } from "@/lib/tesla";
import { fetchProfile, getConfig, unseal } from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OwnerTransientFleetSession {
  kind: "transient_fleet";
  accessToken: string;
  verifiedSubject: string;
  expiresAt: number;
}

function isTransientFleetSession(value: unknown): value is OwnerTransientFleetSession {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<OwnerTransientFleetSession>;
  return row.kind === "transient_fleet"
    && typeof row.accessToken === "string"
    && row.accessToken.length > 0
    && typeof row.verifiedSubject === "string"
    && row.verifiedSubject.length > 0
    && typeof row.expiresAt === "number";
}

function profileResponse(profile: TeslaProfile | null, clearCookie = false) {
  const response = NextResponse.json(
    { profile },
    { headers: { "Cache-Control": "no-store" } },
  );
  if (clearCookie) response.cookies.delete("rtr_owner_tesla");
  return response;
}

/** Resolve the owner's opaque, short-lived import handle server-side. */
export async function GET(request: NextRequest) {
  const token = request.cookies.get("rtr_owner_tesla")?.value ?? "";
  if (!OWNER_IMPORT_TOKEN_PATTERN.test(token)) {
    const config = getConfig();
    const session = token && config.sessionSecret
      ? unseal<TeslaProfile | OwnerTransientFleetSession>(token, config.sessionSecret, "rtr_owner_tesla")
      : null;
    if (!isTransientFleetSession(session)) return profileResponse(session);
    if (session.expiresAt <= Date.now()) return profileResponse(null, true);
    try {
      const result = await fetchProfile(
        {
          ...config,
          redirectUri: process.env.TESLA_OWNER_REDIRECT_URI ?? config.redirectUri,
          scope: "openid vehicle_device_data",
        },
        { access_token: session.accessToken },
        { includeVehicleConfig: true, verifiedSubject: session.verifiedSubject },
      );
      return profileResponse(result.vehiclesOk ? result.profile : null, true);
    } catch {
      return profileResponse(null, true);
    }
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_onlyevs_owner_import_profile", {
    p_token_hash: ownerImportTokenHash(token),
  });
  const profile = !error && data && typeof data === "object" ? data as TeslaProfile : null;
  return profileResponse(profile);
}
