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
import {
  fetchWorkspaceOperationalSnapshot,
  OWNER_TRIPS_CHANGED_EVENT,
} from "./trip-repository";
import { vehicleWorkspaceScope } from "./vehicle-repository";
import { fetchWorkspaceVehicleStats } from "./vehicle-stats-repository";
import type { VehicleStatsCurrent } from "./access-types";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

// Synchronous and deterministic so SSR and the first client paint match.
// getSnapshot() still runs after mount so a future live adapter remains a
// drop-in behind the same hook.
const INITIAL_SNAPSHOT: OwnerSnapshot = EMPTY_OWNER_SNAPSHOT;

export function useOwnerData() {
  const { config, tenantSlug } = useTenantConfig();
  const [snapshot, setSnapshot] = useState<OwnerSnapshot>(INITIAL_SNAPSHOT);
  const [dataHydrated, setDataHydrated] = useState(false);
  const [operationalError, setOperationalError] = useState<string | null>(null);
  const [vehicleTelemetry, setVehicleTelemetry] = useState<Record<string, VehicleStatsCurrent>>({});
  const [tripRefresh, setTripRefresh] = useState(0);
  const guestProgress = useGuestProgress();
  const {
    vehicles: vehicleStateVehicles,
    hydrated: vehicleHydrated,
    error: vehicleError,
  } = useVehicleState();

  useEffect(() => {
    const refresh = () => setTripRefresh((value) => value + 1);
    window.addEventListener(OWNER_TRIPS_CHANGED_EVENT, refresh);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30_000);
    return () => {
      window.removeEventListener(OWNER_TRIPS_CHANGED_EVENT, refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setDataHydrated(false);
    setOperationalError(null);
    setSnapshot(INITIAL_SNAPSHOT);
    setVehicleTelemetry({});
    const scope = vehicleWorkspaceScope(tenantSlug);
    const request = scope
      ? Promise.all([
          fetchWorkspaceOperationalSnapshot(scope),
          ONLYEVS_OPERATIONS_ENABLED ? fetchWorkspaceVehicleStats(scope) : Promise.resolve({}),
        ]).then(([snap, telemetry]) => ({ snap, telemetry }))
      : getOwnerDataSource().getSnapshot().then((snap) => ({ snap, telemetry: {} }));
    request
      .then(({ snap, telemetry }) => {
        if (!cancelled) {
          setSnapshot(snap);
          setVehicleTelemetry(telemetry);
          setDataHydrated(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setOperationalError(error instanceof Error ? error.message : "Operational data is unavailable.");
          setDataHydrated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [tenantSlug, tripRefresh]);

  const policyPct = useMemo(
    () => parseReturnPolicyPct(config.rental.returnChargeLevel),
    [config.rental.returnChargeLevel]
  );

  const merged = useMemo<OwnerSnapshot>(() => {
    let next = snapshot;

    if (dataHydrated && guestProgress && !vehicleWorkspaceScope(tenantSlug)) {
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
  }, [snapshot, dataHydrated, guestProgress, tenantSlug, vehicleHydrated, vehicleStateVehicles]);

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
    operationalError,
    vehicleTelemetry,
  };
}
