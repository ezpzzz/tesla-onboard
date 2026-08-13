"use client";

/**
 * Owner dashboard data hook. Renders the mock snapshot identically on the
 * server and the first client paint (no localStorage read before mount, same
 * pattern as lib/store.ts's hydration guard), then layers in the real
 * browser-local guest — read via `useGuestProgress()` from
 * lib/progress-bridge.ts — once mounted.
 */

import { useEffect, useMemo, useState } from "react";
import { getOwnerDataSource } from "./data-source";
import { MOCK_CHARGING_SESSIONS, MOCK_DRIVERS, MOCK_TRIPS } from "./mock-data";
import { fleetStats, parseReturnPolicyPct } from "./derive";
import { hostConfig } from "@/lib/config";
import { useGuestProgress } from "@/lib/progress-bridge";
import type { Driver, OwnerSnapshot, Trip } from "./types";

// Seeded synchronously (not read from getSnapshot()'s Promise) so server and
// first client paint render the identical mock snapshot with no flash of
// empty state — literal fixtures, so this is still SSR-safe. getSnapshot()
// still runs after mount so a future live adapter (see data-source.ts) is a
// drop-in without touching this hook's shape.
const INITIAL_SNAPSHOT: OwnerSnapshot = {
  drivers: MOCK_DRIVERS,
  trips: MOCK_TRIPS,
  chargingSessions: MOCK_CHARGING_SESSIONS,
};

export function useOwnerData() {
  const [snapshot, setSnapshot] = useState<OwnerSnapshot>(INITIAL_SNAPSHOT);
  const [hydrated, setHydrated] = useState(false);
  const guestProgress = useGuestProgress();

  useEffect(() => {
    let cancelled = false;
    getOwnerDataSource()
      .getSnapshot()
      .then((snap) => {
        if (!cancelled) {
          setSnapshot(snap);
          setHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const policyPct = useMemo(
    () => parseReturnPolicyPct(hostConfig.rental.returnChargeLevel),
    []
  );

  const merged = useMemo<OwnerSnapshot>(() => {
    if (!hydrated || !guestProgress) return snapshot;

    const guestDriver: Driver = {
      id: "guest-local",
      name: guestProgress.guestName ?? "Guest (this browser)",
      email: "",
      source: "guest-local",
      progress: guestProgress,
    };

    const drivers: Driver[] = [
      ...snapshot.drivers.filter((d) => d.id !== "guest-local"),
      guestDriver,
    ];

    const trips: Trip[] = snapshot.trips.map((trip) => {
      if (trip.id !== guestProgress.tripId) return trip;
      if (trip.driverId !== null && trip.driverId !== "guest-local") return trip; // never clobber an assigned mock trip
      return { ...trip, driverId: "guest-local" };
    });

    return { ...snapshot, drivers, trips };
  }, [snapshot, hydrated, guestProgress]);

  const stats = useMemo(() => fleetStats(merged, policyPct), [merged, policyPct]);

  return {
    drivers: merged.drivers,
    trips: merged.trips,
    chargingSessions: merged.chargingSessions,
    stats,
    policyPct,
    hydrated,
  };
}
