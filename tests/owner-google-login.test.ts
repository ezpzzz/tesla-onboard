import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireOwnerWorkspace = vi.fn();
const buildGoogleCalendarAuthorizeUrl = vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?state=opaque");
const seal = vi.fn(() => "sealed-google-state");

vi.mock("@/lib/owner/server-auth", () => ({ requireOwnerWorkspace }));
vi.mock("@/lib/google-calendar-server", () => ({
  assertGoogleCalendarConfigured: vi.fn(() => null),
  buildGoogleCalendarAuthorizeUrl,
  createPkce: vi.fn(() => ({ verifier: "verifier", challenge: "challenge" })),
  getGoogleCalendarConfig: vi.fn(() => ({
    clientId: "google-client",
    clientSecret: "google-secret",
    redirectUri: "https://evhost.app/auth/owner/google/callback",
  })),
}));
vi.mock("@/lib/tesla-server", () => ({ seal }));

const { GET } = await import("@/app/api/owner/google/login/route");

const configuredEnv = {
  NEXT_PUBLIC_ONLYEVS_OPERATIONS_ENABLED: "false",
  GOOGLE_CALENDAR_CLIENT_ID: "google-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "google-secret",
  GOOGLE_CALENDAR_REDIRECT_URI: "https://evhost.app/auth/owner/google/callback",
  ONLYEVS_DATA_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 4).toString("base64")}`,
  TESLA_SESSION_SECRET: "s".repeat(32),
};

describe("owner Google Calendar login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const [key, value] of Object.entries(configuredEnv)) vi.stubEnv(key, value);
    requireOwnerWorkspace.mockResolvedValue({ email: "owner@example.com" });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("starts the initial calendar import even when background operations are off", async () => {
    const response = await GET(new Request(
      "https://evhost.app/api/owner/google/login?workspace=workspace-id&shop=desert-ev",
    ));

    expect(response.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=opaque");
    expect(response.headers.get("set-cookie")).toContain("rtr_owner_google_state=sealed-google-state");
    expect(requireOwnerWorkspace).toHaveBeenCalledWith("workspace-id", "desert-ev", "admin");
    expect(seal).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: "workspace-id",
      shopSlug: "desert-ev",
      returnPath: "/owner/integrations",
    }), "s".repeat(32), "rtr_owner_google_state");
  });

  it("returns a usable integrations error when provider setup is incomplete", async () => {
    vi.stubEnv("GOOGLE_CALENDAR_CLIENT_SECRET", "");
    const response = await GET(new Request(
      "https://evhost.app/api/owner/google/login?workspace=workspace-id&shop=desert-ev",
    ));

    expect(response.headers.get("location")).toBe("https://evhost.app/owner/integrations?google_calendar_error=config");
    expect(requireOwnerWorkspace).toHaveBeenCalledWith("workspace-id", "desert-ev", "admin");
  });
});
