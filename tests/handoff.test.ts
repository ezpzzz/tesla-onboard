import { describe, expect, it } from "vitest";
import { handoffSteps, selectAttentionQueue, selectNextHandoff } from "@/lib/owner/handoff";
import type { Driver, Trip, Vehicle } from "@/lib/owner/types";

const now = Date.parse("2026-08-15T12:00:00Z");
const trip = (id: string, status: Trip["status"], startAt: number, endAt: number): Trip => ({
  id, driverId: `guest-${id}`, vehicleId: "vehicle-1", status, startAt, endAt,
  pickupLocation: "Pickup garage", returnLocation: "Return garage", odometerStartMi: null,
  odometerEndMi: null, batteryStartPct: null, batteryEndPct: null, chargingSessionIds: [],
});
const vehicle = { id: "vehicle-1" } as Vehicle;

describe("owner handoff projection", () => {
  it("selects the earliest active return or upcoming pickup", () => {
    const active = trip("active", "active", now - 3_600_000, now + 7_200_000);
    const upcoming = trip("upcoming", "upcoming", now + 3_600_000, now + 86_400_000);
    const drivers = [{ id: "guest-active", name: "Active Guest", progress: null } as Driver];
    const result = selectNextHandoff([active, upcoming], drivers, [vehicle], now);
    expect(result).toMatchObject({ kind: "pickup", boundaryAt: upcoming.startAt, location: "Pickup garage" });
    expect(result?.trip.id).toBe("upcoming");
  });

  it("reports only real progress and access state", () => {
    const next = trip("next", "upcoming", now + 3_600_000, now + 86_400_000);
    next.accessStatus = null;
    const result = selectNextHandoff([next], [], [vehicle], now)!;
    expect(handoffSteps(result).map((step) => [step.label, step.value])).toEqual([
      ["Link", "Pending"], ["Tesla", "Pending"], ["Guide", "0%"], ["Pickup", "Pending"],
    ]);
    expect(handoffSteps(result).map((step) => step.state)).toEqual([
      "current", "pending", "pending", "pending",
    ]);
  });

  it("keeps unfinished Tesla access pending while the guide is current", () => {
    const next = trip("progress", "upcoming", now + 3_600_000, now + 86_400_000);
    next.accessStatus = "scheduled";
    const driver = {
      id: "guest-progress",
      name: "Maya",
      progress: { pct: 0.5, isDone: false },
    } as Driver;
    const result = selectNextHandoff([next], [driver], [vehicle], now)!;

    expect(handoffSteps(result).map((step) => [step.label, step.state])).toEqual([
      ["Link", "complete"],
      ["Tesla", "pending"],
      ["Guide", "current"],
      ["Pickup", "pending"],
    ]);
  });

  it("keeps the attention queue focused on real handoffs and orders stalled guests first", () => {
    const active = trip("active", "active", now - 3_600_000, now + 7_200_000);
    const upcoming = trip("upcoming", "upcoming", now + 3_600_000, now + 86_400_000);
    const completed = trip("historical", "completed", now - 172_800_000, now - 86_400_000);
    const drivers = [
      { id: "guest-historical", name: "Historical", progress: null },
      { id: "guest-upcoming", name: "In progress", progress: { pct: 0.5, isDone: false, completed: ["welcome"], updatedAt: now } },
      { id: "guest-active", name: "Stalled", progress: { pct: 0.5, isDone: false, completed: ["welcome"], updatedAt: now - 2 * 86_400_000 } },
    ] as Driver[];

    expect(selectAttentionQueue(drivers, [completed, upcoming, active], now).map((row) => [row.driver.id, row.status])).toEqual([
      ["guest-active", "stalled"],
      ["guest-upcoming", "in-progress"],
    ]);
  });
});
