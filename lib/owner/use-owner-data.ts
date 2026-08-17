"use client";

/**
 * Owner dashboard data hook. Renders an honest empty snapshot on the server
 * and first client paint, then layers in real browser-local guest progress
 * and the host's workspace-persisted vehicle roster after hydration.
 */

import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { fetchWorkspaceChargeSessions } from "./charge-session-repository";
import { toLegacyChargingSessions } from "./charge-sessions";
import type { VehicleStatsCurrent } from "./access-types";
import { ONLYEVS_OPERATIONS_ENABLED } from "@/lib/runtime-features";

// Synchronous and deterministic so SSR and the first client paint match.
// getSnapshot() still runs after mount so a future live adapter remains a
// drop-in behind the same hook.
const INITIAL_SNAPSHOT: OwnerSnapshot = EMPTY_OWNER_SNAPSHOT;

function useOwnerDataValue() {
  const { config, tenantSlug, loading: tenantLoading } = useTenantConfig();
  const [snapshot, setSnapshot] = useState<OwnerSnapshot>(INITIAL_SNAPSHOT);
  const [dataHydrated, setDataHydrated] = useState(false);
  const [operationalError, setOperationalError] = useState<string | null>(null);
  const [vehicleTelemetry, setVehicleTelemetry] = useState<Record<string, VehicleStatsCurrent>>({});
  const [tripRefresh, setTripRefresh] = useState(0);
  const loadedScopeRef = useRef<string | null>(null);
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
    if (tenantLoading) return;
    let cancelled = false;
    const scope = vehicleWorkspaceScope(tenantSlug);
    const scopeKey = scope ? `${scope.workspaceId}~${scope.shopSlug}` : `demo:${tenantSlug ?? "default"}`;
    const scopeChanged = loadedScopeRef.current !== scopeKey;
    loadedScopeRef.current = scopeKey;
    if (scopeChanged) {
      setDataHydrated(false);
      setSnapshot(INITIAL_SNAPSHOT);
      setVehicleTelemetry({});
    }
    setOperationalError(null);
    const request = scope
      ? fetchWorkspaceOperationalSnapshot(scope).then(async (snap) => {
          // Real charge sessions (Phase 3) are derived read-time from
          // history, keyed off the trips the snapshot just resolved — so
          // this has to run after the snapshot, not in parallel with it.
          // A derivation failure must never take down the rest of the
          // snapshot: fall back to the honest empty list, same as every
          // other degraded-read path in this hook.
          const [telemetry, chargeSessions] = await Promise.all([
            ONLYEVS_OPERATIONS_ENABLED ? fetchWorkspaceVehicleStats(scope) : Promise.resolve({}),
            fetchWorkspaceChargeSessions(scope, snap.trips).catch(() => []),
          ]);
          return {
            snap: { ...snap, chargingSessions: toLegacyChargingSessions(chargeSessions) },
            telemetry,
          };
        })
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
  }, [tenantLoading, tenantSlug, tripRefresh]);

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

type OwnerDataValue = ReturnType<typeof useOwnerDataValue>;

const OwnerDataContext = createContext<OwnerDataValue | null>(null);

/**
 * Lives in the persistent owner layout so route changes reuse one operational
 * snapshot, one refresh timer, and one set of workspace subscriptions.
 */
export function OwnerDataProvider({ children }: { children: ReactNode }) {
  const value = useOwnerDataValue();
  return createElement(OwnerDataContext.Provider, { value }, children);
}

export function useOwnerData(): OwnerDataValue {
  const value = useContext(OwnerDataContext);
  if (!value) throw new Error("useOwnerData must be used inside OwnerDataProvider.");
  return value;
}
