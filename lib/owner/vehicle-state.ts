"use client";

/**
 * Owner-side vehicle fleet state: the host's editable roster of cars this
 * listing has ever used. Mirrors lib/owner/owner-state.ts's load/save/hook
 * pattern exactly (localStorage, spread-merge on load, try/catch around every
 * access), but keyed separately so it never collides with `rtr:owner:v1` or
 * the guest's `rtr:state:v1`.
 *
 * Fresh stores start empty. Vehicles enter the roster only through a real
 * Tesla import or an explicit manual add. The load migration removes the old
 * deterministic listing seed and the former mock-Tesla persona import while
 * preserving every real, imported, or owner-edited vehicle.
 */

import { useCallback, useEffect, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";
import type { Vehicle, VehicleInput } from "./types";

export const VEHICLE_KEY = "rtr:vehicles:v1";

export interface VehicleState {
  version: 1;
  vehicles: Record<string, Vehicle>;
}

export const initialVehicleState: VehicleState = { version: 1, vehicles: {} };

/* Same-tab cross-instance sync: multiple useVehicleState() call sites (owner
 * pages, use-owner-data) each hold their own copy of VehicleState. Without
 * this, a mutation from one instance leaves every other mounted instance
 * stale until it happens to re-render for an unrelated reason (storage
 * events only fire cross-tab, never same-tab). */
const listeners = new Set<() => void>();

function notifyVehicleStateChange(): void {
  listeners.forEach((listener) => listener());
}

const LEGACY_MOCK_SEED_EPOCH = Date.UTC(2026, 0, 1);

function isLegacyMockVehicle(vehicle: Vehicle): boolean {
  // The former listing seed was the only record created with this fixed pair
  // of timestamps. Any owner edit updates `updatedAt`, so edited records stay.
  const isUntouchedListingSeed = vehicle.id === "veh-01"
    && vehicle.createdAt === LEGACY_MOCK_SEED_EPOCH
    && vehicle.updatedAt === LEGACY_MOCK_SEED_EPOCH
    && vehicle.vin === null
    && !vehicle.teslaImportKey;

  // The former Tesla owner persona used the non-numeric synthetic id `v1`.
  // Real Fleet API vehicle ids are not this fixture key, so removing it does
  // not touch a genuine Tesla import even if other presentation fields changed.
  const isMockTeslaPersonaImport = vehicle.teslaImportKey === "v1";

  return isUntouchedListingSeed || isMockTeslaPersonaImport;
}

export function removeLegacyMockVehicles(state: VehicleState): VehicleState {
  const vehicles = Object.fromEntries(
    Object.entries(state.vehicles).filter(([, vehicle]) => !isLegacyMockVehicle(vehicle)),
  );
  if (Object.keys(vehicles).length === Object.keys(state.vehicles).length) return state;
  return { ...state, vehicles };
}

export function loadVehicleState(tenantSlug?: string | null): VehicleState {
  if (typeof window === "undefined") return initialVehicleState;
  try {
    const key = migrateLegacyStorage(VEHICLE_KEY, tenantSlug);
    const raw = window.localStorage.getItem(key);
    if (!raw) return initialVehicleState;
    const parsed = { ...initialVehicleState, ...JSON.parse(raw) } as VehicleState;
    const migrated = removeLegacyMockVehicles(parsed);
    if (migrated !== parsed) {
      window.localStorage.setItem(key, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return initialVehicleState;
  }
}

export function saveVehicleState(state: VehicleState, tenantSlug?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedStorageKey(VEHICLE_KEY, tenantSlug), JSON.stringify(state));
    notifyVehicleStateChange();
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
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
  currentYear: number
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

/** False only when `id` is the sole active vehicle — every other case (not
 * found, already archived, or one of several active vehicles) is archivable. */
export function canArchiveVehicle(state: VehicleState, id: string): boolean {
  const target = state.vehicles[id];
  if (!target || target.status !== "active") return true;
  const activeCount = Object.values(state.vehicles).filter((v) => v.status === "active").length;
  return activeCount > 1;
}

export function useVehicleState() {
  const { tenantSlug } = useTenantConfig();
  const [state, setState] = useState<VehicleState>(initialVehicleState);
  const [hydratedScope, setHydratedScope] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setState(loadVehicleState(tenantSlug));
    setHydratedScope(tenantSlug);
    // Re-read whenever any useVehicleState() instance (this one included)
    // saves — keeps every mounted instance in sync within the same tab.
    const onChange = () => setState(loadVehicleState(tenantSlug));
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, [tenantSlug]);

  const hydrated = hydratedScope !== undefined && hydratedScope === tenantSlug;

  const addVehicle = useCallback((input: VehicleInput): string => {
    // Read fresh from storage rather than the closed-over `state` so two
    // rapid calls (or a call right after mount) never race on a stale id.
    const fresh = loadVehicleState(tenantSlug);
    const id = nextVehicleId(fresh);
    const now = Date.now();
    const vehicle: Vehicle = { ...input, id, status: "active", createdAt: now, updatedAt: now };
    const next: VehicleState = { ...fresh, vehicles: { ...fresh.vehicles, [id]: vehicle } };
    saveVehicleState(next, tenantSlug);
    setState(next);
    return id;
  }, [tenantSlug]);

  const updateVehicle = useCallback((id: string, input: VehicleInput): void => {
    setState((prev) => {
      const existing = prev.vehicles[id];
      if (!existing) return prev;
      const next: VehicleState = {
        ...prev,
        vehicles: {
          ...prev.vehicles,
          [id]: { ...existing, ...input, updatedAt: Date.now() },
        },
      };
      saveVehicleState(next, tenantSlug);
      return next;
    });
  }, [tenantSlug]);

  const archiveVehicle = useCallback((id: string): void => {
    setState((prev) => {
      const existing = prev.vehicles[id];
      if (!existing) return prev;
      const next: VehicleState = {
        ...prev,
        vehicles: {
          ...prev.vehicles,
          [id]: { ...existing, status: "archived", updatedAt: Date.now() },
        },
      };
      saveVehicleState(next, tenantSlug);
      return next;
    });
  }, [tenantSlug]);

  const unarchiveVehicle = useCallback((id: string): void => {
    setState((prev) => {
      const existing = prev.vehicles[id];
      if (!existing) return prev;
      const next: VehicleState = {
        ...prev,
        vehicles: {
          ...prev.vehicles,
          [id]: { ...existing, status: "active", updatedAt: Date.now() },
        },
      };
      saveVehicleState(next, tenantSlug);
      return next;
    });
  }, [tenantSlug]);

  const vehicles = Object.values(state.vehicles).sort((a, b) => a.id.localeCompare(b.id));

  return { vehicles, hydrated, addVehicle, updateVehicle, archiveVehicle, unarchiveVehicle };
}
