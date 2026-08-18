import { describe, expect, it } from "vitest";
import { buildGuestMergeCopy } from "@/components/owner/guest-merge-dialog";
import {
  duplicatePartnerIds,
  findPossibleDuplicateGuestGroups,
  isPossibleDuplicateDriver,
} from "@/components/owner/guest-duplicate-hints";
import { GUEST_CROSS_TRIP_ROLLUPS_ENABLED, computeGuestRollup } from "@/components/owner/guest-rollup-stats";
import type { Driver, Trip } from "@/lib/owner/types";

function driver(id: string, name: string, email: string): Driver {
  return { id, name, email, source: "live", progress: null };
}

function trip(id: string, driverId: string | null, startMi: number | null, endMi: number | null): Trip {
  return {
    id,
    driverId,
    vehicleId: "veh-1",
    status: "completed",
    startAt: 0,
    endAt: 1,
    odometerStartMi: startMi,
    odometerEndMi: endMi,
    batteryStartPct: null,
    batteryEndPct: null,
    chargingSessionIds: [],
  };
}

describe("buildGuestMergeCopy", () => {
  it("names the consequence in the title, never a bare 'Are you sure?'", () => {
    const copy = buildGuestMergeCopy(
      { displayName: "Riley T." },
      { displayName: "Sam K." },
      4,
      2,
    );
    expect(copy.title).toBe("Merge Riley T. into Sam K.?");
    expect(copy.title.toLowerCase()).not.toContain("are you sure");
  });

  it("states exactly what happens with real counts, pluralized", () => {
    const copy = buildGuestMergeCopy(
      { displayName: "Riley T." },
      { displayName: "Sam K." },
      4,
      2,
    );
    expect(copy.body).toBe(
      "4 trips and 2 identity keys move to Sam K. Riley T.'s record is removed. You can re-split by key later.",
    );
  });

  it("singularizes 1 trip / 1 identity key correctly", () => {
    const copy = buildGuestMergeCopy(
      { displayName: "Riley T." },
      { displayName: "Sam K." },
      1,
      1,
    );
    expect(copy.body).toBe(
      "1 trip and 1 identity key move to Sam K. Riley T.'s record is removed. You can re-split by key later.",
    );
  });

  it("handles zero counts honestly rather than omitting them", () => {
    const copy = buildGuestMergeCopy(
      { displayName: "Riley T." },
      { displayName: "Sam K." },
      0,
      0,
    );
    expect(copy.body).toBe(
      "0 trips and 0 identity keys move to Sam K. Riley T.'s record is removed. You can re-split by key later.",
    );
  });

  it("carries the consequence verb on the confirm button, never a bare confirmation", () => {
    const copy = buildGuestMergeCopy({ displayName: "A" }, { displayName: "B" }, 1, 0);
    expect(copy.confirmLabel).toBe("Merge records");
  });

  it("falls back to a generic name when displayName is blank, without crashing", () => {
    const copy = buildGuestMergeCopy({ displayName: "" }, { displayName: "" }, 1, 1);
    expect(copy.title).toBe("Merge This guest into this guest?");
  });
});

describe("findPossibleDuplicateGuestGroups", () => {
  it("groups drivers sharing a normalized email", () => {
    const drivers = [
      driver("d1", "Riley T.", "Riley@Example.com"),
      driver("d2", "Riley Torres", "riley@example.com "),
      driver("d3", "Sam K.", "sam@example.com"),
    ];
    const groups = findPossibleDuplicateGuestGroups(drivers);
    expect(groups).toHaveLength(1);
    expect(groups[0].driverIds.sort()).toEqual(["d1", "d2"]);
  });

  it("never groups drivers with an empty email", () => {
    const drivers = [driver("d1", "A", ""), driver("d2", "B", "")];
    expect(findPossibleDuplicateGuestGroups(drivers)).toHaveLength(0);
  });

  it("is a hint only — a single driver per email produces no group", () => {
    const drivers = [driver("d1", "A", "a@example.com")];
    expect(findPossibleDuplicateGuestGroups(drivers)).toHaveLength(0);
  });

  it("isPossibleDuplicateDriver / duplicatePartnerIds agree with the groups", () => {
    const drivers = [
      driver("d1", "A", "shared@example.com"),
      driver("d2", "B", "shared@example.com"),
      driver("d3", "C", "unique@example.com"),
    ];
    const groups = findPossibleDuplicateGuestGroups(drivers);
    expect(isPossibleDuplicateDriver("d1", groups)).toBe(true);
    expect(isPossibleDuplicateDriver("d3", groups)).toBe(false);
    expect(duplicatePartnerIds("d1", groups)).toEqual(["d2"]);
    expect(duplicatePartnerIds("d3", groups)).toEqual([]);
  });
});

describe("guest rollup stats gate", () => {
  it("stays off until the Phase 3 key-stability validation passes (binary bar)", () => {
    expect(GUEST_CROSS_TRIP_ROLLUPS_ENABLED).toBe(false);
  });

  it("computeGuestRollup only counts trips with both bookends, never fabricating miles", () => {
    const trips = [
      trip("t1", "d1", 100, 250),
      trip("t2", "d1", 300, null), // in progress — no delta
      trip("t3", "d1", null, null),
    ];
    const rollup = computeGuestRollup(trips);
    expect(rollup.tripCount).toBe(3);
    expect(rollup.totalMiles).toBe(150);
  });

  it("computeGuestRollup on no trips returns zero, not NaN", () => {
    expect(computeGuestRollup([])).toEqual({ tripCount: 0, totalMiles: 0 });
  });

  it("computeGuestRollup excludes an odometer-regression trip's miles rather than going negative", () => {
    const trips = [
      trip("t1", "d1", 100, 250), // 150 mi, counts
      trip("t2", "d1", 500, 400), // end < start (bad manual entry) — data-error, excluded
    ];
    const rollup = computeGuestRollup(trips);
    expect(rollup.tripCount).toBe(2);
    expect(rollup.totalMiles).toBe(150);
  });
});
