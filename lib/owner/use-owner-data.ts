"use client";

/**
 * Owner dashboard data hook. Renders an honest empty snapshot on the server
 * and first client paint, then layers in real browser-local guest progress
 * and the host's workspace-persisted vehicle roster after hydration.
 */

import { useEffect, useMemo, useState } from "react";
import { EMPTY_OWNER_SNAPSHOT, getOwnerDataSource } from "./data-source";
import { fleetStats, parseReturnPolicyPct } from "./derive";
import { useVehicleState } from "./vehicle-state";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { useGuestProgress } from "@/lib/progress-bridge";
import type { Driver, OwnerSnapshot, Trip } from "./types";

// Synchronous and deterministic so SSR and the first client paint match.
// getSnapshot() still runs after mount so a future live adapter remains a
// drop-in behind the same hook.
const INITIAL_SNAPSHOT: OwnerSnapshot = EMPTY_OWNER_SNAPSHOT;

export function useOwnerData() {
  const { config } = useTenantConfig();
  const [snapshot, setSnapshot] = useState<OwnerSnapshot>(INITIAL_SNAPSHOT);
  const [dataHydrated, setDataHydrated] = useState(false);
  const guestProgress = useGuestProgress();
  const {
    vehicles: vehicleStateVehicles,
    hydrated: vehicleHydrated,
    error: vehicleError,
  } = useVehicleState();

  useEffect(() => {
    let cancelled = false;
    getOwnerDataSource()
      .getSnapshot()
      .then((snap) => {
        if (!cancelled) {
          setSnapshot(snap);
          setDataHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const policyPct = useMemo(
    () => parseReturnPolicyPct(config.rental.returnChargeLevel),
    [config.rental.returnChargeLevel]
  );

  const merged = useMemo<OwnerSnapshot>(() => {
    let next = snapshot;

    if (dataHydrated && guestProgress) {
      const guestDriver: Driver = {
        id: "guest-local",
        name: guestProgress.guestName ?? "Guest (this browser)",
        email: "",
        source: "guest-local",
        progress: guestProgress,
      };

      const drivers: Driver[] = [
        ...next.drivers.filter((d) => d.id !== "guest-local"),
        guestDriver,
      ];

      const trips: Trip[] = next.trips.map((trip) => {
        if (trip.id !== guestProgress.tripId) return trip;
        if (trip.driverId !== null && trip.driverId !== "guest-local") return trip;
        return { ...trip, driverId: "guest-local" };
      });

      next = { ...next, drivers, trips };
    }

    // Independent of guest-progress hydration: swap in the host's own
    // vehicle roster as soon as vehicle-state has hydrated, whether or not
    // there's a browser-local guest at all.
    if (vehicleHydrated) {
      next = { ...next, vehicles: vehicleStateVehicles };
    }

    return next;
  }, [snapshot, dataHydrated, guestProgress, vehicleHydrated, vehicleStateVehicles]);

  const stats = useMemo(() => fleetStats(merged, policyPct), [merged, policyPct]);

  const hydrated = dataHydrated && vehicleHydrated;

  return {
    drivers: merged.drivers,
    trips: merged.trips,
    chargingSessions: merged.chargingSessions,
    vehicles: merged.vehicles,
    stats,
    policyPct,
    hydrated,
    vehicleError,
  };
}
