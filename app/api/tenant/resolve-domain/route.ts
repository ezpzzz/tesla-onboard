import { NextResponse, type NextRequest } from "next/server";
import { createAnonymousClient } from "@/lib/supabase/server";
import { tenantReference } from "@/lib/tenant-config";
import { isReservedCustomHostname } from "@/lib/custom-domain";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

function requestHostname(request: NextRequest): string | null {
  // Browsers cannot forge Host, while X-Forwarded-Host can be supplied by an
  // untrusted upstream outside the managed deployment. Resolve only the host
  // that actually terminated this request.
  const host = request.headers.get("host") || "";
  const normalized = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return normalized && !normalized.includes("/") ? normalized : null;
}

export async function GET(request: NextRequest) {
  const hostname = requestHostname(request);
  if (!hostname) return NextResponse.json({ tenant: null }, { status: 404 });
  if (isReservedCustomHostname(
    hostname,
    process.env.ONLYEVS_CANONICAL_ORIGIN,
    process.env.ONLYEVS_RESERVED_HOSTNAMES,
  )) {
    return NextResponse.json({ kind: "canonical", tenant: null }, {
      headers: { "Cache-Control": "public, max-age=30", Vary: "Host" },
    });
  }
  if (!ONLYEVS_OPERATIONS_ENABLED) {
    return NextResponse.json({ kind: "unknown", tenant: null }, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=30", Vary: "Host" },
    });
  }
  const supabase = createAnonymousClient();
  const { data, error } = await supabase
    .from("onlyevs_custom_domains")
    .select("workspace_id,shop_slug")
    .eq("hostname", hostname)
    .eq("status", "active")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ kind: "unknown", tenant: null }, {
      status: 404,
      headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=60", Vary: "Host" },
    });
  }
  return NextResponse.json({
    kind: "custom",
    tenant: tenantReference(data.workspace_id, data.shop_slug),
  }, {
    headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300", Vary: "Host" },
  });
}
