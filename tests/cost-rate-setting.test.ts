import { describe, expect, it } from "vitest";
import {
  isDeniedWrite,
  isMissingColumnError,
  parseRateDraft,
  validateRateDraft,
} from "@/components/owner/cost-rate-setting";

describe("validateRateDraft", () => {
  it("accepts a blank draft (clears the rate)", () => {
    expect(validateRateDraft("")).toBeNull();
    expect(validateRateDraft("   ")).toBeNull();
  });

  it("accepts a plausible positive rate", () => {
    expect(validateRateDraft("0.14")).toBeNull();
    expect(validateRateDraft("1")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(validateRateDraft("abc")).toBeTruthy();
  });

  it("rejects zero and negative rates", () => {
    expect(validateRateDraft("0")).toBeTruthy();
    expect(validateRateDraft("-0.1")).toBeTruthy();
  });

  it("rejects an implausibly large rate rather than accepting a fat-fingered value", () => {
    expect(validateRateDraft("50")).toBeTruthy();
  });
});

describe("parseRateDraft", () => {
  it("returns null for a blank draft", () => {
    expect(parseRateDraft("")).toBeNull();
  });

  it("returns the numeric value for a valid draft", () => {
    expect(parseRateDraft("0.14")).toBe(0.14);
  });

  it("returns null (never a guessed value) for an invalid draft", () => {
    expect(parseRateDraft("abc")).toBeNull();
    expect(parseRateDraft("-1")).toBeNull();
  });
});

describe("isMissingColumnError", () => {
  it("recognizes Postgres's undefined-column code", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
  });

  it("recognizes PostgREST's schema-cache-miss code", () => {
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
  });

  it("treats every other error as a generic save failure", () => {
    expect(isMissingColumnError({ code: "23505" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
    expect(isMissingColumnError(undefined)).toBe(false);
  });
});

describe("isDeniedWrite", () => {
  it("flags a zero-row update result as denied — RLS silently filtered the write out", () => {
    expect(isDeniedWrite([])).toBe(true);
  });

  it("treats a missing/undefined/null rows array the same as zero rows", () => {
    expect(isDeniedWrite(undefined)).toBe(true);
    expect(isDeniedWrite(null)).toBe(true);
  });

  it("does not flag a write that actually updated a row", () => {
    expect(isDeniedWrite([{ home_charge_rate_usd_per_kwh: 0.14 }])).toBe(false);
  });
});
