import { describe, expect, it } from "vitest";
import {
  TURO_INVOICE_WINDOW_MS,
  derivePacketPolicyRollup,
  derivePacketStatus,
  derivePacketTitle,
  formatBatteryDeltaFact,
  formatInvoiceWindowCountdown,
  formatMilesDrivenFact,
  formatOutOfAreaFact,
  isSupersedingPacket,
  parseEvidencePacketPayload,
  selectLatestPacketPerTrip,
  type EvidencePacketRow,
  type ParsedEvidencePacket,
} from "@/components/owner/packet-evidence-card";

// Mirrors the exact shape services/onlyevs-worker/index.ts's
// composeTripEvidencePacket writes.
function rawPayload(overrides: Record<string, unknown> = {}) {
  return {
    tripId: "trip-1",
    guestName: "Riley T.",
    startsAt: "2026-08-10T16:00:00.000Z",
    endsAt: "2026-08-14T16:00:00.000Z",
    bookends: {
      start: { odometerMi: 1000, odometerObservedAt: "2026-08-10T16:05:00.000Z", batteryPct: 90, batteryObservedAt: "2026-08-10T16:05:00.000Z", stale: false },
      end: { odometerMi: 1421, odometerObservedAt: "2026-08-14T16:03:00.000Z", batteryPct: 74, batteryObservedAt: "2026-08-14T16:03:00.000Z", stale: false },
    },
    milesDriven: 421,
    batteryDeltaPct: -16,
    odometerRegression: false,
    chargingSessionsDerived: true,
    chargingSessions: [{ id: "s1", tripId: "trip-1", vehicleId: "v1", kind: "ac_home", startedAt: 0, endedAt: 0, kWhAdded: 12.4, gapAffected: false, costUsd: null, costProvenance: null }],
    ...overrides,
  };
}

describe("parseEvidencePacketPayload", () => {
  it("parses the real worker payload shape end to end", () => {
    const parsed = parseEvidencePacketPayload(rawPayload());
    expect(parsed.tripId).toBe("trip-1");
    expect(parsed.guestName).toBe("Riley T.");
    expect(parsed.milesDriven).toBe(421);
    expect(parsed.bookendStart?.odometerMi).toBe(1000);
    expect(parsed.bookendEnd?.batteryPct).toBe(74);
    expect(parsed.chargingSessions).toHaveLength(1);
    expect(parsed.chargingSessions[0]).toEqual({ kind: "ac_home", kWhAdded: 12.4, gapAffected: false });
  });

  it("never throws on a malformed or empty payload — every field degrades independently", () => {
    expect(() => parseEvidencePacketPayload(null)).not.toThrow();
    expect(() => parseEvidencePacketPayload(undefined)).not.toThrow();
    expect(() => parseEvidencePacketPayload("garbage")).not.toThrow();
    expect(() => parseEvidencePacketPayload({})).not.toThrow();
    const parsed = parseEvidencePacketPayload({});
    expect(parsed.bookendStart).toBeNull();
    expect(parsed.bookendEnd).toBeNull();
    expect(parsed.milesDriven).toBeNull();
    expect(parsed.chargingSessions).toEqual([]);
  });

  it("absent-data rule: a missing bookend field parses to null, never a fabricated value", () => {
    const parsed = parseEvidencePacketPayload(rawPayload({ bookends: { start: null, end: { odometerMi: null, odometerObservedAt: null, batteryPct: 74, batteryObservedAt: "2026-08-14T16:03:00.000Z", stale: false } } }));
    expect(parsed.bookendStart).toBeNull();
    expect(parsed.bookendEnd?.odometerMi).toBeNull();
    expect(parsed.bookendEnd?.batteryPct).toBe(74);
  });
});

// T9 gap closure: composeTripEvidencePacket now populates vehicleId,
// milesAllowance, batteryPolicyPct, and outOfAreaOccurrences (previously
// always absent). rawPayload() intentionally omits these by default so
// every pre-existing test above keeps parsing them as null/undefined,
// unchanged.
describe("parseEvidencePacketPayload — vehicleId/milesAllowance/batteryPolicyPct/outOfAreaOccurrences (T9 gap closure)", () => {
  it("parses all four fields when the worker populated them", () => {
    const parsed = parseEvidencePacketPayload(rawPayload({
      vehicleId: "veh-1",
      milesAllowance: 600,
      batteryPolicyPct: 80,
      outOfAreaOccurrences: 2,
    }));
    expect(parsed.vehicleId).toBe("veh-1");
    expect(parsed.milesAllowance).toBe(600);
    expect(parsed.batteryPolicyPct).toBe(80);
    expect(parsed.outOfAreaOccurrences).toBe(2);
  });

  it("degrades all four fields to null when absent, never guessing", () => {
    const parsed = parseEvidencePacketPayload(rawPayload());
    expect(parsed.vehicleId).toBeNull();
    expect(parsed.milesAllowance).toBeNull();
    expect(parsed.batteryPolicyPct).toBeNull();
    expect(parsed.outOfAreaOccurrences).toBeNull();
  });

  it("parses outOfAreaOccurrences of 0 as a real, checked zero — distinct from null (unknown)", () => {
    const parsed = parseEvidencePacketPayload(rawPayload({ outOfAreaOccurrences: 0 }));
    expect(parsed.outOfAreaOccurrences).toBe(0);
  });
});

