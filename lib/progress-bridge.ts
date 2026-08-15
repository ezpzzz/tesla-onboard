"use client";

/**
 * The guest -> owner-dashboard progress bridge.
 *
 * The guest-facing onboarding flow and the host-facing /owner dashboard are two
 * separate apps. Browser-local storage preserves same-device continuity while
 * private trip links also publish a bounded summary to the matching
 * trip binding so an owner can track progress from another device.
 *
 * `?trip=<id>` is how a host's deep link ("send this guest their onboarding
 * link") associates the guest's browser with a specific trip. A valid token in
 * the URL always becomes the active trip; this prevents a previous booking on
 * the same device from receiving the new guest's progress.
 */

import { useEffect, useRef, useState } from "react";
import { useTenantConfig } from "@/components/TenantConfigProvider";
import { migrateLegacyStorage, scopedStorageKey } from "@/lib/tenant-storage";
import { computeProgress, type ProgressInput, type ProgressSummary } from "./flow";

export const PROGRESS_KEY = "rtr:progress:v1";
export const TRIP_KEY = "rtr:trip:v1";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type PublishedGuestProgress = ProgressSummary & { tripId: string | null };

export function readPublishedProgress(tenantSlug?: string | null): PublishedGuestProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(
      migrateLegacyStorage(PROGRESS_KEY, guestOnboardingStorageScope(tenantSlug)),
    );
    if (!raw) return null;
    return JSON.parse(raw) as PublishedGuestProgress;
  } catch {
    return null;
  }
}

export function readTripToken(tenantSlug?: string | null): string | null {
  try {
    const token = window.localStorage.getItem(migrateLegacyStorage(TRIP_KEY, tenantSlug));
    return token && TOKEN_PATTERN.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** Keep onboarding state separate for every private booking link. */
export function guestOnboardingStorageScope(tenantSlug?: string | null): string | null {
  if (typeof window === "undefined") return tenantSlug ?? null;
  const queryToken = new URLSearchParams(window.location.search).get("trip");
  const token = queryToken && TOKEN_PATTERN.test(queryToken) ? queryToken : readTripToken(tenantSlug);
  return token ? `${tenantSlug ?? "guest"}~trip-${token.slice(-16)}` : tenantSlug ?? null;
}

/** Guest-side: publish this browser's onboarding progress for the owner dashboard to read. */
export function usePublishProgress(state: ProgressInput, hydrated: boolean): void {
  const { tenantSlug } = useTenantConfig();
  const capturedTrip = useRef(false);

  useEffect(() => {
    capturedTrip.current = false;
  }, [tenantSlug]);

  // One-time: capture the current private booking token into localStorage.
  useEffect(() => {
    if (!hydrated || capturedTrip.current) return;
    capturedTrip.current = true;
    try {
      const trip = new URLSearchParams(window.location.search).get("trip");
      const tripKey = migrateLegacyStorage(TRIP_KEY, tenantSlug);
      if (trip && TOKEN_PATTERN.test(trip)) {
        window.localStorage.setItem(tripKey, trip);
      }
    } catch {
      /* storage unavailable — degrade gracefully, no trip tag on this browser */
    }
  }, [hydrated, tenantSlug]);

  // Publish progress on every relevant state change.
  useEffect(() => {
    if (!hydrated) return;
    let published: PublishedGuestProgress | null = null;
    try {
      const tripToken = readTripToken(tenantSlug);
      published = {
        ...computeProgress(state),
        tripId: tripToken,
      };
      window.localStorage.setItem(
        scopedStorageKey(PROGRESS_KEY, guestOnboardingStorageScope(tenantSlug)),
        JSON.stringify(published),
      );
    } catch {
      /* storage unavailable (private mode / full disk) — degrade gracefully */
    }
    const tripToken = readTripToken(tenantSlug);
    if (!published || !tripToken) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void fetch("/api/guest/trips/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tripToken, progress: published }),
        cache: "no-store",
        signal: controller.signal,
      }).catch(() => {
        // Local continuity remains available during a transient network error.
      });
    }, 350);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
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
    const progressKey = scopedStorageKey(PROGRESS_KEY, guestOnboardingStorageScope(tenantSlug));
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
