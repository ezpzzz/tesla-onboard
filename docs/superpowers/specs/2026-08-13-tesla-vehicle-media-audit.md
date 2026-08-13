# Tesla owner vehicle import and media audit

**Date:** 2026-08-13
**Scope:** owner-side Tesla connect, imported vehicle specifications, owner/renter vehicle media

## Evidence and decisions

1. Tesla's supported third-party surface is Fleet API. The owner OAuth grant already uses the
   documented `vehicle_device_data` scope; the partner-only `vehicle_specs` scope is not
   available to a third-party owner token.
2. Fleet API's `vehicle_data` endpoint is a live, billable read. Tesla advises against polling
   it. Owner import therefore makes at most one best-effort request for each of the first 10
   vehicles, requests only the `vehicle_config` group, never calls `wake_up`, and discards the
   OAuth token immediately afterward as before.
3. Tesla documents these vehicle configuration fields and their vehicle-data equivalents:
   `CarType` (`vehicle_config.car_type`), `Trim` (`trim_badging`), `ExteriorColor`
   (`exterior_color`) and `WheelType` (`wheel_type`). Failed, sleeping, or timed-out cars still
   import from the account vehicle list and remain editable by the owner.
   Interior configuration is less consistent: some generations return a descriptive interior
   field or a Design Studio `option_codes` value, while others omit it or return only a numeric
   seat-hardware package. The importer consumes an explicit name/code when present, never treats
   a numeric seat package as a color, and exposes an editable interior field for the omitted case.
4. Fleet API exposes no documented vehicle-image endpoint. Media is therefore sourced from
   Tesla's public website—not from an unsupported vehicle command or legacy owner API.
5. Tesla's current public Design Studio uses a first-party compositor whose option lexicon maps
   trim, paint, wheels and interior to a rendered car. The app uses that surface only for
   model/year/configuration tuples verified against Tesla's own lexicon. Current Model 3,
   pre-refresh/current Model Y, and Cybertruck mappings are supported. Unknown or incompatible
   values fail closed to neutral artwork instead of displaying a different configuration.
6. Tesla's service manuals retain the paint and wheel taxonomy for legacy Model S/X and earlier
   colors (for example Obsidian Black, Signature Red and Titanium Silver). The normalizer covers
   Tesla's compact current and legacy car-type, trim-badge, paint and wheel identifiers, and
   preserves unknown future identifiers as readable labels instead of dropping them. Those specs
   are displayed, but the app does not substitute a current-model marketing photo for a legacy
   vehicle. An exact legacy image remains unavailable unless Tesla exposes a matching public
   compositor generation.

Primary sources:

- <https://developer.tesla.com/docs/fleet-api/authentication/overview>
- <https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints>
- <https://developer.tesla.com/docs/fleet-api/fleet-telemetry/available-data>
- <https://developer.tesla.com/docs/fleet-api/billing-and-limits>
- <https://developer.tesla.com/docs/fleet-api/announcements>
- <https://www.tesla.com/>
- <https://www.tesla.com/model3/design>
- <https://www.tesla.com/modely/design>
- <https://www.tesla.com/cybertruck/design>
- <https://service.tesla.com/docs/ModelS/ServiceManual/Palladium/en-us/GUID-769C9625-76EE-467B-B756-C9032AC2B99A.html>

## Data flow

```text
Tesla owner OAuth
  -> /api/1/products (vehicle identity + VIN)
  -> /vehicle_data?endpoints=vehicle_config (one optional read, no wake)
  -> normalized TeslaVehicle (model/year/trim/exterior/interior/wheels + exact option codes)
  -> local owner Vehicle record with Tesla import provenance
  -> shared VehicleArtwork component derives matched Tesla configurator media
       - owner overview
       - owner vehicle list/detail
       - owner import review
       - renter welcome card (host-configured rental vehicle)
```

## Important architecture boundary

Owner fleet records currently live in browser `localStorage`, while the renter walkthrough
continues to read the listing's server-bundled `hostConfig.car`. This implementation improves
both surfaces and keeps them visually consistent, but it does not pretend that a browser-local
owner import can publish a vehicle to another renter's device. Exact per-trip owner-to-renter
vehicle assignment requires a persistent backend mapping (`listing/trip -> vehicle`) and is a
separate data-platform change.

## Operational guardrails

- No vehicle wake and no polling.
- Owner-only configuration reads; guest Tesla sign-in remains the cheaper list-only flow.
- At most ten configuration reads per owner connect to bound callback latency and billable use.
- Missing configuration never blocks the vehicle list import.
- Exact media is emitted only when model generation, trim, paint, wheels and interior all map to
  a compatible Tesla option set. Missing interior data never silently substitutes a black cabin;
  owners can fill the optional interior field and re-resolve the exact first-party image.
- Tesla OAuth tokens remain server-only and are discarded after the one-shot import.
- The normalized profile is compressed before authenticated encryption so the short-lived
  httpOnly cookie stays below the browser cookie limit; oversize profiles fail explicitly and
  are never silently truncated.
