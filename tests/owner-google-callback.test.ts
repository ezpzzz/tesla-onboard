import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const exchangeGoogleCalendarCode = vi.fn();
const fetchGoogleCalendarEvents = vi.fn();
const fetchGooglePrimaryCalendar = vi.fn();
const verifyGoogleIdToken = vi.fn();
const normalizeGoogleCalendarEvent = vi.fn();
const encryptCredential = vi.fn();
const requireOwnerWorkspace = vi.fn();
const createClient = vi.fn();
const getOwnerIntegrationCapabilities = vi.fn();
const rpc = vi.fn();
const unseal = vi.fn();

vi.mock("@/lib/google-calendar-server", () => ({
  assertGoogleCalendarConfigured: vi.fn(() => null),
  exchangeGoogleCalendarCode,
  fetchGoogleCalendarEvents,
  fetchGooglePrimaryCalendar,
  getGoogleCalendarConfig: vi.fn(() => ({
    clientId: "google-client",
    clientSecret: "google-secret",
    redirectUri: "https://evhost.app/auth/owner/google/callback",
  })),
  GOOGLE_CALENDAR_SCOPE: "https://www.googleapis.com/auth/calendar.events.readonly",
  verifyGoogleIdToken,
}));
vi.mock("@/lib/owner/google-calendar", () => ({ normalizeGoogleCalendarEvent }));
vi.mock("@/lib/owner/credential-envelope", () => ({
  credentialKeyringFromEnv: vi.fn(() => ({ currentVersion: 1, keys: new Map() })),
  encryptCredential,
  oauthStateSecretFromEnv: vi.fn(() => "s".repeat(32)),
}));
vi.mock("@/lib/owner/server-auth", () => ({ requireOwnerWorkspace }));
vi.mock("@/lib/supabase/server", () => ({ createClient }));
vi.mock("@/lib/tesla-server", () => ({
  safeEqual: (left: string, right: string) => left === right,
  unseal,
}));
vi.mock("@/lib/owner/integration-capabilities", () => ({ getOwnerIntegrationCapabilities }));

const { GET } = await import("@/app/auth/owner/google/callback/route");

const workspaceId = "6acaf5d4-a1ce-4c32-a17f-ae3779be897f";
const validState = () => ({
  state: "expected-state",
  nonce: "expected-nonce",
  codeVerifier: "pkce-verifier",
  workspaceId,
  shopSlug: "onlyevs",
  returnPath: "/owner/integrations",
  issuedAt: Date.now(),
});

function request(search: string, cookie = true) {
  return new NextRequest(`https://evhost.app/auth/owner/google/callback${search}`, {
    headers: cookie ? { cookie: "rtr_owner_google_state=sealed-state" } : undefined,
  });
}

function expectFailure(response: Response, reason: string) {
  expect(response.headers.get("location")).toBe(
    `https://evhost.app/owner/integrations?google_calendar_error=${reason}`,
  );
  expect(response.headers.get("set-cookie")).toContain("rtr_owner_google_state=;");
}

