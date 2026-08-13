import { NextRequest, NextResponse } from "next/server";
import {
  assertConfigured,
  exchangeCode,
  fetchProfile,
  getConfig,
  safeEqual,
  seal,
} from "@/lib/tesla-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner-side mirror of `/auth/tesla/callback`. Verifies the owner CSRF state,
 * exchanges the code using the owner redirect URI, reads identity + vehicles
 * once, seals the normalized profile into its own httpOnly cookie (separate
 * from the guest session), then discards tokens and returns to the setup
 * wizard. The browser never sees a token.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const setup = (query: string) =>
    NextResponse.redirect(new URL(`/owner/setup${query}`, origin));
  const fail = (reason: string) => setup(`?owner_tesla_error=${reason}`);

  const ownerRedirectUri = process.env.TESLA_OWNER_REDIRECT_URI ?? "";
  if (!ownerRedirectUri) return fail("config");

  const c = { ...getConfig(), redirectUri: ownerRedirectUri };
  if (assertConfigured(c)) return fail("config");

  if (url.searchParams.get("error")) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  const expected = request.cookies.get("rtr_owner_state")?.value;
  if (!expected || !safeEqual(expected, state)) return fail("state_mismatch");

  try {
    const token = await exchangeCode(c, code);
    const { profile, vehiclesOk } = await fetchProfile(c, token);

    // Identity succeeded but the vehicle read hard-failed (scope/region): surface it
    // rather than silently importing an owner with zero vehicles.
    if (!vehiclesOk) return fail("vehicles_unavailable");

    const res = setup("?owner_connected=1");
    res.cookies.set("rtr_owner_tesla", seal(profile, c.sessionSecret, "rtr_owner_tesla"), {
      httpOnly: true,
      secure: origin.startsWith("https"),
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    res.cookies.delete("rtr_owner_state");
    return res;
  } catch {
    return fail("exchange_failed");
  }
}
