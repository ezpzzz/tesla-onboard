import { NextRequest, NextResponse } from "next/server";
import {
  assertConfigured,
  exchangeCode,
  fetchProfile,
  getConfig,
  safeEqual,
  seal,
  unseal,
  verifyTeslaIdToken,
} from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface GuestTeslaState {
  state: string;
  nonce: string;
  returnTo: string;
  issuedAt: number;
}

/**
 * OAuth callback (server-side). Verifies CSRF state, exchanges the code for
 * tokens using the confidential client secret, reads identity + vehicles once,
 * seals the normalized profile into an httpOnly cookie, then discards tokens
 * and redirects home. The browser never sees a token.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const c = getConfig();
  const sealedState = request.cookies.get("rtr_state")?.value;
  const authState = sealedState
    ? unseal<GuestTeslaState>(sealedState, c.sessionSecret, "rtr_state")
    : null;
  const safeReturn = authState?.returnTo?.startsWith("/") && !authState.returnTo.startsWith("//")
    ? authState.returnTo
    : "/";
  const destination = (key: string, value: string) => {
    const target = new URL(safeReturn, origin);
    target.searchParams.set(key, value);
    return NextResponse.redirect(target);
  };
  const fail = (reason: string) => destination("tesla_error", reason);
  if (assertConfigured(c)) return fail("config");
  if (!authState || Date.now() - authState.issuedAt > 10 * 60 * 1_000) return fail("state_mismatch");

  if (url.searchParams.get("error")) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  if (!safeEqual(authState.state, state)) return fail("state_mismatch");

  try {
    const token = await exchangeCode(c, code);
    if (!token.id_token) return fail("exchange_failed");
    const claims = await verifyTeslaIdToken(token.id_token, c.clientId, authState.nonce);
    const { profile, vehiclesOk } = await fetchProfile(c, token, {
      verifiedSubject: String(claims.sub),
    });

    // Identity succeeded but the vehicle read hard-failed (scope/region): surface it
    // rather than silently downgrading a real owner to "account, no car".
    if (!vehiclesOk) return fail("vehicles_unavailable");

    const res = destination("connected", "1");
    res.cookies.set("rtr_tesla", seal(profile, c.sessionSecret, "rtr_tesla"), {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    res.cookies.delete("rtr_state");
    return res;
  } catch {
    return fail("exchange_failed");
  }
}
