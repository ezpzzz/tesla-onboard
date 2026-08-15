import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const ownerRpc = vi.fn();
const serviceRpc = vi.fn();
const createClient = vi.fn();
const createServiceRoleClient = vi.fn();
const sendGridConfigFromEnv = vi.fn();
const sendGridTripReminder = vi.fn();
const decryptTripLink = vi.fn();

vi.mock("@/lib/supabase/server", () => ({ createClient, createServiceRoleClient }));
vi.mock("@/lib/owner/sendgrid", () => ({ sendGridConfigFromEnv, sendGridTripReminder }));
vi.mock("@/lib/owner/trip-link-secret", () => ({ decryptTripLink }));
vi.mock("@/lib/onlyevs-origin", () => ({ canonicalOnlyEvsOrigin: () => "https://evhost.app" }));
vi.mock("@/lib/tenant-config", () => ({ publishedTenantConfigFromFeatures: () => ({ supportEmail: "support@evhost.app" }) }));

const { POST } = await import("@/app/api/owner/trips/[id]/reminder/route");
const tripId = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id: tripId }) } as RouteContext<"/api/owner/trips/[id]/reminder">;

function request(origin = "https://evhost.app") {
  return new NextRequest(`https://evhost.app/api/owner/trips/${tripId}/reminder`, {
    method: "POST",
    headers: { origin },
  });
}

describe("owner guest reminder route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVHOST_REMINDERS_ENABLED = "true";
    sendGridConfigFromEnv.mockReturnValue({ apiKey: "server-key", fromEmail: "trips@evhost.app", fromName: "EVhost" });
    createServiceRoleClient.mockReturnValue({ rpc: serviceRpc });
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "owner" } } }) },
      rpc: ownerRpc,
      from: vi.fn(() => ({ select: vi.fn(() => ({ eq: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: { features: {} }, error: null }) })) })) })) })),
    });
    ownerRpc.mockImplementation((name: string) => name === "begin_onlyevs_trip_reminder"
      ? Promise.resolve({ data: [{ delivery_id: "00000000-0000-4000-8000-000000000010" }], error: null })
      : Promise.resolve({ data: [{ recipient_masked: "gu••••@example.com", sent_at: "2026-08-15T19:00:00.000Z" }], error: null }));
    serviceRpc.mockResolvedValue({ data: [{
      delivery_id: "00000000-0000-4000-8000-000000000010",
      workspace_id: "00000000-0000-4000-8000-000000000020",
      shop_slug: "desert-ev",
      guest_name: "Guest",
      guest_email: "guest@example.com",
      company_name: "EVhost",
      vehicle_name: "Model Y",
      starts_at: "2026-08-20T17:00:00.000Z",
      timezone: "America/Phoenix",
      pickup_location: "PHX Sky Harbor",
      token_ciphertext: "server-only-envelope",
      key_version: 1,
    }], error: null });
    decryptTripLink.mockReturnValue("private-capability");
    sendGridTripReminder.mockResolvedValue({ messageId: "sendgrid-message" });
  });

  afterEach(() => delete process.env.EVHOST_REMINDERS_ENABLED);

  it("rejects cross-origin delivery before accessing provider state", async () => {
    const response = await POST(request("https://attacker.example"), context);
    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("fails closed when the server-only material client is absent", async () => {
    createServiceRoleClient.mockReturnValue(null);
    const response = await POST(request(), context);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Reminder security is not configured." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("authorizes with the owner session, fetches material server-side, and returns only a masked receipt", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ recipient: "gu••••@example.com", sentAt: "2026-08-15T19:00:00.000Z" });
    expect(ownerRpc).toHaveBeenCalledWith("begin_onlyevs_trip_reminder", { p_trip_id: tripId });
    expect(serviceRpc).toHaveBeenCalledWith("get_onlyevs_trip_reminder_material", { p_delivery_id: "00000000-0000-4000-8000-000000000010" });
    expect(sendGridTripReminder).toHaveBeenCalledWith(expect.objectContaining({
      recipient: "guest@example.com",
      portalUrl: "https://evhost.app/trip/private-capability",
    }));
    expect(JSON.stringify(body)).not.toContain("private-capability");
  });

  it("maps database cooldowns without touching the material client", async () => {
    ownerRpc.mockResolvedValueOnce({ data: null, error: { message: "trip_reminder_cooldown" } });
    const response = await POST(request(), context);
    expect(response.status).toBe(429);
    expect(serviceRpc).not.toHaveBeenCalled();
  });
});
