import { describe, expect, it } from "vitest";
import { applyGuestLinks, type WorkspaceGuestLinks } from "@/app/owner/drivers/guest-roster";
import type { Driver, Trip } from "@/lib/owner/types";

function trip(id: string, overrides: Partial<Trip> = {}): Trip {
  return {
    id,
    driverId: `trip-guest:${id}`,
    vehicleId: "veh-1",
    status: "upcoming",
    startAt: 0,
    endAt: 1,
    odometerStartMi: null,
    odometerEndMi: null,
    batteryStartPct: null,
    batteryEndPct: null,
    chargingSessionIds: [],
    ...overrides,
  };
}

function driver(tripId: string, name: string, email: string): Driver {
  return { id: `trip-guest:${tripId}`, name, email, source: "live", progress: null };
}

describe("applyGuestLinks -- Phase 7 drivers-page durable-guest regrouping (T11 UI half)", () => {
  it("returns the inputs unchanged when no trip has a durable link", () => {
    const drivers = [driver("trip-1", "Riley T.", "riley@example.com")];
    const trips = [trip("trip-1")];
    const links: WorkspaceGuestLinks = { tripToGuestId: new Map(), guestDisplayNames: new Map() };
    const result = applyGuestLinks(drivers, trips, links);
    expect(result.drivers).toBe(drivers);
    expect(result.trips).toBe(trips);
  });

  it("groups two trips linked to the same durable guest into one driver row", () => {
    const drivers = [
      driver("trip-1", "Riley T.", "riley@example.com"),
      driver("trip-2", "Riley T.", "riley@example.com"),
    ];
    const trips = [
      trip("trip-1", { startAt: 100 }),
      trip("trip-2", { startAt: 200 }),
    ];
    const links: WorkspaceGuestLinks = {
      tripToGuestId: new Map([["trip-1", "guest-1"], ["trip-2", "guest-1"]]),
      guestDisplayNames: new Map([["guest-1", "Riley T."]]),
    };
    const result = applyGuestLinks(drivers, trips, links);

    expect(result.drivers).toHaveLength(1);
    expect(result.drivers[0]!.id).toBe("guest-1");
    expect(result.drivers[0]!.name).toBe("Riley T.");
    expect(result.trips.map((t) => t.driverId)).toEqual(["guest-1", "guest-1"]);
  });

  it("picks the most recently-started linked trip's driver record for email/progress", () => {
    const drivers = [
      driver("trip-1", "Riley T.", "old@example.com"),
      driver("trip-2", "Riley T.", "new@example.com"),
    ];
    const trips = [
      trip("trip-1", { startAt: 100 }),
      trip("trip-2", { startAt: 500 }),
    ];
    const links: WorkspaceGuestLinks = {
      tripToGuestId: new Map([["trip-1", "guest-1"], ["trip-2", "guest-1"]]),
      guestDisplayNames: new Map([["guest-1", "Riley T."]]),
    };
    const result = applyGuestLinks(drivers, trips, links);
    expect(result.drivers[0]!.email).toBe("new@example.com");
  });

  it("leaves an unlinked trip's driver row exactly as-is (honest partial state, never a fabricated guest)", () => {
    const drivers = [
      driver("trip-1", "Riley T.", "riley@example.com"),
      driver("trip-2", "Sam K.", "sam@example.com"),
    ];
    const trips = [trip("trip-1"), trip("trip-2")];
    const links: WorkspaceGuestLinks = {
      tripToGuestId: new Map([["trip-1", "guest-1"]]),
      guestDisplayNames: new Map([["guest-1", "Riley T."]]),
    };
    const result = applyGuestLinks(drivers, trips, links);

    const ids = result.drivers.map((d) => d.id).sort();
    expect(ids).toEqual(["guest-1", "trip-guest:trip-2"].sort());
    expect(result.trips.find((t) => t.id === "trip-2")?.driverId).toBe("trip-guest:trip-2");
  });

  it("never drops the browser-local guest row (id 'guest-local' never matches the trip-guest: prefix)", () => {
    const localDriver: Driver = { id: "guest-local", name: "Guest (this browser)", email: "", source: "guest-local", progress: null };
    const drivers = [localDriver, driver("trip-1", "Riley T.", "riley@example.com")];
    const trips = [trip("trip-1")];
    const links: WorkspaceGuestLinks = {
      tripToGuestId: new Map([["trip-1", "guest-1"]]),
      guestDisplayNames: new Map([["guest-1", "Riley T."]]),
    };
    const result = applyGuestLinks(drivers, trips, links);
    expect(result.drivers.some((d) => d.id === "guest-local")).toBe(true);
  });
});
