import { NextRequest, NextResponse } from "next/server";
import {
  assertGoogleCalendarConfigured,
  exchangeGoogleCalendarCode,
  fetchGoogleCalendarEvents,
  fetchGooglePrimaryCalendar,
  getGoogleCalendarConfig,
  GOOGLE_CALENDAR_SCOPE,
  verifyGoogleIdToken,
} from "@/lib/google-calendar-server";
import { normalizeGoogleCalendarEvent } from "@/lib/owner/google-calendar";
import {
  credentialKeyringFromEnv,
  encryptCredential,
  oauthStateSecretFromEnv,
} from "@/lib/owner/credential-envelope";
import { requireOwnerWorkspace } from "@/lib/owner/server-auth";
import { createClient } from "@/lib/supabase/server";
import { safeEqual, unseal } from "@/lib/tesla-server";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GoogleIntegrationState {
  state: string;
  nonce: string;
  codeVerifier: string;
  workspaceId: string;
  shopSlug: string;
  returnPath: string;
  issuedAt: number;
}

interface IntegrationRow {
  id: string;
}

export async function GET(request: NextRequest) {
  if (!ONLYEVS_OPERATIONS_ENABLED) return NextResponse.redirect(new URL("/owner/settings?google_calendar_error=not_available", request.url));
  const url = new URL(request.url);
  const origin = url.origin;
  const secret = (() => {
    try { return oauthStateSecretFromEnv(); } catch { return ""; }
  })();
  const sealed = request.cookies.get("rtr_owner_google_state")?.value;
  const state = secret && sealed
    ? unseal<GoogleIntegrationState>(sealed, secret, "rtr_owner_google_state")
    : null;
  const returnPath = state?.returnPath?.startsWith("/owner/")
    ? state.returnPath
    : "/owner/settings";
  const fail = (reason: string) => {
    const response = NextResponse.redirect(
      new URL(`${returnPath}?google_calendar_error=${reason}`, origin),
    );
    response.cookies.delete("rtr_owner_google_state");
    return response;
  };

  if (!state || Date.now() - state.issuedAt > 10 * 60 * 1_000) return fail("state_mismatch");
  if (url.searchParams.get("error")) return fail("denied");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");
  if (!code || !returnedState || !safeEqual(state.state, returnedState)) {
    return fail("state_mismatch");
  }

  try {
    await requireOwnerWorkspace(state.workspaceId, state.shopSlug, "admin");
    const config = getGoogleCalendarConfig();
    if (assertGoogleCalendarConfigured(config)) return fail("config");
    const token = await exchangeGoogleCalendarCode({
      config,
      code,
      codeVerifier: state.codeVerifier,
    });
    if (!token.id_token || !token.refresh_token) return fail("persistent_grant_missing");
    const claims = await verifyGoogleIdToken({
      idToken: token.id_token,
      clientId: config.clientId,
      nonce: state.nonce,
    });
    const calendar = await fetchGooglePrimaryCalendar(token.access_token);
    const now = Date.now();
    const eventResult = await fetchGoogleCalendarEvents({
      accessToken: token.access_token,
      calendarId: calendar.id,
      timeMin: new Date(now - 24 * 60 * 60 * 1_000),
      timeMax: new Date(now + 180 * 24 * 60 * 60 * 1_000),
    });
    const candidates = eventResult.events
      .map(normalizeGoogleCalendarEvent)
      .filter((candidate) => candidate !== null);

    const keyring = credentialKeyringFromEnv();
    const subject = encryptCredential(String(claims.sub), keyring, {
      workspaceId: state.workspaceId,
      shopSlug: state.shopSlug,
      provider: "google_calendar",
      field: "provider_subject",
    });
    const refresh = encryptCredential(token.refresh_token, keyring, {
      workspaceId: state.workspaceId,
      shopSlug: state.shopSlug,
      provider: "google_calendar",
      field: "refresh_token",
    });
    const supabase = await createClient();
    const { data: integrationData, error: integrationError } = await supabase.rpc(
      "complete_onlyevs_integration",
      {
        p_workspace_id: state.workspaceId,
        p_shop_slug: state.shopSlug,
        p_provider: "google_calendar",
        p_account_label: typeof claims.email === "string" ? claims.email : calendar.summary ?? "Google Calendar",
        p_granted_scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [GOOGLE_CALENDAR_SCOPE],
        p_region_base_url: null,
        p_selected_calendar_id: calendar.id,
        p_selected_calendar_timezone: calendar.timeZone ?? "UTC",
        p_provider_subject_ciphertext: subject.ciphertext,
        p_refresh_token_ciphertext: refresh.ciphertext,
        p_key_version: subject.keyVersion,
        p_token_expires_at: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1_000).toISOString()
          : null,
      },
    );
    if (integrationError) throw new Error(`integration_persist:${integrationError.code}`);
    const integration = integrationData as IntegrationRow | null;
    if (!integration?.id) throw new Error("integration_id_missing");

    if (candidates.length > 0) {
      const { error: ingestError } = await supabase.rpc(
        "ingest_onlyevs_calendar_candidates",
        {
          p_workspace_id: state.workspaceId,
          p_shop_slug: state.shopSlug,
          p_integration_id: integration.id,
          p_candidates: candidates.map((candidate) => ({
            external_event_id: candidate.externalEventId,
            external_ical_uid: candidate.externalIcalUid,
            recurring_instance_key: candidate.recurringInstanceKey,
            summary: candidate.summary,
            starts_at: candidate.startsAt,
            ends_at: candidate.endsAt,
            timezone: candidate.timezone,
            source_updated_at: candidate.sourceUpdatedAt,
            source_revision: candidate.sourceRevision,
            status: candidate.status,
            deleted_at: candidate.deletedAt,
          })),
        },
      );
      if (ingestError) throw new Error(`candidate_ingest:${ingestError.code}`);
    }

    const response = NextResponse.redirect(
      new URL(`${returnPath}?google_calendar_connected=1`, origin),
    );
    response.cookies.delete("rtr_owner_google_state");
    return response;
  } catch (error) {
    console.error(
      "[owner-google] calendar connection failed",
      error instanceof Error ? error.message.split(":")[0] : "unknown",
    );
    return fail("exchange_failed");
  }
}
