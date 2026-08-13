/**
 * Owner data source seam — mock now, live Fleet API later.
 *
 * This module is v1's only implementation: a mock source over the literal
 * fixtures in `mock-data.ts`. It exists as its own file (instead of importing
 * mock-data directly from `use-owner-data.ts`) so a future live adapter has a
 * single place to slot in behind the same `OwnerDataSource` interface.
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
 *   - Whatever replaces `MockOwnerDataSource` should CACHE reads (e.g. next
 *     to the profile cookie pattern in lib/tesla-server.ts) and serve the
 *     dashboard from that cache — never poll Tesla per page view.
 */

import { MOCK_CHARGING_SESSIONS, MOCK_DRIVERS, MOCK_TRIPS } from "./mock-data";
import type { OwnerDataSource, OwnerSnapshot } from "./types";

export class MockOwnerDataSource implements OwnerDataSource {
  async getSnapshot(): Promise<OwnerSnapshot> {
    return {
      drivers: MOCK_DRIVERS,
      trips: MOCK_TRIPS,
      chargingSessions: MOCK_CHARGING_SESSIONS,
    };
  }
}

const mockSource = new MockOwnerDataSource();

/**
 * The active data source. NO env switch in v1, deliberately: an env mode
 * whose only live behavior is throwing "not implemented" is worse than no
 * mode at all. Swap this function's body when a live adapter exists.
 */
export function getOwnerDataSource(): OwnerDataSource {
  return mockSource;
}
