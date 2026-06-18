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
 * OAuth callback (server-side). Verifies CSRF state, exchanges the code for
 * tokens using the confidential client secret, reads identity + vehicles once,
 * seals the normalized profile into an httpOnly cookie, then discards tokens
 * and redirects home. The browser never sees a token.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const origin = url.origin;
  const home = (query: string) => NextResponse.redirect(new URL(`/${query}`, origin));
  const fail = (reason: string) => home(`?tesla_error=${reason}`);

  const c = getConfig();
  if (assertConfigured(c)) return fail("config");

  if (url.searchParams.get("error")) return fail("denied");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return fail("missing_code");

  const expected = request.cookies.get("rtr_state")?.value;
  if (!expected || !safeEqual(expected, state)) return fail("state_mismatch");

  try {
    const token = await exchangeCode(c, code);
    const { profile, vehiclesOk } = await fetchProfile(c, token);

    // Identity succeeded but the vehicle read hard-failed (scope/region): surface it
    // rather than silently downgrading a real owner to "account, no car".
    if (!vehiclesOk) return fail("vehicles_unavailable");

    const res = home("?connected=1");
    res.cookies.set("rtr_tesla", seal(profile, c.sessionSecret), {
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
