import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  assertGoogleCalendarConfigured,
  buildGoogleCalendarAuthorizeUrl,
  fetchGoogleCalendarEvents,
} = await import("@/lib/google-calendar-server");

describe("Google Calendar OAuth and pagination", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requires every confidential OAuth setting and emits PKCE, nonce, and offline consent", () => {
    expect(assertGoogleCalendarConfigured({ clientId: "", clientSecret: "secret", redirectUri: "https://evhost.app/callback" }))
      .toBe("GOOGLE_CALENDAR_CLIENT_ID");
    const url = new URL(buildGoogleCalendarAuthorizeUrl({
      config: { clientId: "client", clientSecret: "secret", redirectUri: "https://evhost.app/auth/owner/google/callback" },
      state: "state",
      nonce: "nonce",
      codeChallenge: "challenge",
    }));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("nonce")).toBe("nonce");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("paginates bounded event reads and preserves the terminal sync token", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "one" }], nextPageToken: "page-2" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "two" }], nextSyncToken: "sync-1" })));
    vi.stubGlobal("fetch", fetcher);
    await expect(fetchGoogleCalendarEvents({
      accessToken: "access",
      calendarId: "primary@example.com",
      timeMin: new Date("2026-08-01T00:00:00Z"),
      timeMax: new Date("2026-09-01T00:00:00Z"),
    })).resolves.toEqual({ events: [{ id: "one" }, { id: "two" }], nextSyncToken: "sync-1" });
    expect(new URL(String(fetcher.mock.calls[1][0])).searchParams.get("pageToken")).toBe("page-2");
  });
});
