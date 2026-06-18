import "server-only";

/**
 * Tesla Fleet API — server-only OAuth (authorization-code, confidential client).
 *
 * This module never reaches the browser. It holds the client secret, performs
 * the token exchange, reads the user's identity + vehicle list once, and
 * normalizes everything to the same `TeslaProfile` the mock flow produces — so
 * the rest of the app is identical whether sign-in is mock or live.
 *
 * Verified against Tesla Fleet API docs (third-party token flow). Notes on the
 * deliberately defensive bits:
 *   - Authorize host (auth.tesla.com) differs from the token host
 *     (fleet-auth.prd.vn.cloud.tesla.com) — this is required, not a typo.
 *   - Region is discovered at runtime via /api/1/users/region (a token minted
 *     for the wrong region returns HTTP 412).
 *   - /api/1/users/me field names aren't officially published, so identity is
 *     resolved tolerantly from the response AND the id_token claims.
 *   - model/year aren't fields on the vehicle object; they're derived from VIN.
 *   - We do a single read then discard tokens — no session, no refresh, so we
 *     request the minimal scope and skip offline_access.
 */

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TeslaProfile, TeslaVehicle } from "./tesla";

export const AUTHORIZE_URL = "https://auth.tesla.com/oauth2/v3/authorize";
export const TOKEN_URL =
  "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";

const REGION_BASES = {
  na: "https://fleet-api.prd.na.vn.cloud.tesla.com",
  eu: "https://fleet-api.prd.eu.vn.cloud.tesla.com",
  cn: "https://fleet-api.prd.cn.vn.cloud.tesla.cn",
} as const;

export interface TeslaServerConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  audience: string; // a regional fleet-api base URL
  sessionSecret: string;
}

export function getConfig(): TeslaServerConfig {
  return {
    clientId: process.env.TESLA_CLIENT_ID ?? "",
    clientSecret: process.env.TESLA_CLIENT_SECRET ?? "",
    redirectUri: process.env.TESLA_REDIRECT_URI ?? "",
    scope: process.env.TESLA_SCOPES ?? "openid vehicle_device_data",
    audience: process.env.TESLA_AUDIENCE ?? REGION_BASES.na,
    sessionSecret: process.env.TESLA_SESSION_SECRET ?? "",
  };
}

/** Returns the name of the first missing required env var, or null if configured. */
export function assertConfigured(c: TeslaServerConfig): string | null {
  if (!c.clientId) return "TESLA_CLIENT_ID";
  if (!c.clientSecret) return "TESLA_CLIENT_SECRET";
  if (!c.redirectUri) return "TESLA_REDIRECT_URI";
  if (!c.sessionSecret) return "TESLA_SESSION_SECRET";
  // A weak secret means a brute-forceable session key — enforce the documented floor.
  if (c.sessionSecret.length < 32) return "TESLA_SESSION_SECRET_WEAK";
  return null;
}

/** Constant-time comparison for security nonces (OAuth state). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function buildAuthorizeUrl(c: TeslaServerConfig, state: string): string {
  const p = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: c.scope,
    state,
    locale: "en-US",
    // "consent" forces Tesla to re-show the permission screen so newly-added
    // scopes (e.g. user_data) are actually granted — a stored prior consent
    // would otherwise be reused and silently drop them.
    prompt: "login consent",
  });
  return `${AUTHORIZE_URL}?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
}

export async function exchangeCode(
  c: TeslaServerConfig,
  code: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    audience: c.audience,
    redirect_uri: c.redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`token_exchange ${res.status}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as TokenResponse;
}

function authHeaders(token: string): HeadersInit {
  return { Authorization: `Bearer ${token}`, Accept: "application/json" };
}

/**
 * Resolve the correct regional Fleet API base. A token is region-locked; calling
 * the wrong base returns 412. /api/1/users/region tells us the right one.
 */
