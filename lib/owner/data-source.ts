/**
 * Owner data source seam — intentionally empty until a persistent bookings
 * backend is connected.
 *
 * Production must never manufacture drivers, trips, charging sessions, or
 * vehicles. The local vehicle roster is layered in by `use-owner-data.ts`;
 * this source represents only data that will eventually come from a trusted
 * host backend. That backend is real streaming telemetry, not REST polling —
 * see the Vehicle Telemetry & Trip Evidence Ledger design and its Phase 0
 * go/no-go doc (`docs/rollouts/2026-08-17-vehicle-telemetry-go-no-go.md`)
 * before touching this seam.
 *
 * Real architecture (supersedes the earlier REST-polling plan this comment
 * used to describe):
 *
 *   - Tesla fleet vehicles (firmware ≥2023.20.6, virtual-key paired) push
 *     signals via mTLS to a self-hosted Fleet Telemetry collector, which
 *     writes onto Kafka (`onlyevs_V` / `onlyevs_connectivity`). There is no
 *     polling loop on this path at all — the vehicle pushes, the collector
 *     receives.
 *   - `services/onlyevs-worker` consumes Kafka (kafkajs) and is the only
 *     writer of derived state: `ingestTelemetry()` upserts
 *     `onlyevs_vehicle_stats_current` (24h freshness guard) and appends to
 *     `onlyevs_vehicle_stats_history` (append-only, ≤7-day-late backfill
 *     accepted, 13-month retention). Location points land in a separate
 *     `private` schema table — trip-gated, envelope-encrypted, 30-day
 *     retention — never in the general stats path.
 *   - The same worker's `runOnce` sweep watches trip windows and the
 *     access-grant issue/revoke lifecycle to write `onlyevs_trip_bookends`
 *     (start/end odometer + battery snapshots) and, at trip completion, an
 *     immutable `onlyevs_trip_evidence_packets` row. Per-trip rollups
 *     (miles vs. allowance, battery delta, charging sessions) are windowed
 *     derivations over `onlyevs_vehicle_stats_history`, computed at read
 *     time — nothing is precomputed or cached into trip rows.
 *   - Charging cost has three honest sources: owner-configured $/kWh for
 *     home/AC sessions, Tesla's `vehicle_charging_cmds`-scoped
 *     charging-history API for DC-fast/Supercharging invoices (synced by a
 *     separate worker job and reconciled to sessions by vehicle + time
 *     overlap), and manual owner entry — never a guessed price.
 *   - Fleet API is still pay-per-use with a $0 default billing cap on a
 *     partner account until a payment method is added; the go/no-go doc is
 *     where that gets verified against Tesla's primary docs before any of
 *     this ships live, alongside proof the collector/Kafka path is actually
 *     receiving signals from a real fleet car.
 *   - Whatever replaces `EmptyOwnerDataSource` reads from the tables above
 *     (already populated by the worker) — it does not call Tesla directly,
 *     and it does not poll anything per page view.
 */

import type { OwnerDataSource, OwnerSnapshot } from "./types";

export const EMPTY_OWNER_SNAPSHOT: OwnerSnapshot = {
  drivers: [],
  trips: [],
  chargingSessions: [],
  vehicles: [],
};

export class EmptyOwnerDataSource implements OwnerDataSource {
  async getSnapshot(): Promise<OwnerSnapshot> {
    return {
      drivers: [],
      trips: [],
      chargingSessions: [],
      vehicles: [],
    };
  }
}

const emptySource = new EmptyOwnerDataSource();

/**
 * The active data source. Swap this function's body when a live bookings and
 * charging adapter exists; until then, honest empty states are safer than
 * placeholder records that look like real customer activity.
 */
export function getOwnerDataSource(): OwnerDataSource {
  return emptySource;
}
