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

// Build-time constant, identical on the server and the first client render
// (unlike tenantSlug, which needs an effect to read localStorage) — safe to
// read synchronously with no hydration-mismatch risk. When it's false there
// is no backend to wait for at all: getOwnerDataSource() is always the
// EmptyOwnerDataSource seam today, which always resolves to exactly
// INITIAL_SNAPSHOT. Gating the loading skeleton on an effect+fetch round
// trip for a value that can never differ from what's already on screen only
// produces an observable "loading" flash for content that was never
// actually loading.
const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

// Module scope (not React state), keyed by workspace scope: fetching the
// operational snapshot is always at least one tick behind first paint (it's
// gated on TenantConfigProvider resolving first, then its own async fetch),
// and this hook can legitimately get a fresh instance for reasons that have
// nothing to do with the data itself (dev-only remounts, route changes that
// remount the owner layout tree, etc.). Without this cache, every such
// instance starts `dataHydrated: false` and re-shows the full-page loading
// skeleton over content this browser tab already loaded. Real workspace
// scope changes still get a clean reset via `loadedScopeRef` below.
//
// Trust boundary: this cache holds driver PII, VINs, and telemetry, and it is
// seeded synchronously on remount, before any fresh authorization/fetch
// completes. That optimistic display is only safe because invalidation is
// airtight — see the `onError` cache clear below, which is what actually
// keeps this cache honest, not the read side.
//
// The key is workspace scope, not authenticated user id, because this hook
// only reads `useTenantConfig()`, which resolves a workspace/shop reference
// and never the Supabase auth user (that lives in the sibling
// `OwnerTenantProvider` context, which this hook doesn't consume). So the
// cache cannot tell "the same user remounted" apart from "a different user
// who is also on this workspace scope signed in on this tab." Given that,
// every fetch failure — auth-shaped or not — clears the *entire* map (see
// `onError`), not just the failing scope's entry: a coarser invalidation is
// the only sound choice when the key can't prove identity.
const MAX_CACHED_SCOPES = 8;
const lastHydratedByScope = new Map<string, { snapshot: OwnerSnapshot; telemetry: Record<string, VehicleStatsCurrent> }>();

/**
 * Cache/scope key for a tenant slug. Pure function of `tenantSlug` (via
 * `vehicleWorkspaceScope`), pulled out so the initial-render key and the
 * effect's key can't drift apart, and so it's unit-testable without
 * mounting the hook.
 */
export function computeScopeKey(tenantSlug: string | null | undefined): string {
  const scope = vehicleWorkspaceScope(tenantSlug ?? null);
  return scope ? `${scope.workspaceId}~${scope.shopSlug}` : `demo:${tenantSlug ?? "default"}`;
}

/**
 * Bounded, LRU-ish cache write: moves `key` to the most-recently-used
 * position and evicts the least-recently-used entry once size would exceed
 * `cap`. Pure aside from mutating the supplied map, so it's unit-testable
 * without rendering the hook.
 */
export function setCachedScope<T>(cache: Map<string, T>, key: string, value: T, cap = MAX_CACHED_SCOPES): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > cap) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

function useOwnerDataValue() {
  const { config, tenantSlug, loading: tenantLoading } = useTenantConfig();
  const scopeKey = tenantLoading ? null : computeScopeKey(tenantSlug);
  const cached = scopeKey ? lastHydratedByScope.get(scopeKey) : undefined;

  const [snapshot, setSnapshot] = useState<OwnerSnapshot>(() => cached?.snapshot ?? INITIAL_SNAPSHOT);
  const [dataHydrated, setDataHydrated] = useState(() => Boolean(cached) || !SUPABASE_CONFIGURED);
  const [operationalError, setOperationalError] = useState<string | null>(null);
  const [vehicleTelemetry, setVehicleTelemetry] = useState<Record<string, VehicleStatsCurrent>>(() => cached?.telemetry ?? {});
  const [tripRefresh, setTripRefresh] = useState(0);
  const loadedScopeRef = useRef<string | null>(cached ? scopeKey : null);
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
    const scopeKey = computeScopeKey(tenantSlug);
    const scopeChanged = loadedScopeRef.current !== scopeKey;
    loadedScopeRef.current = scopeKey;
    // Without a live backend, INITIAL_SNAPSHOT is correct for every scope —
    // there's nothing a "new" scope could reveal that the current, already
    // hydrated snapshot doesn't already honestly show — so only force the
    // full-page loading skeleton back on for a scope change when a real
    // fetch could actually return something different.
    if (scopeChanged && SUPABASE_CONFIGURED) {
      setDataHydrated(false);
      setSnapshot(INITIAL_SNAPSHOT);
      setVehicleTelemetry({});
    }
    setOperationalError(null);
    const onSuccess = ({ snap, telemetry }: { snap: OwnerSnapshot; telemetry: Record<string, VehicleStatsCurrent> }) => {
      if (cancelled) return;
      setSnapshot(snap);
      setVehicleTelemetry(telemetry);
      setDataHydrated(true);
      setCachedScope(lastHydratedByScope, scopeKey, { snapshot: snap, telemetry });
    };
    const onError = (error: unknown) => {
      if (cancelled) return;
      setOperationalError(error instanceof Error ? error.message : "Operational data is unavailable.");
      setDataHydrated(true);
      // Fail closed: a manager whose workspace_users membership was just
      // revoked surfaces here as exactly this failure path, and this hook
      // has no authenticated-user id to check the cache against (see the
      // module-scope comment above `lastHydratedByScope`). Never leave the
      // previous, possibly no-longer-authorized snapshot on screen or in the
      // cache — drop both the rendered content and the *entire* cache so a
      // later remount (this scope or any other cached in this tab) can't
      // resurrect it.
      setSnapshot(INITIAL_SNAPSHOT);
      setVehicleTelemetry({});
      lastHydratedByScope.clear();
    };
    if (scope) {
      fetchWorkspaceOperationalSnapshot(scope)
        .then(async (snap) => {
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
        .then(onSuccess, onError);
    } else {
      // No live backend for this scope yet — getOwnerDataSource() is the
      // seam for when one exists, but today it's a single, already-resolved
      // empty snapshot. Chaining an extra .then() to reshape its result before
      // handing it to onSuccess only adds a microtask hop that shows up as an
      // observable loading flash for content that was never going to change,
      // so this path calls onSuccess directly from the one .then() it needs.
      getOwnerDataSource()
        .getSnapshot()
        .then((snap) => onSuccess({ snap, telemetry: {} }), onError);
    }
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
