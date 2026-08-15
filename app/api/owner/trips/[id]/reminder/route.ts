import { NextRequest, NextResponse } from "next/server";
import { canonicalOnlyEvsOrigin } from "@/lib/onlyevs-origin";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { decryptTripLink } from "@/lib/owner/trip-link-secret";
import { sendGridConfigFromEnv, sendGridTripReminder } from "@/lib/owner/sendgrid";
import { publishedTenantConfigFromFeatures } from "@/lib/tenant-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private", Pragma: "no-cache" } });
}

interface ReminderMaterial {
  delivery_id: string;
  workspace_id: string;
  shop_slug: string;
  guest_name: string;
  guest_email: string;
  company_name: string;
  vehicle_name: string;
  starts_at: string;
  timezone: string;
  pickup_location: string | null;
  token_ciphertext: string;
  key_version: number;
}

interface ReminderPreparation {
  delivery_id: string;
}

function rateError(message: string): { status: number; message: string } {
  if (message.includes("cooldown")) return { status: 429, message: "A reminder was already sent recently. Try again in five minutes." };
  if (message.includes("retry_delay")) return { status: 429, message: "Wait one minute before retrying this reminder." };
  if (message.includes("daily_limit")) return { status: 429, message: "The reminder limit has been reached for today." };
  if (message.includes("manager_required")) return { status: 403, message: "Your workspace role does not allow reminders." };
  if (message.includes("trip_not_found")) return { status: 404, message: "Trip not found." };
  return { status: 409, message: "A reminder is not available for this trip." };
}

export async function POST(request: NextRequest, context: RouteContext<"/api/owner/trips/[id]/reminder">) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return reply({ error: "Cross-origin reminder delivery was rejected." }, 403);
  }
  if (process.env.EVHOST_REMINDERS_ENABLED !== "true") return reply({ error: "Reminders are not enabled." }, 404);
  const config = sendGridConfigFromEnv();
  if (!config) return reply({ error: "Reminder delivery is not configured." }, 503);
  const serviceClient = createServiceRoleClient();
  if (!serviceClient) return reply({ error: "Reminder security is not configured." }, 503);

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return reply({ error: "Trip not found." }, 404);
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return reply({ error: "Your owner session expired." }, 401);

  const { data, error } = await supabase.rpc("begin_onlyevs_trip_reminder", { p_trip_id: id });
  if (error) {
    const mapped = rateError(error.message);
    return reply({ error: mapped.message }, mapped.status);
  }
  const preparation = (Array.isArray(data) ? data[0] : data) as ReminderPreparation | null;
  if (!preparation?.delivery_id) return reply({ error: "Reminder delivery could not be prepared." }, 500);
  const { data: materialData, error: materialError } = await serviceClient.rpc("get_onlyevs_trip_reminder_material", {
    p_delivery_id: preparation.delivery_id,
  });
  const material = (Array.isArray(materialData) ? materialData[0] : materialData) as ReminderMaterial | null;
  if (materialError || !material?.delivery_id) {
    await supabase.rpc("finish_onlyevs_trip_reminder", {
      p_delivery_id: preparation.delivery_id,
      p_status: "failed",
      p_provider_message_id: null,
      p_error_code: "reminder_material_unavailable",
    });
    return reply({ error: "Reminder delivery material is unavailable." }, 503);
  }

  let token: string;
  try {
    token = decryptTripLink({
      workspaceId: material.workspace_id,
      shopSlug: material.shop_slug,
      tripId: id,
      tokenCiphertext: material.token_ciphertext,
    });
  } catch {
    await supabase.rpc("finish_onlyevs_trip_reminder", {
      p_delivery_id: material.delivery_id,
      p_status: "failed",
      p_provider_message_id: null,
      p_error_code: "trip_link_decryption_failed",
    });
    return reply({ error: "The private trip link could not be opened for delivery." }, 503);
  }

  const { data: brandRow } = await supabase
    .from("workspace_branding")
    .select("features")
    .eq("workspace_id", material.workspace_id)
    .eq("shop_slug", material.shop_slug)
    .maybeSingle();
  const tenant = publishedTenantConfigFromFeatures(brandRow?.features, {
    workspaceId: material.workspace_id,
    shopSlug: material.shop_slug,
  });
  const pickupDate = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: material.timezone || "UTC",
  }).format(new Date(material.starts_at));

  try {
    const sent = await sendGridTripReminder({
      config,
      recipient: material.guest_email,
      replyTo: tenant?.supportEmail || null,
      companyName: material.company_name,
      guestName: material.guest_name,
      vehicleName: material.vehicle_name,
      pickupDate,
      pickupLocation: material.pickup_location,
      portalUrl: `${canonicalOnlyEvsOrigin(request)}/trip/${token}`,
    });
    const { data: finished, error: finishError } = await supabase.rpc("finish_onlyevs_trip_reminder", {
      p_delivery_id: material.delivery_id,
      p_status: "sent",
      p_provider_message_id: sent.messageId,
      p_error_code: null,
    });
    if (finishError) return reply({ error: "The reminder was sent, but its delivery receipt could not be recorded." }, 502);
    const receipt = (Array.isArray(finished) ? finished[0] : finished) as { recipient_masked?: string; sent_at?: string } | null;
    return reply({ recipient: receipt?.recipient_masked ?? "Guest", sentAt: receipt?.sent_at ?? new Date().toISOString() });
  } catch (sendError) {
    const code = sendError instanceof Error && /^sendgrid_\d+$/.test(sendError.message)
      ? sendError.message
      : "sendgrid_unavailable";
    await supabase.rpc("finish_onlyevs_trip_reminder", {
      p_delivery_id: material.delivery_id,
      p_status: "failed",
      p_provider_message_id: null,
      p_error_code: code,
    });
    return reply({ error: "SendGrid could not deliver the reminder. Try again in one minute." }, 502);
  }
}