describe("owner Google Calendar callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unseal.mockReturnValue(validState());
    getOwnerIntegrationCapabilities.mockReturnValue({
      googleCalendar: { connectionEnabled: true },
    });
    requireOwnerWorkspace.mockResolvedValue({ email: "owner@example.com" });
    exchangeGoogleCalendarCode.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
      expires_in: 3600,
      scope: "openid https://www.googleapis.com/auth/calendar.events.readonly",
    });
    verifyGoogleIdToken.mockResolvedValue({ sub: "google-subject", email: "owner@example.com" });
    fetchGooglePrimaryCalendar.mockResolvedValue({ id: "primary", summary: "Owner calendar", timeZone: "America/Phoenix" });
    fetchGoogleCalendarEvents.mockResolvedValue({ events: [], nextSyncToken: "sync-token" });
    normalizeGoogleCalendarEvent.mockReturnValue(null);
    encryptCredential
      .mockReturnValueOnce({ ciphertext: "subject-ciphertext", keyVersion: 1 })
      .mockReturnValueOnce({ ciphertext: "refresh-ciphertext", keyVersion: 1 });
    rpc.mockImplementation(async (name: string) => name === "complete_onlyevs_integration"
      ? { data: { id: "integration-id" }, error: null }
      : { data: null, error: null });
    createClient.mockResolvedValue({ rpc });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("rejects missing, expired, denied, and mismatched OAuth state before provider exchange", async () => {
    expectFailure(await GET(request("?code=code&state=expected-state", false)), "state_mismatch");

    unseal.mockReturnValue({ ...validState(), issuedAt: Date.now() - 11 * 60 * 1_000 });
    expectFailure(await GET(request("?code=code&state=expected-state")), "state_mismatch");

    unseal.mockReturnValue(validState());
    expectFailure(await GET(request("?error=access_denied&state=expected-state")), "denied");
    expectFailure(await GET(request("?code=code&state=wrong-state")), "state_mismatch");
    expect(exchangeGoogleCalendarCode).not.toHaveBeenCalled();
  });

  it("rechecks provider configuration before exchanging the code", async () => {
    getOwnerIntegrationCapabilities.mockReturnValue({
      googleCalendar: { connectionEnabled: false },
    });

    const response = await GET(request("?code=code&state=expected-state"));

    expectFailure(response, "config");
    expect(exchangeGoogleCalendarCode).not.toHaveBeenCalled();
  });

  it("maps callback session and workspace authorization failures without exchanging provider credentials", async () => {
    requireOwnerWorkspace.mockRejectedValueOnce(new Error("unauthenticated"));
    expectFailure(await GET(request("?code=code&state=expected-state")), "session");

    requireOwnerWorkspace.mockRejectedValueOnce(new Error("forbidden"));
    expectFailure(await GET(request("?code=code&state=expected-state")), "workspace_access");
    expect(exchangeGoogleCalendarCode).not.toHaveBeenCalled();
  });

  it("requires a persistent Google grant without persisting partial credentials", async () => {
    exchangeGoogleCalendarCode.mockResolvedValue({
      access_token: "access-token",
      id_token: "id-token",
    });

    const response = await GET(request("?code=code&state=expected-state"));

    expectFailure(response, "persistent_grant_missing");
    expect(createClient).not.toHaveBeenCalled();
    expect(encryptCredential).not.toHaveBeenCalled();
  });

  it("persists a connection and completes an initial import while operations are disabled", async () => {
    const normalizedCandidate = {
      externalEventId: "event-1",
      externalIcalUid: "ical-1",
      recurringInstanceKey: null,
      summary: "Turo booking",
      location: "PHX",
      startsAt: "2026-08-20T17:00:00.000Z",
      endsAt: "2026-08-23T17:00:00.000Z",
      timezone: "America/Phoenix",
      sourceUpdatedAt: "2026-08-15T00:00:00.000Z",
      sourceRevision: "etag-1",
      status: "confirmed",
      deletedAt: null,
    };
    fetchGoogleCalendarEvents.mockResolvedValue({ events: [{ id: "event-1" }], nextSyncToken: "sync-token" });
    normalizeGoogleCalendarEvent.mockReturnValue(normalizedCandidate);

    const response = await GET(request("?code=code&state=expected-state"));

    expect(response.headers.get("location")).toBe("https://evhost.app/owner/integrations?google_calendar_connected=1");
    expect(response.headers.get("set-cookie")).toContain("rtr_owner_google_state=;");
    expect(requireOwnerWorkspace).toHaveBeenCalledWith(workspaceId, "onlyevs", "admin");
    expect(rpc).toHaveBeenNthCalledWith(1, "complete_onlyevs_integration", expect.objectContaining({
      p_workspace_id: workspaceId,
      p_shop_slug: "onlyevs",
      p_provider: "google_calendar",
      p_account_label: "owner@example.com",
      p_selected_calendar_id: "primary",
      p_provider_subject_ciphertext: "subject-ciphertext",
      p_refresh_token_ciphertext: "refresh-ciphertext",
      p_key_version: 1,
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "ingest_onlyevs_calendar_candidates", expect.objectContaining({
      p_integration_id: "integration-id",
      p_candidates: [expect.objectContaining({ external_event_id: "event-1", location: "PHX" })],
    }));
  });

  it("skips candidate ingestion when the initial calendar window is empty", async () => {
    const response = await GET(request("?code=code&state=expected-state"));

    expect(response.headers.get("location")).toBe("https://evhost.app/owner/integrations?google_calendar_connected=1");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("complete_onlyevs_integration", expect.any(Object));
  });

  it("fails closed when credential persistence or event ingestion fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expectFailure(await GET(request("?code=code&state=expected-state")), "exchange_failed");

    vi.clearAllMocks();
    unseal.mockReturnValue(validState());
    getOwnerIntegrationCapabilities.mockReturnValue({ googleCalendar: { connectionEnabled: true } });
    requireOwnerWorkspace.mockResolvedValue({ email: "owner@example.com" });
    exchangeGoogleCalendarCode.mockResolvedValue({
      access_token: "access-token",
      refresh_token: "refresh-token",
      id_token: "id-token",
    });
    verifyGoogleIdToken.mockResolvedValue({ sub: "google-subject", email: "owner@example.com" });
    fetchGooglePrimaryCalendar.mockResolvedValue({ id: "primary", timeZone: "UTC" });
    fetchGoogleCalendarEvents.mockResolvedValue({ events: [{ id: "event-1" }] });
    normalizeGoogleCalendarEvent.mockReturnValue({
      externalEventId: "event-1", externalIcalUid: null, recurringInstanceKey: null,
      summary: "Booking", location: null, startsAt: "2026-08-20T00:00:00.000Z",
      endsAt: "2026-08-21T00:00:00.000Z", timezone: "UTC", sourceUpdatedAt: null,
      sourceRevision: null, status: "confirmed", deletedAt: null,
    });
    encryptCredential
      .mockReturnValueOnce({ ciphertext: "subject-ciphertext", keyVersion: 1 })
      .mockReturnValueOnce({ ciphertext: "refresh-ciphertext", keyVersion: 1 });
    rpc
      .mockResolvedValueOnce({ data: { id: "integration-id" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "P0001" } });
    createClient.mockResolvedValue({ rpc });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expectFailure(await GET(request("?code=code&state=expected-state")), "exchange_failed");
  });
});
