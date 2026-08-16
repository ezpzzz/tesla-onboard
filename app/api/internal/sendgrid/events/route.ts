import { createPublicKey, verify } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SendGridEvent {
  sg_event_id?: string;
  event?: "processed" | "delivered" | "deferred" | "bounce" | "dropped" | "blocked";
  timestamp?: number;
  response?: string;
  custom_args?: { evhost_workspace_id?: string; evhost_delivery_id?: string };
  evhost_workspace_id?: string;
  evhost_delivery_id?: string;
}

function publicKey() {
  const raw = process.env.EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY?.trim() ?? "";
  if (!raw) throw new Error("sendgrid_webhook_key_missing");
  return createPublicKey(raw.includes("BEGIN PUBLIC KEY") ? raw.replaceAll("\\n", "\n") : { key: Buffer.from(raw, "base64"), format: "der", type: "spki" });
}

export async function POST(request: NextRequest) {
  const raw = Buffer.from(await request.arrayBuffer());
  const timestamp = request.headers.get("x-twilio-email-event-webhook-timestamp") ?? "";
  const signature = request.headers.get("x-twilio-email-event-webhook-signature") ?? "";
  try {
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300) throw new Error("stale");
    const valid = verify("sha256", Buffer.concat([Buffer.from(timestamp), raw]), publicKey(), Buffer.from(signature, "base64"));
    if (!valid) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    const events = JSON.parse(raw.toString("utf8")) as SendGridEvent[];
    if (!Array.isArray(events) || events.length > 1000) throw new Error("invalid_events");
    const service = createServiceRoleClient(); if (!service) throw new Error("service_role_missing");
    let accepted = 0;
    for (const event of events) {
      const workspaceId = event.custom_args?.evhost_workspace_id ?? event.evhost_workspace_id;
      const deliveryId = event.custom_args?.evhost_delivery_id ?? event.evhost_delivery_id;
      if (!event.sg_event_id || !event.event || !workspaceId || !deliveryId || !event.timestamp) continue;
      const { data, error } = await service.rpc("reconcile_onlyevs_sendgrid_event", { p_sg_event_id: event.sg_event_id, p_workspace_id: workspaceId, p_delivery_id: deliveryId, p_event_type: event.event, p_response_code: event.response?.slice(0, 200) ?? null, p_signature_key_version: 1, p_provider_timestamp: new Date(event.timestamp * 1_000).toISOString() });
      if (!error && data === true) accepted += 1;
    }
    return NextResponse.json({ accepted }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid event payload." }, { status: 400 }); }
}