describe("derivePacketStatus", () => {
  const clean = parseEvidencePacketPayload(rawPayload());

  it("renders Clean return for a fully-captured, non-stale, non-gap-affected packet", () => {
    expect(derivePacketStatus(clean)).toEqual({ label: "Clean return", tone: "good" });
  });

  it("flags odometer regression as Needs attention", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ odometerRegression: true }));
    expect(derivePacketStatus(packet).label).toBe("Needs attention");
  });

  it("flags a missing bookend as Needs attention", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ bookends: { start: null, end: rawPayload().bookends.end } }));
    expect(derivePacketStatus(packet).label).toBe("Needs attention");
  });

  it("flags a stale bookend as Needs attention", () => {
    const stale = rawPayload();
    (stale.bookends as any).end.stale = true;
    expect(derivePacketStatus(parseEvidencePacketPayload(stale)).label).toBe("Needs attention");
  });

  it("flags a gap-affected charging session as Needs attention", () => {
    const packet = parseEvidencePacketPayload(rawPayload({
      chargingSessions: [{ id: "s1", tripId: "trip-1", vehicleId: "v1", kind: "ac_home", startedAt: 0, endedAt: 0, kWhAdded: 5, gapAffected: true, costUsd: null, costProvenance: null }],
    }));
    expect(derivePacketStatus(packet).label).toBe("Needs attention");
  });
});

describe("derivePacketStatus — delta-vs-policy verdicts (T9 gap closure)", () => {
  // rawPayload()'s bookends: start odometer 1000/battery 90, end odometer
  // 1421/battery 74 — 421 mi driven, -16% battery delta.
  it("flags a battery return below the resolved policy as Needs attention", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ batteryPolicyPct: 80 })); // 74 < 80
    expect(derivePacketStatus(packet).label).toBe("Needs attention");
  });

  it("stays Clean return when the battery return meets or exceeds the resolved policy", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ batteryPolicyPct: 70 })); // 74 >= 70
    expect(derivePacketStatus(packet).label).toBe("Clean return");
  });

  it("never claims a policy verdict when batteryPolicyPct is null (the worker couldn't resolve one)", () => {
    const packet = parseEvidencePacketPayload(rawPayload()); // no override, no reachable fallback
    expect(derivePacketStatus(packet).label).toBe("Clean return");
  });

  it("flags miles driven beyond the allowance as Needs attention, once an allowance exists", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ milesAllowance: 300 })); // 421 > 300
    expect(derivePacketStatus(packet).label).toBe("Needs attention");
  });

  it("stays Clean return when miles driven are within the allowance", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ milesAllowance: 500 })); // 421 <= 500
    expect(derivePacketStatus(packet).label).toBe("Clean return");
  });
});

describe("formatMilesDrivenFact / formatBatteryDeltaFact / formatOutOfAreaFact — card rendering of the new facts (T9 gap closure)", () => {
  it("renders miles driven plainly when no allowance context exists", () => {
    const packet = parseEvidencePacketPayload(rawPayload());
    expect(formatMilesDrivenFact(packet, derivePacketPolicyRollup(packet))).toBe("421 mi driven");
  });

  it("renders miles vs. allowance with the over-allowance amount when driven exceeds it", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ milesAllowance: 300 }));
    expect(formatMilesDrivenFact(packet, derivePacketPolicyRollup(packet))).toBe("421 mi of 300 mi allowed — 121 mi over");
  });

  it("renders miles vs. allowance with no over-allowance note when within it", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ milesAllowance: 500 }));
    expect(formatMilesDrivenFact(packet, derivePacketPolicyRollup(packet))).toBe("421 mi of 500 mi allowed");
  });

  it("renders 'Not captured' for miles when the packet has no milesDriven", () => {
    const packet: ParsedEvidencePacket = { ...parseEvidencePacketPayload(rawPayload()), milesDriven: null };
    expect(formatMilesDrivenFact(packet, derivePacketPolicyRollup(packet))).toBe("Not captured");
  });

  it("renders battery delta plainly when no policy context exists", () => {
    const packet = parseEvidencePacketPayload(rawPayload());
    expect(formatBatteryDeltaFact(packet, derivePacketPolicyRollup(packet))).toBe("-16%");
  });

  it("renders battery delta with a below-policy note", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ batteryPolicyPct: 80 }));
    expect(formatBatteryDeltaFact(packet, derivePacketPolicyRollup(packet))).toBe("-16% — below the 80% return policy");
  });

  it("renders battery delta with a plain policy annotation when at/above policy", () => {
    const packet = parseEvidencePacketPayload(rawPayload({ batteryPolicyPct: 70 }));
    expect(formatBatteryDeltaFact(packet, derivePacketPolicyRollup(packet))).toBe("-16% (policy: 70%)");
  });

  it("renders 'Not captured' for battery when the packet has no batteryDeltaPct", () => {
    const packet: ParsedEvidencePacket = { ...parseEvidencePacketPayload(rawPayload()), batteryDeltaPct: null };
    expect(formatBatteryDeltaFact(packet, derivePacketPolicyRollup(packet))).toBe("Not captured");
  });

  it("out-of-area: null collapses to one honest 'no data' sentence, never leaking which precondition failed", () => {
    expect(formatOutOfAreaFact(null)).toBe("No out-of-area tracking data for this trip");
  });

  it("out-of-area: a real, checked zero renders a clean confirmation, not the null copy", () => {
    expect(formatOutOfAreaFact(0)).toBe("In area for every recorded observation");
  });

  it("out-of-area: singular/plural occurrence counts", () => {
    expect(formatOutOfAreaFact(1)).toBe("1 observation outside the home area");
    expect(formatOutOfAreaFact(3)).toBe("3 observations outside the home area");
  });
});

