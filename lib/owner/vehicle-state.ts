"use client";

/**
 * Workspace fleet state.
 *
 * Authenticated workspace tenants use `public.onlyevs_vehicles` as the sole
 * source of truth. Historical localStorage rosters are removed after the
 * remote store is reachable; automatically replaying them would resurrect a
 * fleet that an owner intentionally reset on another device. The no-Supabase
 * demo keeps the original tenant-scoped browser store so local preview works.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";
import {
  fetchWorkspaceVehicles,
  insertWorkspaceVehicle,
  replaceWorkspaceVehicle,
  setWorkspaceVehicleStatus,
  vehicleWorkspaceScope,
  type VehicleWorkspaceScope,
} from "./vehicle-repository";
import type { Vehicle, VehicleInput } from "./types";

/** Historical browser source. Kept only for demo mode and one-time migration. */
export const VEHICLE_KEY = "rtr:vehicles:v1";
export const VEHICLE_MIGRATION_KEY = "rtr:vehicles:migrated:v2";

export interface VehicleState {
  version: 2;
  vehicles: Record<string, Vehicle>;
}

export const initialVehicleState: VehicleState = { version: 2, vehicles: {} };

interface RemoteSnapshot {
  state: VehicleState;
  hydrated: boolean;
  error: string | null;
}

const remoteSnapshots = new Map<string, RemoteSnapshot>();
const remoteListeners = new Map<string, Set<() => void>>();
const remoteLoads = new Map<string, Promise<VehicleState>>();
const browserListeners = new Set<() => void>();

function newGuestSourceId(): string {
  if (typeof window === "undefined") {
    throw new Error("Guest vehicle source IDs can only be created in a browser.");
  }
  if (typeof window.crypto?.randomUUID === "function") return window.crypto.randomUUID();
  const bytes = window.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function stateFromVehicles(vehicles: Vehicle[]): VehicleState {
  return {
    version: 2,
    vehicles: Object.fromEntries(vehicles.map((vehicle) => [vehicle.id, vehicle])),
  };
}

function remoteSnapshot(scope: VehicleWorkspaceScope): RemoteSnapshot {
  return remoteSnapshots.get(scope.key) ?? {
    state: initialVehicleState,
    hydrated: false,
    error: null,
  };
}

function publishRemoteSnapshot(scope: VehicleWorkspaceScope, snapshot: RemoteSnapshot): void {
  remoteSnapshots.set(scope.key, snapshot);
  remoteListeners.get(scope.key)?.forEach((listener) => listener());
}

function subscribeRemote(scope: VehicleWorkspaceScope, listener: () => void): () => void {
  const listeners = remoteListeners.get(scope.key) ?? new Set<() => void>();
  listeners.add(listener);
  remoteListeners.set(scope.key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) remoteListeners.delete(scope.key);
  };
}

const LEGACY_MOCK_SEED_EPOCH = Date.UTC(2026, 0, 1);

function isLegacyMockVehicle(vehicle: Vehicle): boolean {
  const isUntouchedListingSeed = vehicle.id === "veh-01"
    && vehicle.createdAt === LEGACY_MOCK_SEED_EPOCH
    && vehicle.updatedAt === LEGACY_MOCK_SEED_EPOCH
    && vehicle.vin === null
    && !vehicle.teslaImportKey;
  // Old persona imports predate Tesla-import provenance. Current local-dev
  // imports intentionally reuse the persona id, but carry teslaImportedSpec
  // and must survive navigation to the settings step.
  const isMockTeslaPersonaImport = vehicle.teslaImportKey === "v1"
    && !vehicle.teslaImportedSpec;
  return isUntouchedListingSeed || isMockTeslaPersonaImport;
}

export function removeLegacyMockVehicles(state: VehicleState): VehicleState {
  const vehicles = Object.fromEntries(
    Object.entries(state.vehicles).filter(([, vehicle]) => !isLegacyMockVehicle(vehicle)),
  );
  if (Object.keys(vehicles).length === Object.keys(state.vehicles).length) return state;
  return { ...state, vehicles };
}

export function ensureGuestSourceIds(state: VehicleState): VehicleState {
  let changed = false;
  const seen = new Set<string>();
  const vehicles = Object.fromEntries(
    Object.entries(state.vehicles).map(([id, vehicle]) => {
      const sourceId = typeof vehicle.guestSourceId === "string"
        ? vehicle.guestSourceId.trim()
        : "";
      if (sourceId && !seen.has(sourceId)) {
        seen.add(sourceId);
        return [id, vehicle];
      }
      changed = true;
      let guestSourceId = newGuestSourceId();
      while (seen.has(guestSourceId)) guestSourceId = newGuestSourceId();
      seen.add(guestSourceId);
      return [id, { ...vehicle, guestSourceId }];
    }),
  );
  return changed ? { ...state, vehicles } : state;
}

