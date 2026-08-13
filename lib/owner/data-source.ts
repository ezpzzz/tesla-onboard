/**
 * Owner data source seam — intentionally empty until a persistent bookings
 * backend is connected.
 *
 * Production must never manufacture drivers, trips, charging sessions, or
 * vehicles. The local vehicle roster is layered in by `use-owner-data.ts`;
 * this source represents only data that will eventually come from a trusted
 * host backend.
 *
 * Notes for building that live adapter, verified against Tesla Fleet API docs:
 *
 *   - HOST auth is a SEPARATE OAuth grant from the guest flow's, against
 *     auth.tesla.com, requesting `openid offline_access vehicle_device_data`.
 *     Unlike the guest sign-in (lib/tesla-server.ts), which does a single
 *     read-then-discard, this grant needs PERSISTED refresh tokens — the host
 *     dashboard has to poll trip boundaries over the life of a rental, not
 *     just once at sign-in. That's a deliberate departure from the guest
 *     flow's design, not an oversight.
 *   - Poll `vehicle_data` at trip start/end only, not continuously:
 *     `vehicle_state.odometer` (float, miles) and `charge_state.battery_level`
 *     (int, percent). The base URL is region-sharded exactly like the guest
 *     flow's — reuse `resolveRegionBase()`'s approach (a token minted for the
 *     wrong region 412s). Realtime endpoints are rate-limited to 60
 *     requests/min/device, so trip-boundary polling is not just cheaper, it's
 *     required to stay under that ceiling.
 *   - Fleet API is pay-per-use with a $0 default billing cap on a partner
 *     account — a live adapter has to either raise that cap or expect calls
 *     to start failing silently once free-tier volume runs out.
 *   - Charging sessions come from `GET /api/1/dx/charging/history`
 *     (paginated), available to individual (non-fleet) accounts, plus a
 *     per-session invoice PDF endpoint for receipts. The structured
 *     `/api/1/dx/charging/sessions` endpoint (kWh/cost broken out per
 *     session, no PDF parsing needed) is business-fleet-account only — out of
 *     reach for an individual host, so the invoice-PDF path is the real one.
 *   - Whatever replaces `EmptyOwnerDataSource` should CACHE reads (e.g. next
 *     to the profile cookie pattern in lib/tesla-server.ts) and serve the
 *     dashboard from that cache — never poll Tesla per page view.
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
