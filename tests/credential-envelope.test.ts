import { describe, expect, it } from "vitest";
import {
  decryptCredential,
  encryptCredential,
  parseCredentialKeyring,
} from "@/lib/owner/credential-envelope";

const key1 = Buffer.alloc(32, 7).toString("base64");
const key2 = Buffer.alloc(32, 9).toString("base64");
const keyring = parseCredentialKeyring(`1:${key1},2:${key2}`);
const aad = {
  workspaceId: "6acaf5d4-a1ce-4c32-a17f-ae3779be897f",
  shopSlug: "onlyevs",
  provider: "tesla" as const,
  field: "refresh_token" as const,
};

describe("credential envelope", () => {
  it("encrypts with the active key and decrypts with bound tenant context", () => {
    const sealed = encryptCredential("super-secret-refresh-token", keyring, aad);
    expect(sealed.keyVersion).toBe(2);
    expect(sealed.ciphertext).not.toContain("super-secret-refresh-token");
    expect(decryptCredential(sealed.ciphertext, keyring, aad)).toBe(
      "super-secret-refresh-token",
    );
  });

  it("rejects cross-tenant replay and ciphertext tampering", () => {
    const sealed = encryptCredential("token", keyring, aad);
    expect(() =>
      decryptCredential(sealed.ciphertext, keyring, {
        ...aad,
        workspaceId: "eea30d5f-485d-4db8-bbd3-1fd6497a5971",
      }),
    ).toThrow("credential_decryption_failed");

    const last = sealed.ciphertext.at(-1) === "A" ? "B" : "A";
    expect(() =>
      decryptCredential(`${sealed.ciphertext.slice(0, -1)}${last}`, keyring, aad),
    ).toThrow("credential_decryption_failed");
  });

  it("rejects malformed or weak keyrings", () => {
    expect(() => parseCredentialKeyring("1:dG9vLXNob3J0")).toThrow(
      "ONLYEVS_DATA_ENCRYPTION_KEYS",
    );
    expect(() => parseCredentialKeyring(`1:${key1},1:${key2}`)).toThrow(
      "ONLYEVS_DATA_ENCRYPTION_KEYS",
    );
  });
});