function parseStoredVehicleState(key: string): VehicleState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return initialVehicleState;
    const parsed = JSON.parse(raw) as { vehicles?: Record<string, Vehicle> };
    const loaded: VehicleState = {
      version: 2,
      vehicles: parsed.vehicles && typeof parsed.vehicles === "object" ? parsed.vehicles : {},
    };
    const migrated = ensureGuestSourceIds(removeLegacyMockVehicles(loaded));
    if (migrated !== loaded) window.localStorage.setItem(key, JSON.stringify(migrated));
    return migrated;
  } catch {
    return initialVehicleState;
  }
}

export function loadVehicleState(tenantSlug?: string | null): VehicleState {
  if (typeof window === "undefined") return initialVehicleState;
  return parseStoredVehicleState(migrateLegacyStorage(VEHICLE_KEY, tenantSlug));
}

export function saveVehicleState(state: VehicleState, tenantSlug?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedStorageKey(VEHICLE_KEY, tenantSlug), JSON.stringify(state));
    browserListeners.forEach((listener) => listener());
  } catch {
    // Browser-only demo mode remains usable in-memory when storage is blocked.
  }
}

function browserMigrationComplete(tenantSlug: string): boolean {
  try {
    return window.localStorage.getItem(scopedStorageKey(VEHICLE_MIGRATION_KEY, tenantSlug)) === "1";
  } catch {
    return false;
  }
}

function completeBrowserMigration(tenantSlug: string): void {
  try {
    window.localStorage.removeItem(scopedStorageKey(VEHICLE_KEY, tenantSlug));
    window.localStorage.setItem(scopedStorageKey(VEHICLE_MIGRATION_KEY, tenantSlug), "1");
  } catch {
    // The database already owns the migrated records. A future load safely
    // dedupes again if the browser refuses the marker/removal writes.
  }
}

async function loadRemoteState(
  scope: VehicleWorkspaceScope,
  tenantSlug: string,
  force = false,
): Promise<VehicleState> {
  const existing = remoteSnapshot(scope);
  if (!force && existing.hydrated && !existing.error) return existing.state;
  const inFlight = remoteLoads.get(scope.key);
  if (inFlight) return inFlight;

  const load = (async () => {
    try {
      const remote = await fetchWorkspaceVehicles(scope);
      if (!browserMigrationComplete(tenantSlug)) {
        completeBrowserMigration(tenantSlug);
      }
      const state = stateFromVehicles(remote);
      publishRemoteSnapshot(scope, { state, hydrated: true, error: null });
      return state;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Workspace vehicles could not be loaded.";
      publishRemoteSnapshot(scope, { state: existing.state, hydrated: true, error: message });
      throw error;
    } finally {
      remoteLoads.delete(scope.key);
    }
  })();
  remoteLoads.set(scope.key, load);
  return load;
}

function replaceRemoteVehicleInState(scope: VehicleWorkspaceScope, vehicle: Vehicle): void {
  const current = remoteSnapshot(scope).state;
  publishRemoteSnapshot(scope, {
    state: {
      ...current,
      vehicles: { ...current.vehicles, [vehicle.id]: vehicle },
    },
    hydrated: true,
    error: null,
  });
}

export function nextVehicleId(state: VehicleState): string {
  let n = 1;
  let id = `veh-${String(n).padStart(2, "0")}`;
  while (state.vehicles[id]) {
    n += 1;
    id = `veh-${String(n).padStart(2, "0")}`;
  }
  return id;
}

export function validateVehicleInput(
  input: VehicleInput,
  currentYear: number,
): Partial<Record<keyof VehicleInput, string>> {
  const errors: Partial<Record<keyof VehicleInput, string>> = {};
  if (!input.displayName.trim()) errors.displayName = "Display name is required.";
  if (!input.model.trim()) errors.model = "Model is required.";
  if (!input.trim.trim()) errors.trim = "Trim is required.";
  if (!input.color.trim()) errors.color = "Color is required.";
  if (!Number.isFinite(input.year) || input.year < 2008 || input.year > currentYear + 1) {
    errors.year = `Year must be between 2008 and ${currentYear + 1}.`;
  }
  if (input.returnChargeLevelPct !== null) {
    const pct = input.returnChargeLevelPct;
    if (!Number.isFinite(pct) || pct < 10 || pct > 100) {
      errors.returnChargeLevelPct =
        "Return charge must be between 10% and 100%, or left blank to use the global policy.";
    }
  }
  return errors;
}

/** False only when `id` is the sole active vehicle. */
export function canArchiveVehicle(state: VehicleState, id: string): boolean {
  const target = state.vehicles[id];
  if (!target || target.status !== "active") return true;
  return Object.values(state.vehicles).filter((vehicle) => vehicle.status === "active").length > 1;
}

