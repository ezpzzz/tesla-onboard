import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const fetchMock = vi.fn();

describe("sendGridMessage failure classification", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const config = { apiKey: "server-key", fromEmail: "trips@evhost.app", fromName: "EVhost" };
  const message = { recipient: "guest@example.com", subject: "Subject", text: "Body", html: "<p>Body</p>" };

  it("resolves messageId from the SendGrid response header on success", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "sg-1" } }));
    const { sendGridMessage } = await import("@/lib/owner/sendgrid");
    await expect(sendGridMessage(config, message)).resolves.toEqual({ messageId: "sg-1" });
  });

  it("classifies an explicit HTTP rejection as a definite failure", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 400 }));
    const { sendGridMessage, SendGridDeliveryError } = await import("@/lib/owner/sendgrid");
    const error = await sendGridMessage(config, message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SendGridDeliveryError);
    expect((error as InstanceType<typeof SendGridDeliveryError>).classification).toBe("definite");
    expect((error as Error).message).toBe("sendgrid_400");
  });

  it("classifies a network/timeout failure as ambiguous rather than a definite rejection", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const { sendGridMessage, SendGridDeliveryError } = await import("@/lib/owner/sendgrid");
    const error = await sendGridMessage(config, message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SendGridDeliveryError);
    expect((error as InstanceType<typeof SendGridDeliveryError>).classification).toBe("ambiguous");
  });

  it("attaches an AbortSignal so a hanging SendGrid request cannot block forever", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    const { sendGridMessage } = await import("@/lib/owner/sendgrid");
    await sendGridMessage(config, message);
    const options = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("still validates the message shape before ever calling fetch", async () => {
    const { sendGridMessage } = await import("@/lib/owner/sendgrid");
    await expect(sendGridMessage(config, { ...message, recipient: "not-an-email" }))
      .rejects.toThrow("sendgrid_invalid_message");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("sendGridEmailAction", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "sg-action-1" } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("wires the stable message id and evhost_workspace_id/evhost_delivery_id custom args the SendGrid webhook route expects", async () => {
    const { sendGridEmailAction } = await import("@/lib/owner/sendgrid");
    await sendGridEmailAction({
      config: { apiKey: "server-key", fromEmail: "trips@evhost.app", fromName: "EVhost" },
      recipient: "owner@example.com",
      subject: "A guest cancelled",
      text: "text",
      html: "<p>html</p>",
      workspaceId: "workspace-1",
      deliveryId: "delivery-1",
    });
    const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string) as {
      headers?: { "Message-ID"?: string };
      personalizations: [{ custom_args?: Record<string, string> }];
    };
    expect(body.headers?.["Message-ID"]).toBe("evhost-email-action-delivery-1@mail.evhost.app");
    expect(body.personalizations[0].custom_args).toEqual({
      evhost_workspace_id: "workspace-1",
      evhost_delivery_id: "delivery-1",
    });
  });
});

describe("sendGridTripReminder regression (existing reminder flow is unchanged)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "sg-reminder-1" } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("still sends the reminder payload with the same call signature and success shape", async () => {
    const { sendGridTripReminder } = await import("@/lib/owner/sendgrid");
    await expect(sendGridTripReminder({
      config: { apiKey: "server-key", fromEmail: "trips@evhost.app", fromName: "EVhost Trips" },
      recipient: "guest@example.com",
      replyTo: "support@example.com",
      companyName: "EVhost",
      guestName: "Alex Guest",
      vehicleName: "Model Y",
      pickupDate: "Aug 20",
      pickupLocation: "PHX Sky Harbor",
      portalUrl: "https://evhost.app/trip/secret-capability",
    })).resolves.toEqual({ messageId: "sg-reminder-1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still classifies a rejected reminder send the same way the reminder route matches on (`sendgrid_<status>`)", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    const { sendGridTripReminder } = await import("@/lib/owner/sendgrid");
    await expect(sendGridTripReminder({
      config: { apiKey: "server-key", fromEmail: "trips@evhost.app", fromName: "EVhost Trips" },
      recipient: "guest@example.com",
      companyName: "EVhost",
      guestName: "Alex Guest",
      vehicleName: "Model Y",
      pickupDate: "Aug 20",
      pickupLocation: null,
      portalUrl: "https://evhost.app/trip/secret-capability",
    })).rejects.toThrow("sendgrid_429");
  });
});
