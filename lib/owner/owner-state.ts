"use client";

/**
 * Owner-side local state: per-trip return checklists. Mirrors lib/store.ts's
 * load/save/hook pattern exactly (localStorage, spread-merge on load, try/catch
 * around every access), but keyed separately so it never collides with the
 * guest's `rtr:state:v1`.
 */

import { useCallback, useEffect, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";

export const OWNER_KEY = "rtr:owner:v1";

export interface TripChecklistState {
  chargedToPolicy: boolean;
  keysReturned: boolean;
  cleaned: boolean;
  noDamage: boolean;
  notes: string;
  updatedAt: number;
}

export interface OwnerState {
  version: 1;
  tripChecklists: Record<string, TripChecklistState>;
}

export function emptyTripChecklist(): TripChecklistState {
  return {
    chargedToPolicy: false,
    keysReturned: false,
    cleaned: false,
    noDamage: false,
    notes: "",
    updatedAt: 0,
  };
}

export const initialOwnerState: OwnerState = {
  version: 1,
  tripChecklists: {},
};

const LEGACY_MOCK_TRIP_IDS = new Set(
  Array.from({ length: 11 }, (_, index) => `trip-${String(index + 1).padStart(2, "0")}`),
);

export function removeLegacyMockTripChecklists(state: OwnerState): OwnerState {
  const tripChecklists = Object.fromEntries(
    Object.entries(state.tripChecklists).filter(([tripId]) => !LEGACY_MOCK_TRIP_IDS.has(tripId)),
  );
  if (Object.keys(tripChecklists).length === Object.keys(state.tripChecklists).length) return state;
  return { ...state, tripChecklists };
}

export function loadOwnerState(tenantSlug?: string | null): OwnerState {
  if (typeof window === "undefined") return initialOwnerState;
  try {
    const key = migrateLegacyStorage(OWNER_KEY, tenantSlug);
    const raw = window.localStorage.getItem(key);
    if (!raw) return initialOwnerState;
    const parsed = { ...initialOwnerState, ...JSON.parse(raw) } as OwnerState;
    const migrated = removeLegacyMockTripChecklists(parsed);
    if (migrated !== parsed) {
      window.localStorage.setItem(key, JSON.stringify(migrated));
    }
    return migrated;
  } catch {
    return initialOwnerState;
  }
}

export function saveOwnerState(state: OwnerState, tenantSlug?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(scopedStorageKey(OWNER_KEY, tenantSlug), JSON.stringify(state));
  } catch {
    /* storage unavailable (private mode / full disk) — degrade gracefully */
  }
}

export function clearOwnerState(tenantSlug?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(scopedStorageKey(OWNER_KEY, tenantSlug));
  } catch {
    /* noop */
  }
}

type Patch = Partial<OwnerState> | ((s: OwnerState) => Partial<OwnerState>);
export type OwnerUpdater = (patch: Patch) => void;

export function useOwnerState() {
  const { tenantSlug } = useTenantConfig();
  const [state, setState] = useState<OwnerState>(initialOwnerState);
  const [hydratedScope, setHydratedScope] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    setState(loadOwnerState(tenantSlug));
    setHydratedScope(tenantSlug);
  }, [tenantSlug]);

  const hydrated = hydratedScope !== undefined && hydratedScope === tenantSlug;

  const update = useCallback<OwnerUpdater>((patch) => {
    setState((prev) => {
      const delta = typeof patch === "function" ? patch(prev) : patch;
      const next = { ...prev, ...delta };
      saveOwnerState(next, tenantSlug);
      return next;
    });
  }, [tenantSlug]);

  const reset = useCallback(() => {
    clearOwnerState(tenantSlug);
    setState(initialOwnerState);
  }, [tenantSlug]);

  return { state, hydrated, update, reset };
}
