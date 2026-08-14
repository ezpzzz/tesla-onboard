import { describe, expect, it, vi } from "vitest";
import { isTeslaInvitationUrl, parseTeslaDrivers, parseTeslaInvitations, TeslaAccessClient } from "@/lib/owner/tesla-access-client";

describe("Tesla access response parsing", () => {
  it("accepts Tesla response envelopes while retaining only ids and HTTPS links", () => {
    expect(parseTeslaInvitations({ response: { invitations: [
      { id: "inv-1", share_url: "https://www.tesla.com/_ak/abc" },
      { invitation_id: "inv-2", url: "javascript:alert(1)" },
      { share_url: "https://www.tesla.com/_ak/no-id" },
    ] } })).toEqual([
      { id: "inv-1", url: "https://www.tesla.com/_ak/abc" },
      { id: "inv-2", url: null },
    ]);
  });

  it("accepts only first-party HTTPS Tesla invite destinations", () => {
    expect(isTeslaInvitationUrl("https://www.tesla.com/_ak/abc")).toBe(true);
    expect(isTeslaInvitationUrl("https://tesla.com/_ak/abc")).toBe(true);
    expect(isTeslaInvitationUrl("https://tesla.com.evil.example/_ak/abc")).toBe(false);
    expect(isTeslaInvitationUrl("https://example.com/_ak/abc")).toBe(false);
    expect(isTeslaInvitationUrl("javascript:alert(1)")).toBe(false);
  });

  it("fails closed on driver rows without a stable provider id", () => {
    expect(parseTeslaDrivers({ response: [
      { driver_id: "driver-1", user_id: "subject-1" },
      { share_user_id: 42, user_id: 84 },
      { name: "Guest" },
    ] })).toEqual([
      { id: "driver-1", subject: "subject-1" },
      { id: "42", subject: "84" },
    ]);
  });
});

describe("TeslaAccessClient", () => {
  it("uses the documented no-parameter invitation endpoint and preserves request ids", async () => {
    const fetcher = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ response: { id: "inv-1", share_link: "https://tesla.com/invite" } }), {
      status: 200,
      headers: { "x-request-id": "req-1" },
    }));
    const client = new TeslaAccessClient("https://fleet-api.example.com", "token", fetcher);
    await expect(client.createInvitation("5YJ3E1EA7KF000001")).resolves.toEqual({
      value: { id: "inv-1", url: "https://tesla.com/invite" },
      requestId: "req-1",
    });
    const [, init] = fetcher.mock.calls[0];
    expect(init).toMatchObject({ method: "POST", body: "{}" });
  });

  it("removes only the exact share user id through Tesla's drivers endpoint", async () => {
    const fetcher = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ response: null }), {
      status: 200,
      headers: { "x-request-id": "req-remove" },
    }));
    const client = new TeslaAccessClient("https://fleet-api.example.com", "token", fetcher);
    await expect(client.removeDriver("5YJ3E1EA7KF000001", "share user/7")).resolves.toEqual({
      value: true,
      requestId: "req-remove",
    });
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe("https://fleet-api.example.com/api/1/vehicles/5YJ3E1EA7KF000001/drivers?share_user_id=share+user%2F7");
    expect(init).toMatchObject({ method: "DELETE" });
  });
});