export function useVehicleState() {
  const { tenantSlug } = useTenantConfig();
  const scope = useMemo(() => vehicleWorkspaceScope(tenantSlug), [tenantSlug]);
  const [state, setState] = useState<VehicleState>(initialVehicleState);
  const [hydrated, setHydrated] = useState(false);
  const [hydratedScope, setHydratedScope] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const scopeKey = scope?.key ?? tenantSlug ?? null;

  useEffect(() => {
    if (!scope || !tenantSlug) {
      const syncBrowser = () => {
        setState(loadVehicleState(tenantSlug));
        setHydrated(true);
        setHydratedScope(scopeKey);
        setError(null);
      };
      syncBrowser();
      browserListeners.add(syncBrowser);
      return () => {
        browserListeners.delete(syncBrowser);
      };
    }

    const syncRemote = () => {
      const snapshot = remoteSnapshot(scope);
      setState(snapshot.state);
      setHydrated(snapshot.hydrated);
      setHydratedScope(scopeKey);
      setError(snapshot.error);
    };
    syncRemote();
    const unsubscribe = subscribeRemote(scope, syncRemote);
    void loadRemoteState(scope, tenantSlug).catch(() => undefined);

    const refreshOnFocus = () => {
      void loadRemoteState(scope, tenantSlug, true).catch(() => undefined);
    };
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [scope, scopeKey, tenantSlug]);

  const refresh = useCallback(async () => {
    if (scope && tenantSlug) {
      await loadRemoteState(scope, tenantSlug, true);
      return;
    }
    setState(loadVehicleState(tenantSlug));
  }, [scope, tenantSlug]);

  const addVehicle = useCallback(async (input: VehicleInput): Promise<string> => {
    if (scope && tenantSlug) {
      await loadRemoteState(scope, tenantSlug);
      const vehicle = await insertWorkspaceVehicle(scope, newGuestSourceId(), input);
      replaceRemoteVehicleInState(scope, vehicle);
      return vehicle.id;
    }
    const fresh = loadVehicleState(tenantSlug);
    const id = nextVehicleId(fresh);
    const now = Date.now();
    const vehicle: Vehicle = {
      ...input,
      id,
      guestSourceId: newGuestSourceId(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    const next = { ...fresh, vehicles: { ...fresh.vehicles, [id]: vehicle } };
    saveVehicleState(next, tenantSlug);
    setState(next);
    return id;
  }, [scope, tenantSlug]);

  const updateVehicle = useCallback(async (id: string, input: VehicleInput): Promise<void> => {
    if (scope && tenantSlug) {
      const fresh = await loadRemoteState(scope, tenantSlug);
      const existing = fresh.vehicles[id];
      if (!existing) throw new Error("This vehicle no longer exists in the workspace fleet.");
      try {
        replaceRemoteVehicleInState(scope, await replaceWorkspaceVehicle(scope, existing, input));
      } catch (mutationError) {
        await loadRemoteState(scope, tenantSlug, true).catch(() => undefined);
        throw mutationError;
      }
      return;
    }
    const fresh = loadVehicleState(tenantSlug);
    const existing = fresh.vehicles[id];
    if (!existing) throw new Error("This vehicle no longer exists.");
    const next: VehicleState = {
      ...fresh,
      vehicles: { ...fresh.vehicles, [id]: { ...existing, ...input, updatedAt: Date.now() } },
    };
    saveVehicleState(next, tenantSlug);
    setState(next);
  }, [scope, tenantSlug]);

  const changeStatus = useCallback(async (id: string, status: Vehicle["status"]): Promise<void> => {
    if (scope && tenantSlug) {
      const fresh = await loadRemoteState(scope, tenantSlug);
      const existing = fresh.vehicles[id];
      if (!existing) throw new Error("This vehicle no longer exists in the workspace fleet.");
      try {
        replaceRemoteVehicleInState(scope, await setWorkspaceVehicleStatus(scope, existing, status));
      } catch (mutationError) {
        await loadRemoteState(scope, tenantSlug, true).catch(() => undefined);
        throw mutationError;
      }
      return;
    }
    const fresh = loadVehicleState(tenantSlug);
    const existing = fresh.vehicles[id];
    if (!existing) throw new Error("This vehicle no longer exists.");
    const next: VehicleState = {
      ...fresh,
      vehicles: {
        ...fresh.vehicles,
        [id]: { ...existing, status, updatedAt: Date.now() },
      },
    };
    saveVehicleState(next, tenantSlug);
    setState(next);
  }, [scope, tenantSlug]);

  const archiveVehicle = useCallback(
    (id: string) => changeStatus(id, "archived"),
    [changeStatus],
  );
  const unarchiveVehicle = useCallback(
    (id: string) => changeStatus(id, "active"),
    [changeStatus],
  );

  const vehicles = Object.values(state.vehicles).sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
  const scopeHydrated = hydrated && hydratedScope === scopeKey;

  return {
    vehicles,
    hydrated: scopeHydrated,
    error: hydratedScope === scopeKey ? error : null,
    persistence: scope ? "workspace" as const : "browser" as const,
    refresh,
    addVehicle,
    updateVehicle,
    archiveVehicle,
    unarchiveVehicle,
  };
}
