import { NextRequest, NextResponse } from "next/server";
import { getEmailCaptureDbPool, reconcileSendGridEvent } from "@/lib/email/capture-db";
import { sendGridWebhookKeyringFromEnv, verifySendGridWebhookSignature } from "@/lib/email/sendgrid-webhook-security";

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

export async function POST(request: NextRequest) {
  const raw = Buffer.from(await request.arrayBuffer());
  const timestamp = request.headers.get("x-twilio-email-event-webhook-timestamp") ?? "";
  const signature = request.headers.get("x-twilio-email-event-webhook-signature") ?? "";
  try {
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1_000 - Number(timestamp)) > 300) throw new Error("stale");
    const keyVersion = verifySendGridWebhookSignature(raw, timestamp, signature, sendGridWebhookKeyringFromEnv());
    if (keyVersion === null) return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    const events = JSON.parse(raw.toString("utf8")) as SendGridEvent[];
    if (!Array.isArray(events) || events.length > 1000) throw new Error("invalid_events");
    const db = getEmailCaptureDbPool(); if (!db) throw new Error("email_capture_db_missing");
    let accepted = 0;
    for (const event of events) {
      const workspaceId = event.custom_args?.evhost_workspace_id ?? event.evhost_workspace_id;
      const deliveryId = event.custom_args?.evhost_delivery_id ?? event.evhost_delivery_id;
      if (!event.sg_event_id || !event.event || !workspaceId || !deliveryId || !event.timestamp) continue;
      const { data, error } = await reconcileSendGridEvent(db, {
        sgEventId: event.sg_event_id, workspaceId, deliveryId, eventType: event.event,
        responseCode: event.response?.slice(0, 200) ?? null, signatureKeyVersion: keyVersion,
        providerTimestamp: new Date(event.timestamp * 1_000).toISOString(),
      });
      if (!error && data === true) accepted += 1;
    }
    return NextResponse.json({ accepted }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Invalid event payload." }, { status: 400 }); }
}
