import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReminderMessage, escapeHtml, maskEmail } from "@/lib/owner/reminder-message";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();

describe("guest reminder security", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "sg-123" } }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("escapes tenant and guest content while keeping the capability out of the subject", () => {
    const portalUrl = "https://evhost.app/trip/secret-capability";
    const message = buildReminderMessage({ companyName: "<Host & Co>", guestName: "Alex <script>", vehicleName: "Model Y", pickupDate: "Aug 20", pickupLocation: "A&B", portalUrl });
    expect(message.subject).not.toContain("secret-capability");
    expect(message.html).toContain("&lt;Host &amp; Co&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.text).toContain(portalUrl);
    expect(escapeHtml(`'\"<&`)).toBe("&#39;&quot;&lt;&amp;");
    expect(maskEmail("alex@example.com")).toBe("al••@example.com");
  });

  it("builds the expected SendGrid payload without leaking the token to headers", async () => {
    const { sendGridTripReminder } = await import("@/lib/owner/sendgrid");
    await expect(sendGridTripReminder({
      config: { apiKey: "secret-api-key", fromEmail: "trips@evhost.app", fromName: "EVhost Trips" },
      recipient: "guest@example.com", replyTo: "support@example.com", companyName: "EVhost",
      guestName: "Guest", vehicleName: "Model 3", pickupDate: "Aug 20, 10:00 AM",
      pickupLocation: "Garage", portalUrl: "https://evhost.app/trip/private-token",
    })).resolves.toEqual({ messageId: "sg-123" });
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body.subject).not.toContain("private-token");
    expect(body.reply_to).toEqual({ email: "support@example.com" });
    expect(JSON.stringify(body.content)).toContain("private-token");
    expect(request.headers).toMatchObject({ Authorization: "Bearer secret-api-key" });
  });
});
