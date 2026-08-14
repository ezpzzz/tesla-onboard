import "server-only";

import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { GoogleCalendarEvent } from "@/lib/owner/google-calendar";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.readonly";

const googleKeys = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

export function getGoogleCalendarConfig(): GoogleCalendarConfig {
  return {
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? "",
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? "",
  };
}

export function assertGoogleCalendarConfigured(config: GoogleCalendarConfig): string | null {
  if (!config.clientId) return "GOOGLE_CALENDAR_CLIENT_ID";
  if (!config.clientSecret) return "GOOGLE_CALENDAR_CLIENT_SECRET";
  if (!config.redirectUri) return "GOOGLE_CALENDAR_REDIRECT_URI";
  return null;
}

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  return {
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
  };
}

export function buildGoogleCalendarAuthorizeUrl(args: {
  config: GoogleCalendarConfig;
  state: string;
  nonce: string;
  codeChallenge: string;
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.config.clientId,
    redirect_uri: args.config.redirectUri,
    response_type: "code",
    scope: ["openid", "email", GOOGLE_CALENDAR_SCOPE].join(" "),
    state: args.state,
    nonce: args.nonce,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
  });
  if (args.loginHint) params.set("login_hint", args.loginHint);
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeGoogleCalendarCode(args: {
  config: GoogleCalendarConfig;
  code: string;
  codeVerifier: string;
}): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: args.config.clientId,
    client_secret: args.config.clientSecret,
    redirect_uri: args.config.redirectUri,
    code: args.code,
    code_verifier: args.codeVerifier,
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`google_token_exchange ${response.status}: ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as GoogleTokenResponse;
}

export async function verifyGoogleIdToken(args: {
  idToken: string;
  clientId: string;
  nonce: string;
}): Promise<JWTPayload> {
  const { payload } = await jwtVerify(args.idToken, googleKeys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: args.clientId,
    algorithms: ["RS256"],
    clockTolerance: 30,
  });
  if (!payload.nonce || payload.nonce !== args.nonce) {
    throw new Error("google_id_token_nonce_mismatch");
  }
  if (!payload.sub || payload.email_verified !== true) {
    throw new Error("google_identity_unverified");
  }
  return payload;
}

interface GoogleCalendarMetadata {
  id: string;
  summary?: string;
  timeZone?: string;
}

export async function fetchGooglePrimaryCalendar(
  accessToken: string,
): Promise<GoogleCalendarMetadata> {
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`google_calendar_metadata ${response.status}`);
  const data = (await response.json()) as GoogleCalendarMetadata;
  if (!data.id) throw new Error("google_calendar_id_missing");
  return data;
}

export async function fetchGoogleCalendarEvents(args: {
  accessToken: string;
  calendarId: string;
  timeMin: Date;
  timeMax: Date;
  maxPages?: number;
}): Promise<{ events: GoogleCalendarEvent[]; nextSyncToken: string | null }> {
  const events: GoogleCalendarEvent[] = [];
  let pageToken: string | null = null;
  let nextSyncToken: string | null = null;
  const maxPages = Math.min(10, Math.max(1, args.maxPages ?? 5));
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(args.calendarId)}/events`,
    );
    url.searchParams.set("timeMin", args.timeMin.toISOString());
    url.searchParams.set("timeMax", args.timeMax.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("showDeleted", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "250");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${args.accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`google_calendar_events ${response.status}`);
    const data = (await response.json()) as {
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
      nextSyncToken?: string;
    };
    if (Array.isArray(data.items)) events.push(...data.items);
    pageToken = data.nextPageToken ?? null;
    nextSyncToken = data.nextSyncToken ?? nextSyncToken;
    if (!pageToken) break;
    if (page === maxPages - 1) throw new Error("google_calendar_page_limit");
  }
  return { events, nextSyncToken };
}
