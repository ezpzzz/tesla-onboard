import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const reconcileSendGridEvent = vi.fn();
const getEmailCaptureDbPool = vi.fn();
const FAKE_POOL = { query: vi.fn() };

vi.mock("@/lib/email/capture-db", () => ({ reconcileSendGridEvent, getEmailCaptureDbPool }));

const { POST } = await import("@/app/api/internal/sendgrid/events/route");

function ecKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return { publicKeyDer: publicKey.export({ type: "spki", format: "der" }).toString("base64"), privateKey };
}

const current = ecKeyPair();
const next = ecKeyPair();
const unknown = ecKeyPair();

function eventRequest(body: unknown, privateKey: ReturnType<typeof ecKeyPair>["privateKey"], timestamp = String(Math.floor(Date.now() / 1_000))) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = sign("sha256", Buffer.concat([Buffer.from(timestamp), raw]), privateKey).toString("base64");
  return new NextRequest("https://evhost.app/api/internal/sendgrid/events", {
    method: "POST",
    body: raw,
    headers: {
      "x-twilio-email-event-webhook-timestamp": timestamp,
      "x-twilio-email-event-webhook-signature": signature,
    },
  });
}

const sampleEvents = [{
  sg_event_id: "evt-1",
  event: "delivered",
  timestamp: Math.floor(Date.now() / 1_000),
  custom_args: { evhost_workspace_id: "ws-1", evhost_delivery_id: "delivery-1" },
}];

describe("sendgrid event webhook keyring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS = `1:${current.publicKeyDer},2:${next.publicKeyDer}`;
    getEmailCaptureDbPool.mockReturnValue(FAKE_POOL);
    reconcileSendGridEvent.mockResolvedValue({ data: true, error: null });
  });

  afterEach(() => delete process.env.EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS);

  it("accepts a signature from the current key and passes version 1 through to the reconcile RPC", async () => {
    const response = await POST(eventRequest(sampleEvents, current.privateKey));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ accepted: 1 });
    expect(reconcileSendGridEvent).toHaveBeenCalledWith(FAKE_POOL, expect.objectContaining({ signatureKeyVersion: 1 }));
  });

  it("accepts a signature from the next key during rotation and passes version 2 through", async () => {
    const response = await POST(eventRequest(sampleEvents, next.privateKey));
    expect(response.status).toBe(200);
    expect(reconcileSendGridEvent).toHaveBeenCalledWith(FAKE_POOL, expect.objectContaining({ signatureKeyVersion: 2 }));
  });

  it("rejects a signature from a key not in the keyring", async () => {
    const response = await POST(eventRequest(sampleEvents, unknown.privateKey));
    expect(response.status).toBe(401);
    expect(reconcileSendGridEvent).not.toHaveBeenCalled();
  });

  it("fails closed when ONLYEVS_EMAIL_CAPTURE_DATABASE_URL is unset (no service-role fallback)", async () => {
    getEmailCaptureDbPool.mockReturnValue(null);
    const response = await POST(eventRequest(sampleEvents, current.privateKey));
    expect(response.status).toBe(400);
    expect(reconcileSendGridEvent).not.toHaveBeenCalled();
  });
});
