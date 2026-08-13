"use client";

/**
 * Owner-side vehicle fleet state: the host's editable roster of cars this
 * listing has ever used. Mirrors lib/owner/owner-state.ts's load/save/hook
 * pattern exactly (localStorage, spread-merge on load, try/catch around every
 * access), but keyed separately so it never collides with `rtr:owner:v1` or
 * the guest's `rtr:state:v1`.
 *
 * Seed-once: the very first load (no key in storage yet) seeds a single
 * "veh-01" from `hostConfig.car` so a fresh install always has at least one
 * vehicle to attach trips to. Every field of that seed is deterministic (no
 * Date.now()) so server-rendered and first-client-paint fixtures elsewhere
 * (see mock-data.ts's MOCK_VEHICLE_SEED) can byte-match it.
 */

import { useCallback, useEffect, useState } from "react";
import type { Vehicle, VehicleInput } from "./types";
import { buildSeedVehicle } from "./vehicle-seed";

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

function seedState(): VehicleState {
  const veh = buildSeedVehicle();
  return { version: 1, vehicles: { [veh.id]: veh } };
}

export function loadVehicleState(): VehicleState {
  if (typeof window === "undefined") return initialVehicleState;
  try {
    const raw = window.localStorage.getItem(VEHICLE_KEY);
    if (!raw) return seedState();
    return { ...initialVehicleState, ...JSON.parse(raw) };
  } catch {
    return initialVehicleState;
  }
}

export function saveVehicleState(state: VehicleState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VEHICLE_KEY, JSON.stringify(state));
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
  const [state, setState] = useState<VehicleState>(initialVehicleState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setState(loadVehicleState());
    setHydrated(true);
    // Re-read whenever any useVehicleState() instance (this one included)
    // saves — keeps every mounted instance in sync within the same tab.
    const onChange = () => setState(loadVehicleState());
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);

  const addVehicle = useCallback((input: VehicleInput): string => {
    // Read fresh from storage rather than the closed-over `state` so two
    // rapid calls (or a call right after mount) never race on a stale id.
    const fresh = loadVehicleState();
    const id = nextVehicleId(fresh);
    const now = Date.now();
    const vehicle: Vehicle = { ...input, id, status: "active", createdAt: now, updatedAt: now };
    const next: VehicleState = { ...fresh, vehicles: { ...fresh.vehicles, [id]: vehicle } };
    saveVehicleState(next);
    setState(next);
    return id;
  }, []);

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
      saveVehicleState(next);
      return next;
    });
  }, []);

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
      saveVehicleState(next);
      return next;
    });
  }, []);

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
      saveVehicleState(next);
      return next;
    });
  }, []);

  const vehicles = Object.values(state.vehicles).sort((a, b) => a.id.localeCompare(b.id));

  return { vehicles, hydrated, addVehicle, updateVehicle, archiveVehicle, unarchiveVehicle };
}
