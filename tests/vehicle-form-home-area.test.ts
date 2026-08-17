import { describe, expect, it } from "vitest";
import {
  EMPTY_HOME_AREA_DRAFT,
  buildHomeAreaPatch,
  interpretLocateSetupResponse,
  matchedRadiusPreset,
  parseBatteryCapacityDraft,
  validateBatteryCapacityDraft,
  validateHomeAreaDraft,
  type HomeAreaDraft,
} from "@/components/owner/vehicle-form";

function draft(overrides: Partial<HomeAreaDraft>): HomeAreaDraft {
  return { ...EMPTY_HOME_AREA_DRAFT, ...overrides };
}

describe("validateHomeAreaDraft", () => {
  it("accepts the fully-blank draft (no home area set)", () => {
    expect(validateHomeAreaDraft(EMPTY_HOME_AREA_DRAFT)).toEqual({});
  });

  it("accepts a complete valid draft", () => {
    expect(validateHomeAreaDraft(draft({ centerLat: "38.627", centerLng: "-90.1994", radiusMi: "50" }))).toEqual({});
  });

  it("requires lat and lng as a pair", () => {
    const onlyLat = validateHomeAreaDraft(draft({ centerLat: "38.627" }));
    expect(onlyLat.centerLat).toBeTruthy();
    expect(onlyLat.centerLng).toBeTruthy();

    const onlyLng = validateHomeAreaDraft(draft({ centerLng: "-90.1994" }));
    expect(onlyLng.centerLat).toBeTruthy();
    expect(onlyLng.centerLng).toBeTruthy();
  });

  it("rejects out-of-range coordinates", () => {
    const errors = validateHomeAreaDraft(draft({ centerLat: "999", centerLng: "-90.1994", radiusMi: "25" }));
    expect(errors.centerLat).toBeTruthy();
  });

  it("requires a positive radius when a center is set", () => {
    const missing = validateHomeAreaDraft(draft({ centerLat: "38.627", centerLng: "-90.1994" }));
    expect(missing.radiusMi).toBeTruthy();

    const zero = validateHomeAreaDraft(draft({ centerLat: "38.627", centerLng: "-90.1994", radiusMi: "0" }));
    expect(zero.radiusMi).toBeTruthy();

    const negative = validateHomeAreaDraft(draft({ centerLat: "38.627", centerLng: "-90.1994", radiusMi: "-5" }));
    expect(negative.radiusMi).toBeTruthy();
  });

  it("does not require a radius when the center is blank", () => {
    // A stray radius with no center is unusual but not itself invalid here —
    // buildHomeAreaPatch is what forces it to null on save.
    expect(validateHomeAreaDraft(draft({ radiusMi: "50" })).radiusMi).toBeUndefined();
  });
});

describe("buildHomeAreaPatch", () => {
  it("returns null for an invalid draft (caller must not attempt the write)", () => {
    expect(buildHomeAreaPatch(draft({ centerLat: "38.627" }))).toBeNull();
  });

  it("returns the fully-null patch for the blank draft (clears the home area)", () => {
    expect(buildHomeAreaPatch(EMPTY_HOME_AREA_DRAFT)).toEqual({
      home_area_center_lat: null,
      home_area_center_lng: null,
      home_area_radius_mi: null,
    });
  });

  it("returns the exact numeric patch for a complete draft", () => {
    expect(buildHomeAreaPatch(draft({ centerLat: "38.627", centerLng: "-90.1994", radiusMi: "100" }))).toEqual({
      home_area_center_lat: 38.627,
      home_area_center_lng: -90.1994,
      home_area_radius_mi: 100,
    });
  });

  it("forces radius to null when the center is cleared even if a radius string lingers", () => {
    expect(buildHomeAreaPatch(draft({ radiusMi: "50" }))).toEqual({
      home_area_center_lat: null,
      home_area_center_lng: null,
      home_area_radius_mi: null,
    });
  });
});

describe("matchedRadiusPreset", () => {
  it("matches an exact preset value", () => {
    expect(matchedRadiusPreset("100")).toBe(100);
  });

  it("falls back to custom for a non-preset or blank value", () => {
    expect(matchedRadiusPreset("75")).toBe("custom");
    expect(matchedRadiusPreset("")).toBe("custom");
  });
});

describe("interpretLocateSetupResponse", () => {
  it("fills the form-only coordinates on a successful reading", () => {
    const outcome = interpretLocateSetupResponse(200, { state: "reading", latitude: 38.627, longitude: -90.1994 });
    expect(outcome).toEqual({ kind: "filled", latitude: 38.627, longitude: -90.1994 });
  });

  it("maps every documented degraded state honestly, never fabricating coordinates", () => {
    expect(interpretLocateSetupResponse(404, {})).toEqual({ kind: "vehicle_not_found" });
    expect(interpretLocateSetupResponse(200, { state: "vin_unknown" })).toEqual({ kind: "vin_unknown" });
    expect(interpretLocateSetupResponse(200, { state: "reconnect_required" })).toEqual({ kind: "reconnect_required" });
    expect(interpretLocateSetupResponse(200, { state: "read_failed" })).toEqual({ kind: "read_failed" });
  });

  it("treats an unrecognized or malformed body as a network error rather than a silent success", () => {
    expect(interpretLocateSetupResponse(500, null)).toEqual({ kind: "network_error" });
    expect(interpretLocateSetupResponse(200, { state: "reading", latitude: "38.627" })).toEqual({ kind: "network_error" });
  });
});

describe("validateBatteryCapacityDraft", () => {
  it("accepts a blank draft — clearing the capacity is valid (unset)", () => {
    expect(validateBatteryCapacityDraft("")).toBeNull();
    expect(validateBatteryCapacityDraft("  ")).toBeNull();
  });

  it("accepts a plausible pack size", () => {
    expect(validateBatteryCapacityDraft("75")).toBeNull();
    expect(validateBatteryCapacityDraft("82.5")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(validateBatteryCapacityDraft("abc")).toBeTruthy();
  });

  it("rejects zero and negative capacities", () => {
    expect(validateBatteryCapacityDraft("0")).toBeTruthy();
    expect(validateBatteryCapacityDraft("-10")).toBeTruthy();
  });

  it("rejects an implausibly large capacity", () => {
    expect(validateBatteryCapacityDraft("9999")).toBeTruthy();
  });
});

describe("parseBatteryCapacityDraft", () => {
  it("returns null (clears the capacity) for a blank draft", () => {
    expect(parseBatteryCapacityDraft("")).toBeNull();
  });

  it("returns the numeric value for a valid draft", () => {
    expect(parseBatteryCapacityDraft("75")).toBe(75);
  });

  it("returns null (never a guessed value) for an invalid draft", () => {
    expect(parseBatteryCapacityDraft("abc")).toBeNull();
    expect(parseBatteryCapacityDraft("-5")).toBeNull();
  });
});
