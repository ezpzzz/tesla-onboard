import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  decodeEvmailEnvelope,
  decodeEvmailPlaintext,
  encodeEvmailEnvelope,
  encodeEvmailPlaintext,
  evmailAad,
  lengthPrefixedBytes,
  parseCanonicalJson,
} from "@/packages/email-ingest-contract/src";

describe("email ingest contract", () => {
  it("canonicalizes objects recursively", () => {
    expect(canonicalJson({ z: 1, a: { y: true, b: null } })).toBe('{"a":{"b":null,"y":true},"z":1}');
  });

  it("rejects non-canonical and unknown request fields", () => {
    const bytes = new TextEncoder().encode('{"z":1,"a":2}');
    expect(() => parseCanonicalJson(bytes, ["a", "z"])).toThrow("canonical_json_bytes_mismatch");
    const extra = new TextEncoder().encode('{"a":1,"extra":2}');
    expect(() => parseCanonicalJson(extra, ["a"])).toThrow("canonical_json_unknown_field");
  });

  it("uses unambiguous length-prefixed bytes", () => {
    expect([...lengthPrefixedBytes(["ab", "c"])]).not.toEqual([...lengthPrefixedBytes(["a", "bc"])]);
    expect(evmailAad({ inboundId: "i", aliasHash: "a", rawSha256: "r", normalizedSha256: "n", objectKey: "o" }).byteLength).toBeGreaterThan(20);
  });

  it("round-trips EVMAIL1 framing and plaintext", () => {
    const plaintext = encodeEvmailPlaintext(new Uint8Array([1, 2, 3]), new TextEncoder().encode("{}"));
    const decodedPlaintext = decodeEvmailPlaintext(plaintext);
    expect([...decodedPlaintext.rawMessage]).toEqual([1, 2, 3]);
    expect(new TextDecoder().decode(decodedPlaintext.normalizedJson)).toBe("{}");

    const envelope = encodeEvmailEnvelope({
      kekVersion: 3,
      wrapIv: new Uint8Array(12).fill(1),
      wrappedDek: new Uint8Array(48).fill(2),
      contentIv: new Uint8Array(12).fill(3),
      ciphertext: new Uint8Array(32).fill(4),
    });
    const decoded = decodeEvmailEnvelope(envelope);
    expect(decoded.kekVersion).toBe(3);
    expect(decoded.wrappedDek).toHaveLength(48);
    expect(decoded.ciphertext).toHaveLength(32);
  });

  it("rejects malformed envelope framing", () => {
    expect(() => decodeEvmailEnvelope(new Uint8Array(90))).toThrow();
    expect(() => encodeEvmailEnvelope({
      kekVersion: 1,
      wrapIv: new Uint8Array(11),
      wrappedDek: new Uint8Array(48),
      contentIv: new Uint8Array(12),
      ciphertext: new Uint8Array(16),
    })).toThrow("evmail_iv_length");
  });
});