describe("derivePacketTitle", () => {
  it("is consequence-led: status, then miles, then return charge", () => {
    const packet = parseEvidencePacketPayload(rawPayload());
    expect(derivePacketTitle(packet)).toBe("Clean return · 421 mi driven · 74% return charge");
  });

  it("omits facts the packet never captured, rather than a placeholder dash", () => {
    const packet: ParsedEvidencePacket = { ...parseEvidencePacketPayload(rawPayload()), milesDriven: null, bookendEnd: null };
    expect(derivePacketTitle(packet)).toBe("Needs attention");
  });
});

describe("formatInvoiceWindowCountdown", () => {
  const endsAt = Date.parse("2026-08-14T16:00:00.000Z");

  it("returns null when no trip end is known (never fabricates a deadline)", () => {
    expect(formatInvoiceWindowCountdown(null, Date.now())).toBeNull();
  });

  it("counts down while inside the 72h window", () => {
    const now = endsAt + 10 * 60 * 60 * 1_000; // 10h after return
    const result = formatInvoiceWindowCountdown(endsAt, now);
    expect(result?.expired).toBe(false);
    expect(result?.text).toContain("left to invoice");
  });

  it("reports the window as closed once 72h have elapsed", () => {
    const now = endsAt + TURO_INVOICE_WINDOW_MS + 60 * 60 * 1_000; // 1h past the deadline
    const result = formatInvoiceWindowCountdown(endsAt, now);
    expect(result?.expired).toBe(true);
    expect(result?.text).toContain("closed");
  });
});

describe("selectLatestPacketPerTrip", () => {
  function row(id: string, tripId: string, composedAt: number, version = 1): EvidencePacketRow {
    return { id, tripId, version, composedAt, payload: parseEvidencePacketPayload(rawPayload({ tripId })) };
  }

  it("keeps only the newest packet per trip, dropping superseded rows", () => {
    const rows = [row("p1", "trip-1", 1000), row("p2", "trip-1", 2000), row("p3", "trip-2", 500)];
    const result = selectLatestPacketPerTrip(rows);
    expect(result.map((r) => r.id).sort()).toEqual(["p2", "p3"].sort());
  });

  it("sorts newest-first", () => {
    const rows = [row("p1", "trip-1", 1000), row("p2", "trip-2", 2000)];
    expect(selectLatestPacketPerTrip(rows).map((r) => r.id)).toEqual(["p2", "p1"]);
  });

  // G4 supersede contract: a correction (higher version) always wins the
  // per-trip slot, even if a stale composed_at (e.g. clock skew, retry)
  // would otherwise suggest the older row is "newer".
  it("supersede contract: version 2 wins over version 1 for the same trip regardless of composedAt ordering", () => {
    const v1 = row("p1", "trip-1", 5000, 1);
    const v2 = row("p2", "trip-1", 1000, 2); // earlier composedAt, higher version
    const result = selectLatestPacketPerTrip([v1, v2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("p2");
    expect(result[0]!.version).toBe(2);
  });

  it("isSupersedingPacket: true for a correction (version 2+), false for a trip's first packet", () => {
    expect(isSupersedingPacket({ version: 1 })).toBe(false);
    expect(isSupersedingPacket({ version: 2 })).toBe(true);
    expect(isSupersedingPacket({ version: 5 })).toBe(true);
  });
});
