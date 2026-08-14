"use client";

/**
 * The guest -> owner-dashboard progress bridge.
 *
 * The guest-facing onboarding flow and the host-facing /owner dashboard are two
 * separate apps that only ever meet through localStorage in the SAME browser:
 * the guest's `usePublishProgress` mirrors their onboarding state out to
 * a tenant-scoped `rtr:progress:v1` record on every change, and the owner's
 * `useGuestProgress` reads it
 * back (plus `storage` events for cross-tab updates). There is no server in
 * between — this is a same-device demo bridge, not a real multi-guest sync.
 *
 * `?trip=<id>` is how a host's deep link ("send this guest their onboarding
 * link") associates the guest's browser with a specific trip: the guest captures
 * it into `rtr:trip:v1` once, on first hydrated mount, and every progress write
 * after that tags along with whatever trip id is on file. First write wins, so
 * it's safe even if something else strips the query param later (e.g. the live
 * OAuth callback's URL cleanup in `use-tesla-connect.ts`).
 */

import { useEffect, useRef, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";
import { computeProgress, type ProgressInput, type ProgressSummary } from "./flow";

export const PROGRESS_KEY = "rtr:progress:v1";
export const TRIP_KEY = "rtr:trip:v1";

export type PublishedGuestProgress = ProgressSummary & { tripId: string | null };

export function readPublishedProgress(tenantSlug?: string | null): PublishedGuestProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(migrateLegacyStorage(PROGRESS_KEY, tenantSlug));
    if (!raw) return null;
    return JSON.parse(raw) as PublishedGuestProgress;
  } catch {
    return null;
  }
}

function readTripId(tenantSlug?: string | null): string | null {
  try {
    return window.localStorage.getItem(migrateLegacyStorage(TRIP_KEY, tenantSlug));
  } catch {
    return null;
  }
}

/** Guest-side: publish this browser's onboarding progress for the owner dashboard to read. */
export function usePublishProgress(state: ProgressInput, hydrated: boolean): void {
  const { tenantSlug } = useTenantConfig();
  const capturedTrip = useRef(false);

  useEffect(() => {
    capturedTrip.current = false;
  }, [tenantSlug]);

  // One-time: capture ?trip=<id> from the URL into localStorage, first write wins.
  useEffect(() => {
    if (!hydrated || capturedTrip.current) return;
    capturedTrip.current = true;
    try {
      const trip = new URLSearchParams(window.location.search).get("trip");
      const tripKey = migrateLegacyStorage(TRIP_KEY, tenantSlug);
      if (trip && !window.localStorage.getItem(tripKey)) {
        window.localStorage.setItem(tripKey, trip);
      }
    } catch {
      /* storage unavailable — degrade gracefully, no trip tag on this browser */
    }
  }, [hydrated, tenantSlug]);

  // Publish progress on every relevant state change.
  useEffect(() => {
    if (!hydrated) return;
    try {
      const published: PublishedGuestProgress = {
        ...computeProgress(state),
        tripId: readTripId(tenantSlug),
      };
      window.localStorage.setItem(
        scopedStorageKey(PROGRESS_KEY, tenantSlug),
        JSON.stringify(published),
      );
    } catch {
      /* storage unavailable (private mode / full disk) — degrade gracefully */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, hydrated, tenantSlug]);
}

/** Owner-side: read the guest's published progress, live-updating in this browser. */
export function useGuestProgress(): PublishedGuestProgress | null {
  const { tenantSlug } = useTenantConfig();
  const [snapshot, setSnapshot] = useState<{
    scope: string | null | undefined;
    progress: PublishedGuestProgress | null;
  }>({ scope: undefined, progress: null });

  useEffect(() => {
    const progressKey = scopedStorageKey(PROGRESS_KEY, tenantSlug);
    const tripKey = scopedStorageKey(TRIP_KEY, tenantSlug);
    setSnapshot({ scope: tenantSlug, progress: readPublishedProgress(tenantSlug) });

    function refresh() {
      setSnapshot({ scope: tenantSlug, progress: readPublishedProgress(tenantSlug) });
    }
    function onStorage(e: StorageEvent) {
      if (e.key === progressKey || e.key === tripKey || e.key === null) refresh();
    }
    // "storage" only fires in OTHER tabs, so also re-read on focus/visibility for
    // same-tab navigation back from the guest flow. visibilitychange lives on
    // `document`, not `window`.
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [tenantSlug]);

  return snapshot.scope === tenantSlug ? snapshot.progress : null;
}
