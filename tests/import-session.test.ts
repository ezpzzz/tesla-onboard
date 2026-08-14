import { describe, expect, it } from "vitest";
import {
  createOwnerImportToken,
  OWNER_IMPORT_TOKEN_PATTERN,
  ownerImportTokenHash,
} from "@/lib/owner/import-session";

describe("owner Tesla import session handles", () => {
  it("keeps the browser cookie fixed-size regardless of fleet payload size", () => {
    const token = createOwnerImportToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(OWNER_IMPORT_TOKEN_PATTERN);
    expect(ownerImportTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates unique opaque handles", () => {
    expect(createOwnerImportToken()).not.toBe(createOwnerImportToken());
  });

  it("rejects malformed handles before hashing", () => {
    expect(() => ownerImportTokenHash("not-a-valid-handle")).toThrow("invalid_owner_import_token");
  });
});
