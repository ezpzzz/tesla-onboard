import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSendGridWebhookKeyring, verifySendGridWebhookSignature } from "@/lib/email/sendgrid-webhook-security";

function ecKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKeyDer: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey,
  };
}

function signEvent(privateKey: ReturnType<typeof ecKeyPair>["privateKey"], timestamp: string, raw: Buffer) {
  return sign("sha256", Buffer.concat([Buffer.from(timestamp), raw]), privateKey).toString("base64");
}

describe("parseSendGridWebhookKeyring", () => {
  it("accepts a bare single value as version 1 for backward compatibility", () => {
    const { publicKeyDer } = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(publicKeyDer, "TEST_VAR");
    expect([...keyring.keys.keys()]).toEqual([1]);
  });

  it("parses multiple version:key entries", () => {
    const a = ecKeyPair();
    const b = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(`1:${a.publicKeyDer},2:${b.publicKeyDer}`, "TEST_VAR");
    expect([...keyring.keys.keys()].sort()).toEqual([1, 2]);
  });

  it("rejects duplicate versions", () => {
    const a = ecKeyPair();
    const b = ecKeyPair();
    expect(() => parseSendGridWebhookKeyring(`1:${a.publicKeyDer},1:${b.publicKeyDer}`, "TEST_VAR")).toThrow();
  });

  it("rejects an empty value", () => {
    expect(() => parseSendGridWebhookKeyring("", "TEST_VAR")).toThrow();
  });

  it("rejects multiple bare entries with no version prefix", () => {
    const a = ecKeyPair();
    const b = ecKeyPair();
    expect(() => parseSendGridWebhookKeyring(`${a.publicKeyDer},${b.publicKeyDer}`, "TEST_VAR")).toThrow();
  });
});

describe("verifySendGridWebhookSignature", () => {
  const raw = Buffer.from(JSON.stringify([{ sg_event_id: "evt-1" }]));
  const timestamp = "1700000000";

  it("verifies against the current key and reports its version", () => {
    const current = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(`1:${current.publicKeyDer}`, "TEST_VAR");
    const signature = signEvent(current.privateKey, timestamp, raw);
    expect(verifySendGridWebhookSignature(raw, timestamp, signature, keyring)).toBe(1);
  });

  it("verifies against the next key during rotation without needing the current key to match", () => {
    const current = ecKeyPair();
    const next = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(`1:${current.publicKeyDer},2:${next.publicKeyDer}`, "TEST_VAR");
    const signature = signEvent(next.privateKey, timestamp, raw);
    expect(verifySendGridWebhookSignature(raw, timestamp, signature, keyring)).toBe(2);
  });

  it("rejects a signature from a key that isn't in the keyring", () => {
    const configured = ecKeyPair();
    const unknown = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(`1:${configured.publicKeyDer}`, "TEST_VAR");
    const signature = signEvent(unknown.privateKey, timestamp, raw);
    expect(verifySendGridWebhookSignature(raw, timestamp, signature, keyring)).toBeNull();
  });

  it("rejects a tampered payload even with a valid signature for other content", () => {
    const current = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(`1:${current.publicKeyDer}`, "TEST_VAR");
    const signature = signEvent(current.privateKey, timestamp, raw);
    const tampered = Buffer.from(JSON.stringify([{ sg_event_id: "evt-2" }]));
    expect(verifySendGridWebhookSignature(tampered, timestamp, signature, keyring)).toBeNull();
  });

  it("rejects a malformed base64 signature without throwing", () => {
    const current = ecKeyPair();
    const keyring = parseSendGridWebhookKeyring(`1:${current.publicKeyDer}`, "TEST_VAR");
    expect(verifySendGridWebhookSignature(raw, timestamp, "", keyring)).toBeNull();
  });
});
