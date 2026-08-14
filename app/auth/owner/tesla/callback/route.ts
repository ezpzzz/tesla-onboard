import { NextRequest, NextResponse } from "next/server";
import {
  assertConfigured,
  exchangeCode,
  fetchProfile,
  getConfig,
  OWNER_PERSISTENT_SCOPES,
  resolveRegionBase,
  safeEqual,
  seal,
  unseal,
  verifyTeslaIdToken,
} from "@/lib/tesla-server";
import {
  credentialKeyringFromEnv,
  encryptCredential,
} from "@/lib/owner/credential-envelope";
import {
  createOwnerImportToken,
  OWNER_IMPORT_SESSION_TTL_MS,
  ownerImportTokenHash,
} from "@/lib/owner/import-session";
import { requireOwnerWorkspace } from "@/lib/owner/server-auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface OwnerIntegrationState {
  state: string;
  nonce: string;
  workspaceId: string;
  shopSlug: string;
  returnPath: string;
  durable?: boolean;
  issuedAt: number;
}

interface OwnerTransientFleetSession {
  kind: "transient_fleet";
  accessToken: string;
  verifiedSubject: string;
  expiresAt: number;
}

/**
 * Owner-side mirror of `/auth/tesla/callback`. Verifies the owner CSRF state,
 * exchanges the code using the owner redirect URI, reads identity + vehicles,
 * persists the rotating Tesla refresh credential server-side, and stores the
 * import profile in a short-lived private database session. The browser gets
 * only an opaque httpOnly handle, never provider credentials or a VIN payload.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const sealedState = request.cookies.get("rtr_owner_integration_state")?.value;
  const baseConfig = getConfig();
  const integrationState = sealedState
    ? unseal<OwnerIntegrationState>(
        sealedState,
        baseConfig.sessionSecret,
        "rtr_owner_integration_state",
      )
    : null;
  const returnPath = integrationState?.returnPath?.startsWith("/owner/")
    ? integrationState.returnPath
    : "/owner/setup";
  const destination = (query: string) =>
    NextResponse.redirect(new URL(`${returnPath}${query}`, origin));
  const fail = (reason: string) => {
    const response = destination(`?owner_tesla_error=${reason}`);
    response.cookies.delete("rtr_owner_integration_state");
    return response;
  };

  const ownerRedirectUri = process.env.TESLA_OWNER_REDIRECT_URI ?? "";
  if (!ownerRedirectUri) return fail("config");

  const durable = integrationState?.durable === true;
  const c = {
    ...baseConfig,
    redirectUri: ownerRedirectUri,
    scope: durable
      ? OWNER_PERSISTENT_SCOPES.join(" ")
      : "openid vehicle_device_data",
  };
  if (assertConfigured(c)) return fail("config");

  if (!integrationState || Date.now() - integrationState.issuedAt > 10 * 60 * 1_000) {
    return fail("state_mismatch");
  }
  if (url.searchParams.get("error")) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  if (!safeEqual(integrationState.state, state)) return fail("state_mismatch");

  try {
    const authorized = await requireOwnerWorkspace(
      integrationState.workspaceId,
      integrationState.shopSlug,
      "admin",
    );
    const token = await exchangeCode(c, code);
    if (!token.id_token || (durable && !token.refresh_token)) {
      return fail(durable ? "persistent_grant_missing" : "identity_missing");
    }
    const claims = await verifyTeslaIdToken(token.id_token, c.clientId, integrationState.nonce);
    if (!durable) {
      // The shared production Supabase project deliberately does not receive
      // this app's private import-session schema. Keep only the short-lived,
      // encrypted access credential in an httpOnly cookie and consume it once
      // in /api/owner/tesla/me. This keeps fleet size out of the cookie while
      // still returning every vehicle to the browser import step.
      const ttlSeconds = Math.min(Math.max(token.expires_in ?? 600, 1), 600);
      const transientSession: OwnerTransientFleetSession = {
        kind: "transient_fleet",
        accessToken: token.access_token,
        verifiedSubject: String(claims.sub),
        expiresAt: Date.now() + ttlSeconds * 1_000,
      };
      const res = destination("?owner_connected=1");
      res.cookies.set(
        "rtr_owner_tesla",
        seal(transientSession, c.sessionSecret, "rtr_owner_tesla"),
        {
          httpOnly: true,
          secure: origin.startsWith("https"),
          sameSite: "lax",
          path: "/",
          maxAge: ttlSeconds,
        },
      );
      res.cookies.delete("rtr_owner_integration_state");
      return res;
    }

    const regionBase = await resolveRegionBase(c.audience, token.access_token);
    const { profile, vehiclesOk } = await fetchProfile(c, token, {
      includeVehicleConfig: true,
      verifiedSubject: String(claims.sub),
    });

    // Identity succeeded but the vehicle read hard-failed (scope/region): surface it
    // rather than silently importing an owner with zero vehicles.
    if (!vehiclesOk) return fail("vehicles_unavailable");

    const keyring = credentialKeyringFromEnv();
    const subject = encryptCredential(String(claims.sub), keyring, {
      workspaceId: authorized.workspaceId,
      shopSlug: authorized.shopSlug,
      provider: "tesla",
      field: "provider_subject",
    });
    const refresh = encryptCredential(token.refresh_token!, keyring, {
      workspaceId: authorized.workspaceId,
      shopSlug: authorized.shopSlug,
      provider: "tesla",
      field: "refresh_token",
    });
    const grantedScopes = token.scope?.split(/\s+/).filter(Boolean)
      ?? [...OWNER_PERSISTENT_SCOPES];
    const supabase = await createClient();
    const { error: persistenceError } = await supabase.rpc(
      "complete_onlyevs_integration",
      {
        p_workspace_id: authorized.workspaceId,
        p_shop_slug: authorized.shopSlug,
        p_provider: "tesla",
        p_account_label: profile.email || profile.fullName || authorized.email,
        p_granted_scopes: grantedScopes,
        p_region_base_url: regionBase,
        p_selected_calendar_id: null,
        p_selected_calendar_timezone: null,
        p_provider_subject_ciphertext: subject.ciphertext,
        p_refresh_token_ciphertext: refresh.ciphertext,
        p_key_version: subject.keyVersion,
        p_token_expires_at: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1_000).toISOString()
          : null,
      },
    );
    if (persistenceError) throw new Error(`integration_persist:${persistenceError.code}`);

    const importToken = createOwnerImportToken();
    const { error: importSessionError } = await supabase.rpc(
      "create_onlyevs_owner_import_session",
      {
        p_workspace_id: authorized.workspaceId,
        p_shop_slug: authorized.shopSlug,
        p_token_hash: ownerImportTokenHash(importToken),
        p_profile: profile,
        p_expires_at: new Date(Date.now() + OWNER_IMPORT_SESSION_TTL_MS).toISOString(),
      },
    );
    if (importSessionError) throw new Error(`import_session:${importSessionError.code}`);

    const res = destination("?owner_connected=1");
    res.cookies.set("rtr_owner_tesla", importToken, {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(OWNER_IMPORT_SESSION_TTL_MS / 1_000),
    });
    res.cookies.delete("rtr_owner_integration_state");
    return res;
  } catch (error) {
    console.error(
      "[owner-tesla] persistent connection failed",
      error instanceof Error ? error.message.split(":")[0] : "unknown",
    );
    return fail("exchange_failed");
  }
}
