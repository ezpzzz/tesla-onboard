/**
 * Possible-duplicate guest detection for the drivers roster/detail pages
 * (Phase 7, "validation calibration rule"): the design's Phase 3 SQL query
 * over `onlyevs_trips` joined to guest bindings, grouped by
 * `verified_email_hash`, is the authoritative signal for whether a driver
 * record is a duplicate — but that query and its `possibleDuplicate` result
 * live server-side (lib/owner/guest-linking.ts's `GuestTripSummaryInput`),
 * and are not yet wired through `useOwnerData()`.
 *
 * Until that wiring exists, this module computes an honest, non-fabricated
 * client-visible proxy: two driver records that share the same non-empty
 * email address really do look like the same guest under exact-match
 * linking (lib/owner/guest-linking.ts links by `email_hash` among other
 * keys). This is a hint, never a completeness claim — the same "review and
 * merge" framing the design specifies, computed from data already on the
 * page instead of invented.
 */

import type { Driver } from "@/lib/owner/types";

export interface DuplicateGuestGroup {
  email: string;
  driverIds: string[];
}

/** Groups drivers by normalized (lowercased, trimmed) email. Only groups of
 * 2+ are duplicate candidates; drivers without an email never group (an
 * empty email is not a shared identity). */
export function findPossibleDuplicateGuestGroups(drivers: Driver[]): DuplicateGuestGroup[] {
  const byEmail = new Map<string, string[]>();
  for (const driver of drivers) {
    const email = driver.email.trim().toLowerCase();
    if (!email) continue;
    const ids = byEmail.get(email) ?? [];
    ids.push(driver.id);
    byEmail.set(email, ids);
  }
  const groups: DuplicateGuestGroup[] = [];
  for (const [email, driverIds] of byEmail) {
    if (driverIds.length >= 2) groups.push({ email, driverIds });
  }
  return groups;
}

/** True when this driver id appears in any possible-duplicate group. */
export function isPossibleDuplicateDriver(driverId: string, groups: DuplicateGuestGroup[]): boolean {
  return groups.some((group) => group.driverIds.includes(driverId));
}

/** The other driver id(s) this driver possibly duplicates, for building a
 * merge-dialog target list. */
export function duplicatePartnerIds(driverId: string, groups: DuplicateGuestGroup[]): string[] {
  const group = groups.find((g) => g.driverIds.includes(driverId));
  if (!group) return [];
  return group.driverIds.filter((id) => id !== driverId);
}