export async function resolveRegionBase(
  audienceBase: string,
  accessToken: string,
): Promise<string> {
  try {
    const res = await fetch(`${audienceBase}/api/1/users/region`, {
      headers: authHeaders(accessToken),
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as {
        response?: { fleet_api_base_url?: string };
      };
      const base = data?.response?.fleet_api_base_url;
      if (typeof base === "string" && base.startsWith("https://")) return base;
    } else {
      console.warn(
        `[tesla] region discovery failed (${res.status}); using configured audience base`,
      );
    }
  } catch {
    console.warn("[tesla] region discovery threw; using configured audience base");
  }
  return audienceBase;
}

export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const json = Buffer.from(
      part.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

interface Identity {
  fullName: string;
  firstName: string;
  email: string;
}

/**
 * Identity from /api/1/users/me, with id_token claims as a fallback. Field
 * names for users/me aren't officially published, so we probe several.
 */
async function fetchIdentity(
  base: string,
  accessToken: string,
  idToken?: string,
): Promise<Identity> {
  let me: Record<string, unknown> | null = null;
  try {
    const res = await fetch(`${base}/api/1/users/me`, {
      headers: authHeaders(accessToken),
      cache: "no-store",
    });
    if (res.ok) {
      const j = (await res.json()) as { response?: Record<string, unknown> };
      me = j?.response ?? (j as Record<string, unknown>);
    } else {
      // 403 here usually means the user didn't grant the user_data scope.
      console.warn(`[tesla] /api/1/users/me failed (${res.status})`);
    }
  } catch {
    /* identity falls back to id_token claims */
  }
  const claims = idToken ? decodeJwt(idToken) : null;

  const pick = (...keys: string[]): string => {
    for (const src of [me, claims]) {
      if (!src) continue;
      for (const k of keys) {
        const v = src[k];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
    return "";
  };

  const fullName = pick("full_name", "fullName", "name");
  // Leave unknown identity EMPTY (don't fall back to "there" — that's only the
  // new-guest greeting placeholder; the UI shows "Tesla account" when blank).
  const firstName =
    pick("first_name", "firstName", "given_name") || fullName.split(" ")[0] || "";
  const email = pick("email");
  return { fullName, firstName, email };
}

const VIN_YEARS: Record<string, number> = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015, G: 2016, H: 2017,
  J: 2018, K: 2019, L: 2020, M: 2021, N: 2022, P: 2023, R: 2024, S: 2025,
  T: 2026, V: 2027, W: 2028, X: 2029, Y: 2030,
};

const VIN_MODELS: Record<string, string> = {
  S: "Model S",
  "3": "Model 3",
  X: "Model X",
  Y: "Model Y",
  R: "Roadster",
  C: "Cybertruck",
};

/** model/year aren't on the vehicle object — derive them from the VIN. */
export function decodeTeslaVin(vin: string): { model: string; year?: number } {
  const v = vin.toUpperCase();
  return { model: VIN_MODELS[v[3]] ?? "Tesla", year: VIN_YEARS[v[9]] };
}

interface RawVehicle {
  id?: number;
  id_s?: string;
  vin?: string;
  display_name?: string;
}

interface VehiclesResult {
  ok: boolean; // true only on a genuine 200 (the list may still be empty)
  status: number;
  vehicles: TeslaVehicle[];
}

async function fetchVehicles(
  base: string,
  accessToken: string,
): Promise<VehiclesResult> {
  try {
    const res = await fetch(`${base}/api/1/products`, {
      headers: authHeaders(accessToken),
      cache: "no-store",
    });
    if (!res.ok) {
      // 401/403 = missing scope, 412 = wrong region. Never mistake this for "no cars".
      console.warn(`[tesla] /api/1/products failed (${res.status}) at ${base}`);
      return { ok: false, status: res.status, vehicles: [] };
    }
    const j = (await res.json()) as { response?: RawVehicle[] };
    const list = Array.isArray(j?.response) ? j.response : [];
    const vehicles = list
      .filter((p) => typeof p.vin === "string" && p.vin.length > 0)
      .map((p) => {
        const vin = p.vin as string;
        const { model, year } = decodeTeslaVin(vin);
        // Read id_s (string), never id (number) — Tesla ids exceed JS's 53-bit safe range.
        const id = p.id_s ?? (p.id != null ? String(p.id) : vin);
        return {
          id,
          displayName: p.display_name || model,
          model,
          year,
        } satisfies TeslaVehicle;
      });
    return { ok: true, status: 200, vehicles };
  } catch {
    console.warn(`[tesla] /api/1/products threw at ${base}`);
    return { ok: false, status: 0, vehicles: [] };
  }
}

export interface ProfileResult {
  profile: TeslaProfile;
  /** false when the vehicle read hard-failed (scope/region) vs. a genuinely empty account. */
  vehiclesOk: boolean;
}

export async function fetchProfile(
  c: TeslaServerConfig,
  token: TokenResponse,
): Promise<ProfileResult> {
  const base = await resolveRegionBase(c.audience, token.access_token);
  const [identity, vehiclesRes] = await Promise.all([
    fetchIdentity(base, token.access_token, token.id_token),
    fetchVehicles(base, token.access_token),
  ]);
  const sub = decodeJwt(token.access_token)?.sub;
  return {
    profile: {
      id: `live_${typeof sub === "string" ? sub : crypto.randomUUID()}`,
      fullName: identity.fullName,
      firstName: identity.firstName,
      email: identity.email,
      vehicles: vehiclesRes.vehicles,
      source: "live",
    },
    vehiclesOk: vehiclesRes.ok,
  };
}

/* ── Sealed session cookie (AES-256-GCM) ──────────────────────────────────
   We store only the normalized profile (low-sensitivity), never tokens, which
   are discarded after the one-time read. Sealing keeps the profile opaque and
   tamper-evident in the browser. */

function keyFrom(secret: string): Buffer {
  // Domain-separated derivation. The >=32-char floor in assertConfigured is what
  // defeats brute force; HKDF adds clean separation from any other use of the secret.
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(secret), Buffer.alloc(0), "rtr-session-v1", 32),
  );
}

export function seal(value: unknown, secret: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, data]).toString("base64url");
}

export function unseal<T>(sealed: string, secret: string): T | null {
  try {
    const buf = Buffer.from(sealed, "base64url");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const d = crypto.createDecipheriv("aes-256-gcm", keyFrom(secret), iv);
    d.setAuthTag(tag);
    const out = Buffer.concat([d.update(data), d.final()]).toString("utf8");
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

/** PEM public key served at the .well-known path for partner registration. */
export function loadPublicKeyPem(): string | null {
  const env = process.env.TESLA_PUBLIC_KEY_PEM;
  if (env) return env.replace(/\\n/g, "\n");
  try {
    return readFileSync(join(process.cwd(), "tesla-public-key.pem"), "utf8");
  } catch {
    return null;
  }
}
