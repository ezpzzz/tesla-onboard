import { describe, expect, it } from "vitest";
import {
  costProvenanceLabel,
  parseCostOverrideDraft,
  validateCostOverrideDraft,
} from "@/components/owner/cost-override-field";

describe("validateCostOverrideDraft", () => {
  it("rejects a blank draft — entering a value is the whole point of this control", () => {
    expect(validateCostOverrideDraft("")).toBeTruthy();
    expect(validateCostOverrideDraft("  ")).toBeTruthy();
  });

  it("accepts a plausible dollar amount, including zero", () => {
    expect(validateCostOverrideDraft("12.50")).toBeNull();
    expect(validateCostOverrideDraft("0")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(validateCostOverrideDraft("abc")).toBeTruthy();
  });

  it("rejects a negative amount", () => {
    expect(validateCostOverrideDraft("-5")).toBeTruthy();
  });

  it("rejects an implausibly large amount", () => {
    expect(validateCostOverrideDraft("999999")).toBeTruthy();
  });
});

describe("parseCostOverrideDraft", () => {
  it("returns the numeric value for a valid draft", () => {
    expect(parseCostOverrideDraft("12.5")).toBe(12.5);
  });

  it("returns null (never a guessed value) for an invalid draft", () => {
    expect(parseCostOverrideDraft("")).toBeNull();
    expect(parseCostOverrideDraft("abc")).toBeNull();
    expect(parseCostOverrideDraft("-1")).toBeNull();
  });
});

describe("costProvenanceLabel", () => {
  it("always spells out an owner-entered value distinctly from a reconciled invoice", () => {
    expect(costProvenanceLabel("manual")).toBe("Owner-entered");
    expect(costProvenanceLabel("invoice")).not.toBe("Owner-entered");
  });

  it("labels every documented provenance and nothing for null", () => {
    expect(costProvenanceLabel("invoice")).toBeTruthy();
    expect(costProvenanceLabel("rate")).toBeTruthy();
    expect(costProvenanceLabel(null)).toBeNull();
  });
});
