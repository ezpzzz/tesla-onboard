# Owner Dashboard — Design Spec

Status: Draft for implementation
Date: 2026-08-12
Branch: `owner-dashboard`

## 1. Context & goals

The app today (`app/`, `components/`, `lib/`) is entirely guest-facing: a single adaptive
walkthrough that takes one Turo guest from "never touched a Tesla" to "keys in hand." There is
no view for the host. A host who wants to know "is my next guest ready?", "did anyone return
below the charge policy?", or "how much did Supercharging cost me this month?" has no way to
find out inside the app — they'd have to ask the guest directly or check Tesla's own app.

This spec defines an **owner dashboard** at `/owner`: a read-mostly, attention-first portal that
surfaces (a) which drivers need help before their trip, (b) trip and fleet economics (miles,
energy cost, charging behavior), and (c) a lightweight return checklist the host can tick off
per trip. It is a new, additive surface. It does not change guest-facing behavior, guest state
shape, or the existing onboarding flow in any way a guest would notice.

Goals for v1:

- Give a host a single page (`/owner`) that answers "what needs my attention right now?" in
  under five seconds, ranked by urgency.
- Let a host inspect any driver's onboarding progress and any trip's mileage/energy/return
  status without leaving the app.
- Prove out the guest → owner data bridge (`rtr:progress:v1`, `rtr:trip:v1`) using the *real*
  browser-local guest, merged live into an otherwise-mocked fleet, so the demo is not purely
  synthetic.
- Establish the seams (`OwnerDataSource`, host OAuth, server persistence) that a v2 backed by
  live Tesla Fleet API data and multiple real cars will need, without building any of that yet.

Non-goals for v1: real authentication, a real backend, multi-car support, live Tesla data,
billing, or write access back into the guest's own onboarding state. See §12 (Out of scope).

## 2. Decisions & rationale

Each decision below names the alternative considered and rejected.

**(1) The guest state schema `rtr:state:v1` is untouched; trip linking and progress
publishing use two new, separate localStorage keys (`rtr:trip:v1`, `rtr:progress:v1`).**
*Rejected alternative:* extend `OnboardingState` (`lib/store.ts`) with owner-relevant fields
(e.g. `tripId`) directly. Rejected because `OnboardingState` is guest-owned, versioned, and
already load-bearing for resume-mid-flow behavior; widening it for a feature the guest never
interacts with increases the blast radius of every future guest-flow change and couples two
otherwise-independent features through one migration path. A derived, append-only publish
channel keeps the guest flow provably unaffected — you can delete `lib/progress-bridge.ts`
entirely and the guest app still works byte-for-byte the same.

**(2) `computeProgress()` lives in `lib/flow.ts` and takes a structural `ProgressInput`, not an
import of `OnboardingState`.** *Rejected alternative:* import `OnboardingState` from
`lib/store.ts` into `lib/flow.ts` and type `computeProgress(state: OnboardingState)` directly.
Rejected because `lib/store.ts` already imports `PathMode` from `lib/flow.ts` — importing
`OnboardingState` back into `lib/flow.ts` would create a module cycle. `ProgressInput` is a
structural subset (duck-typed) of `OnboardingState`'s relevant fields, so `lib/store.ts` code
can pass its own state object to `computeProgress` with zero adapter code, and `lib/flow.ts`
stays a leaf module with no dependency on `lib/store.ts`.

**(3) Mock data is hardcoded literal fixtures with absolute epoch-millisecond timestamps; no
`Math.random()`, no `Date.now()`, and no relative-time math anywhere at module scope in
`lib/owner/mock-data.ts`.** *Rejected alternative:* generate mock trips/drivers/sessions
programmatically (e.g. "6 completed trips over the last 60 days" computed from `Date.now()`).
Rejected because Next.js renders `/owner` on the server first, then hydrates on the client;
anything derived from `Date.now()` or `Math.random()` at module scope will produce different
output on server and client, triggering React hydration mismatches. Literal fixtures anchored
to a fixed mid-August-2026 era guarantee the server-rendered HTML and the first client paint are
byte-identical. (Runtime *reads* of `Date.now()` inside client-only hooks — e.g. `now` passed
into `driverStatus`/`deriveAlerts` at render time in a `"use client"` component — are fine
because they never run during SSR.)

**(4) `OwnerDataSource` is defined as an interface now, with only a mock implementation; there
is no env-based mode switch until a live adapter actually exists.** *Rejected alternative: ship
an `NEXT_PUBLIC_OWNER_DATA_MODE` env switch now (mirroring `AUTH_MODE`), with a `live` branch
that throws `"not implemented"`.* Rejected because a switch whose only non-mock behavior is
throwing gives a false sense of readiness and is dead code a future implementer has to delete
anyway to write the real thing; it also invites someone to flip it in production by accident.
`getOwnerDataSource()` returning the mock unconditionally is honest about what v1 is, and the
interface boundary itself is the seam a live implementation attaches to later.

**(5) Two additive design tokens (`--color-warn`, `--color-danger`) and two new `Badge` tones,
rather than reusing existing tones or inventing an ad-hoc inline-color scheme.** *Rejected
alternative A:* reuse whatever "danger-ish" tone already exists. Rejected because
`app/globals.css`'s token block has no severity-scale colors at all — the guest app never needed
to say "this is bad, act now." *Rejected alternative B:* hardcode hex colors inline in owner
components. Rejected because it breaks the project's existing convention of centralizing color
in `app/globals.css`'s `@theme` block and would fragment if a second owner component needed the
same color. Two new tokens, added the same way every existing token was added, is the smallest
change consistent with current conventions.

**(6) The real browser-local guest always has the fixed id `"guest-local"`; claiming the
`?trip=` demo link never overwrites an already-assigned mock trip's `driverId`.**
*Rejected alternative:* mint a random/UUID id per browser session for the local guest.
Rejected because a stable id lets every owner-side view (alerts, roster, trip detail) refer to
"this browser's guest" deterministically without a lookup table, and lets `useOwnerData` do a
simple upsert-by-id instead of tracking session identity. The "never clobber an assigned trip"
rule exists because `trip-11` is the only trip seeded `driverId: null`; if a second browser (or a
replayed link) tries to claim an already-assigned trip, silently stealing that assignment would
make the dashboard lie about who is driving which car — so the claim is a one-way, one-time,
first-writer-wins operation, consistent with the "first write wins" rule already used for
`TRIP_KEY` itself.

**(7) Owner-side ticks (return checklist) live in their own versioned localStorage record,
`rtr:owner:v1`, keyed by trip id — not attached to the trip fixture data itself.**
*Rejected alternative:* let the host edit the mock `Trip`/`ChargingSession` objects in place.
Rejected because `lib/owner/mock-data.ts` is meant to be swappable for a live `OwnerDataSource`
without any component changing; if components mutated trip fixtures directly, "owner input"
and "fetched fleet data" would be inseparable, which breaks the moment `getSnapshot()` starts
returning live, non-mutable data. A separate, versioned, host-only state record — mirroring
`lib/store.ts`'s own `version`-free pattern but explicitly versioned per the type contract —
keeps host annotations independent of data source, and `chargedToPolicy` overriding the
`return-below-policy` alert is a read-time join, not a data mutation.

**(8) No owner authentication in v1; `/owner` is reachable by anyone who knows the URL, gated
only by a loud code comment and this spec's v2 seam note.** *Rejected alternative:* stub in a
fake "host password" prompt or a hardcoded allow-list. Rejected because a fake auth screen is
worse than no auth screen — it visually promises security the app does not provide, which is
more misleading than an undecorated page. The comment in `OwnerShell.tsx` and the v2 seam in
§11 make the gap explicit and point at the real fix (middleware + host session cookie,
structurally parallel to the `rtr_tesla` cookie pattern already used for live guest auth in
`lib/tesla-server.ts`) so it isn't silently forgotten.

## 3. Architecture overview: guest bridge → owner domain → UI

Three layers, each depending only on the layer below it:

```
Guest app (unchanged)                Owner domain (new, pure)              Owner UI (new, client)
──────────────────────               ────────────────────────              ───────────────────────
OnboardingApp / useOnboarding    →    lib/progress-bridge.ts           →    app/owner/**/page.tsx
  (rtr:state:v1, unchanged)             usePublishProgress() writes:        components/owner/*
                                          rtr:progress:v1 (derived)           OwnerShell, owner-ui,
lib/flow.ts                              rtr:trip:v1 (claim)                 charts
  + computeProgress()              →                                   ↑
  + ProgressInput/ProgressSummary       useGuestProgress() reads them   |
                                         back on the owner side          |
                                                                          |
                                       lib/owner/mock-data.ts  ────────→ lib/owner/use-owner-data.ts
                                       lib/owner/data-source.ts          (merges mock snapshot +
                                         (OwnerDataSource, mock impl)     guest-local driver/trip)
                                                                          |
                                       lib/owner/derive.ts    ─────────→ (pure: status, miles,
                                       lib/owner/alerts.ts                energy, alerts, fleet stats)
                                       lib/owner/owner-state.ts          (host's own ticks,
                                                                           rtr:owner:v1)
```

Data flow, end to end:

1. A guest works through onboarding as today. `OnboardingApp` continues to own `OnboardingState`
   via `useOnboarding()`, unchanged.
2. A new hook, `usePublishProgress`, runs alongside `useOnboarding` inside `OnboardingApp` (the
   only edit to that file). On every state change, once hydrated, it computes a `ProgressSummary`
   via `computeProgress()` (pure, from `lib/flow.ts`) and writes `{ ...summary, tripId }` as JSON
   to `localStorage["rtr:progress:v1"]`. It also does a one-time read of `?trip=<id>` from the
   URL and — first-write-wins — records it to `localStorage["rtr:trip:v1"]`. This is the entire
   guest-side footprint of this feature.
3. On the owner side, `useGuestProgress()` reads `rtr:progress:v1`/`rtr:trip:v1` back out,
   staying in sync via the `storage` event (cross-tab) plus `visibilitychange`/`focus`
   (same-tab, since `storage` never fires in the writing tab).
4. `lib/owner/mock-data.ts` supplies the entire fleet as literal fixtures. `getOwnerDataSource()`
   (`lib/owner/data-source.ts`) wraps them in the `OwnerDataSource` interface so a future live
   adapter is a drop-in replacement.
5. `useOwnerData()` (`lib/owner/use-owner-data.ts`) is the single hook every `/owner` page reads.
   It renders the mock snapshot identically during SSR and first client paint, then — post-mount
   only — layers the real local guest in as a `Driver` with `id: "guest-local"`, and, if a valid
   `?trip=` claim exists and targets an unassigned or already-guest-local trip, sets that trip's
   `driverId` to `"guest-local"`.
6. Pure derivation (`lib/owner/derive.ts`, `lib/owner/alerts.ts`) turns the merged snapshot plus
   the host's own `OwnerState` (`rtr:owner:v1`, ticked via `ReturnChecklistCard`) into the
   `DriverStatus`es, `FleetStats`, and `OwnerAlert[]` the UI renders.
7. UI components (`components/owner/*`, `app/owner/**`) are pure presentation over this derived
   data — no component computes business logic itself; everything routes through `derive.ts` /
   `alerts.ts` / `computeProgress`.

## 4. Type contracts (verbatim)

The following type/function signatures are normative and must be implemented exactly as written
— field names and types are load-bearing across parallel implementation work.

```ts
// ---- lib/flow.ts additions (pure; note: do NOT import from lib/store.ts — store.ts already imports PathMode from flow.ts; use this structural input type instead) ----
export interface ProgressInput {
  profile: TeslaProfile | null;          // type from "./tesla"
  experience: ExperienceLevel | null;    // type from "./tesla"
  pathMode: PathMode | null;
  stepId: string;
  completed: string[];
  checklist: Record<string, boolean>;
  startedAt: number | null;
  newToTesla: boolean;
}
export interface ProgressSummary {
  stepId: string;
  pct: number;                 // 0-100, SAME formula as OnboardingApp's existing bar: idx/(flow.length-1)*100 (0 when flow.length <= 1), where idx = indexOfStep(buildFlow(pathMode, {newToTesla}), stepId)
  isDone: boolean;             // idx === flow.length - 1
  completed: string[];
  checklist: Record<string, boolean>;
  moduleTotal: number;         // modulesForPath(pathMode).length; 0 if pathMode is null
  checklistDone: number;       // count of true values among CHECKLIST item ids
  checklistTotal: number;      // CHECKLIST.length
  requiredChecklistDone: number;
  requiredChecklistTotal: number;
  experience: ExperienceLevel | null;
  pathMode: PathMode | null;
  startedAt: number | null;
  guestName: string | null;    // input.profile?.fullName || null (empty string -> null)
  updatedAt: number;           // Date.now() at compute time
}
export function computeProgress(input: ProgressInput): ProgressSummary

// ---- lib/progress-bridge.ts (NEW, the guest->dashboard contract; plain module, hooks inside are fine because every consumer is a client component) ----
export const PROGRESS_KEY = "rtr:progress:v1";
export const TRIP_KEY = "rtr:trip:v1";
export type PublishedGuestProgress = ProgressSummary & { tripId: string | null };
export function readPublishedProgress(): PublishedGuestProgress | null   // localStorage read + JSON.parse in try/catch, null on any failure or during SSR (typeof window check)
export function usePublishProgress(state: ProgressInput, hydrated: boolean): void
//   guest-side hook: (1) one-time effect after hydrated: read new URLSearchParams(window.location.search).get("trip"); if non-empty, write it to localStorage[TRIP_KEY] (first write wins — do not overwrite an existing value). (2) effect on [state, hydrated]: when hydrated, write JSON of { ...computeProgress(state), tripId: localStorage[TRIP_KEY] ?? null } to localStorage[PROGRESS_KEY]. All localStorage access in try/catch (mirror lib/store.ts saveState).
export function useGuestProgress(): PublishedGuestProgress | null
//   owner-side hook: useState(null); on mount read via readPublishedProgress(); subscribe to window "storage" (re-read when e.key is PROGRESS_KEY, TRIP_KEY, or null), plus "visibilitychange"/"focus" re-reads (storage events never fire in the writing tab). Clean up listeners.

// ---- lib/owner/types.ts (NEW) ----
import type { ExperienceLevel } from "@/lib/tesla";
import type { ProgressSummary } from "@/lib/flow";
export type TripStatus = "upcoming" | "active" | "completed";
export type DriverStatus = "not-started" | "in-progress" | "ready" | "stalled";
export interface Driver {
  id: string;                  // mock rows "drv-01".."drv-08"; the real browser-local guest is ALWAYS "guest-local"
  name: string;
  email: string;
  source: "mock" | "guest-local";
  progress: ProgressSummary | null;   // null = never opened onboarding
}
export interface ChargingSession {
  id: string;                  // "chg-01"..
  tripId: string;
  startedAt: number;
  endedAt: number;
  location: string;            // e.g. "Supercharger - Gilroy, CA" or "Home charging (garage)"
  isSupercharger: boolean;
  kWhAdded: number;
  costUsd: number;
}
export interface Trip {
  id: string;                  // "trip-01".."trip-11"
  driverId: string | null;     // null = unassigned; trip-11 MUST be seeded unassigned + upcoming (reserved for the ?trip= demo link)
  status: TripStatus;
  startAt: number;
  endAt: number;               // absolute epoch ms literals in mock data
  odometerStartMi: number | null;   // float, mirrors Fleet API vehicle_state.odometer; null for upcoming
  odometerEndMi: number | null;     // null until completed
  batteryStartPct: number | null;   // int, mirrors charge_state.battery_level
  batteryEndPct: number | null;     // null until completed
  chargingSessionIds: string[];
}
export interface FleetStats {
  totalMilesRented: number;
  totalEnergyCostUsd: number;
  totalSuperchargingCostUsd: number;
  avgReturnChargePct: number | null;
  tripsBelowPolicy: number;
  tripCounts: Record<TripStatus, number>;
}
export type AlertKind = "guest-not-started" | "guest-stalled" | "required-checklist-open" | "return-below-policy" | "supercharging-unrecovered";
export interface OwnerAlert {
  id: string;
  kind: AlertKind;
  severity: "warn" | "danger";
  message: string;             // human sentence naming the driver/trip
  href: string;                // deep link, e.g. "/owner/drivers/drv-03" or "/owner/trips/trip-05"
  driverId?: string;
  tripId?: string;
}
export interface OwnerSnapshot { drivers: Driver[]; trips: Trip[]; chargingSessions: ChargingSession[]; }
export interface OwnerDataSource { getSnapshot(): Promise<OwnerSnapshot>; }

// ---- lib/owner/owner-state.ts (NEW) ----
export const OWNER_KEY = "rtr:owner:v1";
export interface TripChecklistState { chargedToPolicy: boolean; keysReturned: boolean; cleaned: boolean; noDamage: boolean; notes: string; updatedAt: number; }
export interface OwnerState { version: 1; tripChecklists: Record<string, TripChecklistState>; }
// initialOwnerState, loadOwnerState/saveOwnerState (spread-merge + try/catch exactly like lib/store.ts), useOwnerState(): { state, hydrated, update, reset } mirroring useOnboarding()'s shape. Export emptyTripChecklist(): TripChecklistState helper.

// ---- lib/owner/derive.ts (NEW, pure functions only) ----
export const STALL_THRESHOLD_MS = 24 * 60 * 60 * 1000;
export function driverStatus(driver: Driver, now: number): DriverStatus
//   null progress or pct === 0 and no completed modules -> "not-started"; progress.isDone -> "ready"; otherwise "stalled" if now - progress.updatedAt > STALL_THRESHOLD_MS else "in-progress"
export function tripMiles(trip: Trip): number | null                      // end - start odometer, null unless both present
export function sessionsForTrip(sessions: ChargingSession[], tripId: string): ChargingSession[]
export function tripEnergy(sessions: ChargingSession[]): { kWh: number; costUsd: number; superchargerCostUsd: number }
export function parseReturnPolicyPct(text: string): number               // first integer found in hostConfig.rental.returnChargeLevel; fallback 80
export function fleetStats(snapshot: OwnerSnapshot, policyPct: number): FleetStats
export function ownerChecklistScore(state: OwnerState, tripId: string): { done: number; total: number }  // total 4 (notes excluded)
export function formatMiles(n: number): string; export function formatUsd(n: number): string; export function formatPct(n: number): string

// ---- lib/owner/alerts.ts (NEW, pure) ----
export function deriveAlerts(args: { drivers: Driver[]; trips: Trip[]; chargingSessions: ChargingSession[]; ownerState: OwnerState; policyPct: number; now: number }): OwnerAlert[]
// Rules (in this priority order):
//  guest-not-started (danger): driver has an upcoming trip starting within 48h and progress is null/pct 0
//  required-checklist-open (danger): driver has an upcoming trip starting within 24h and any CHECKLIST item with required:true is not checked in progress.checklist
//  guest-stalled (warn): driverStatus === "stalled" and driver has an upcoming or active trip
//  return-below-policy (warn): completed trip with batteryEndPct !== null and batteryEndPct < policyPct, UNLESS ownerState.tripChecklists[trip.id]?.chargedToPolicy is true (owner resolved it)
//  supercharging-unrecovered (warn): completed trip that ended within the last 14 days with superchargerCostUsd > 0
// Sort: danger first, then warn, then by most-recent relevance. Message text must name the driver (or trip id) and the concrete gap.

// ---- lib/owner/data-source.ts (NEW) ----
// MockOwnerDataSource implementing OwnerDataSource over the literal fixtures in lib/owner/mock-data.ts (resolves immediately).
// getOwnerDataSource(): OwnerDataSource — returns the mock. NO env switch in v1 (deliberate: an env mode whose only live behavior is throwing is worse than none).
// File MUST open with a header comment (style of lib/tesla-server.ts) documenting the live-adapter seam: separate HOST OAuth grant (auth.tesla.com; scopes openid offline_access vehicle_device_data) with PERSISTED refresh tokens (a deliberate departure from the guest flow's single-read-discard-tokens design); vehicle_data polls at trip start/end only (vehicle_state.odometer float mi, charge_state.battery_level int; region-sharded base URL, HTTP 412 on wrong region — reuse resolveRegionBase()'s approach; rate limit 60 realtime req/min/device; Fleet API is pay-per-use with a $0 default billing cap); charging sessions via GET /api/1/dx/charging/history (paginated, available to individual accounts) + per-session invoice PDFs (structured /dx/charging/sessions is business-fleet-only); cache reads, never poll per page view.

// ---- lib/owner/mock-data.ts (NEW) ----
// HARDCODED LITERAL fixtures — no Math.random(), no Date.now(), no relative-time math at module scope (SSR/client output must be byte-identical).
// Anchor era: mid-August 2026. 8 mock drivers (varied realistic names/emails; statuses spread across not-started/in-progress/ready/stalled via their progress fields; mock progress objects must use REAL module ids from lib/content.ts MODULES and REAL checklist ids from CHECKLIST — Read lib/content.ts first and use the actual ids).
// 11 trips: 6 completed (spread over June-Aug 2026, realistic odometer floats e.g. 18432.6 -> 18711.2, battery 90->52 etc., at least 2 returned BELOW an 80% policy, at least 3 with supercharger sessions), 1 active (started ~Aug 10 2026, odometerEndMi/batteryEndPct null), 4 upcoming (2 within 48h of ~Aug 12 2026 for alert demos; trip-11 unassigned driverId: null).
// ~16-20 charging sessions total: superchargers (realistic CA names: Gilroy, Kettleman City, Santa Nella, San Mateo; $0.36-0.52/kWh) and home/public L2 (~$0.14-0.20/kWh). Sum fields must be internally consistent with trips (session timestamps inside their trip's window).

// ---- lib/owner/use-owner-data.ts (NEW) ----
export function useOwnerData(): { drivers: Driver[]; trips: Trip[]; chargingSessions: ChargingSession[]; stats: FleetStats; policyPct: number; hydrated: boolean }
// Renders mock snapshot identically on server + first client paint (no localStorage before mount). After mount, layers in the guest-local driver from useGuestProgress(): upsert Driver { id: "guest-local", name: progress.guestName ?? "Guest (this browser)", email: "", source: "guest-local", progress }. If published tripId matches a known trip AND (trip.driverId === null || trip.driverId === "guest-local"), set that trip.driverId = "guest-local" (never clobber an assigned mock trip). stats recomputed via fleetStats on the merged snapshot.

// ---- shared primitive extensions (additive only) ----
// app/globals.css: add --color-warn: #b45309; --color-danger: #c0362c; in the existing @theme token block (light-only, matches existing token naming).
// components/ui.tsx: Badge tone union gains "warn" | "danger" with soft badge styling consistent with existing tones (e.g. amber/red tinted bg + readable text). Existing tones untouched.
// components/icons.tsx: append IconAlert, IconUser, IconCar, IconBattery, IconClock, IconChevronRight following the exact existing base() 24x24 stroke conventions.

// ---- components/owner/OwnerShell.tsx (NEW, client component) ----
// Desktop-first responsive shell for all /owner pages: md+ layout = left sidebar (w-56, bg-card, border-r border-line) with nav links Overview /owner, Drivers /owner/drivers, Trips /owner/trips (active state via usePathname(); a link is active when pathname === href or, for non-root hrefs, pathname starts with href + "/") + main column (mx-auto max-w-[1100px] px-4 md:px-8 py-6). Below md: sticky bottom tab bar (fixed bottom-0, bg-card/95 backdrop-blur, border-t border-line, 3 tabs w/ icon+label), main gets pb-20 md:pb-0. Top bar: hostConfig.companyName + a neutral Badge "Host view" + a subtle link back to the guest app ("Guest walkthrough" -> "/"). Include a LOUD code comment: /owner has NO auth in v1 (mock-first demo); live deployments need a gate (e.g. middleware with a host session cookie, parallel to rtr_tesla in lib/tesla-server.ts).

// ---- components/owner/owner-ui.tsx (NEW) ----
// StatTile { label, value, sub? }; StatusPill { status: DriverStatus } (ready->good, in-progress->brand, not-started->neutral, stalled->warn); TripStatusBadge { status: TripStatus } (completed->good, active->brand, upcoming->neutral); AlertsPanel { alerts: OwnerAlert[] } (severity-colored left border or dot, message, IconChevronRight link via next/link; renders EmptyState "All clear — nothing needs you right now." when empty); EmptyState { title, detail?, children? }; DriverTable { drivers, trips, now } (semantic table on md+, stacked Cards below md, both from one row-model: name w/ "This browser's guest" Badge for source guest-local, StatusPill, experience, ProgressBar pct, modules x/y, required checklist x/y, linked trip chip; row -> /owner/drivers/[id]); TripRow/TripTable { trips, drivers, chargingSessions, ownerState, policyPct } (dates, driver, TripStatusBadge, miles, energy cost, battery-at-return vs policy chip, checklist score); ChargingSessionList { sessions } (time, location, kWh, cost, IconBolt Badge for superchargers); ReturnChecklistCard { tripId } (uses useOwnerState() internally; 4 large tap-target toggle rows: Charged to policy / Keys returned / Cleaned / No damage, plus a notes textarea; one-handed phone-friendly).

// ---- components/owner/charts.tsx (NEW, inline SVG only) ----
// MiniBarChart { data: { label: string; value: number }[]; formatValue?: (n: number) => string; ariaLabel: string } — proportional rects, brand-token fill, muted axis labels, role="img".
// BatteryReturnGauge { startPct, endPct, policyPct, ariaLabel } — horizontal track with start marker, end fill, policy threshold tick; end < policy renders the delta in danger tone.
// TripTimeline { trip, sessions, ariaLabel } — horizontal time axis from startAt to endAt: pickup marker, one bolt marker per charging session positioned by time, return marker; labels below; degrade gracefully for active trips (no return marker).
// All charts: currentColor/design tokens only, readable at 320px width, aria-label + role="img", no animation.
```

## 5. File plan

| File | New/Edited | Purpose |
|---|---|---|
| `lib/flow.ts` | Edited | Add `ProgressInput`, `ProgressSummary`, `computeProgress()`. Pure addition; existing exports (`buildFlow`, `modulesForPath`, `indexOfStep`, `PathMode`, `Step`) unchanged. |
| `lib/progress-bridge.ts` | New | The guest→owner localStorage bridge: `PROGRESS_KEY`, `TRIP_KEY`, `readPublishedProgress`, `usePublishProgress`, `useGuestProgress`. |
| `components/OnboardingApp.tsx` | Edited | Call `usePublishProgress(progressInput, hydrated)` alongside the existing `useOnboarding()` call, where `progressInput` is assembled from the current `OnboardingState`. This is the *only* edit to guest-facing code; no rendering, routing, or `OnboardingState` shape change. |
| `lib/owner/types.ts` | New | All owner domain types (§4), shared by every owner module and component. |
| `lib/owner/owner-state.ts` | New | Host-only local state: `OWNER_KEY`, `OwnerState`, `TripChecklistState`, `loadOwnerState`/`saveOwnerState`, `useOwnerState()`, `emptyTripChecklist()`. |
| `lib/owner/derive.ts` | New | Pure derivation: `driverStatus`, `tripMiles`, `sessionsForTrip`, `tripEnergy`, `parseReturnPolicyPct`, `fleetStats`, `ownerChecklistScore`, `formatMiles`/`formatUsd`/`formatPct`. |
| `lib/owner/alerts.ts` | New | Pure `deriveAlerts()` — the five alert rules, in priority order (§6). |
| `lib/owner/mock-data.ts` | New | Literal fixtures: 8 `Driver`s, 11 `Trip`s, ~16–20 `ChargingSession`s (§7). |
| `lib/owner/data-source.ts` | New | `OwnerDataSource` interface consumer, `MockOwnerDataSource`, `getOwnerDataSource()`. Header comment documents the live-adapter seam (§11). |
| `lib/owner/use-owner-data.ts` | New | `useOwnerData()` — the one hook every `/owner` page reads; merges mock snapshot with the real local guest post-mount. |
| `app/globals.css` | Edited | Add `--color-warn` and `--color-danger` to the existing `@theme` token block. No other token touched. |
| `components/ui.tsx` | Edited | Extend `Badge`'s `tone` union with `"warn" | "danger"` and matching soft-badge styles. Existing tones/components untouched. |
| `components/icons.tsx` | Edited | Append `IconAlert`, `IconUser`, `IconCar`, `IconBattery`, `IconClock`, `IconChevronRight`, matching the file's existing `base()` 24×24 stroke helper. No existing icon touched. |
| `components/owner/OwnerShell.tsx` | New | Responsive owner-only chrome: sidebar (md+) / bottom tab bar (below md), top bar, no-auth warning comment. Wraps every `/owner/**` page. |
| `components/owner/owner-ui.tsx` | New | `StatTile`, `StatusPill`, `TripStatusBadge`, `AlertsPanel`, `EmptyState`, `DriverTable`, `TripTable`, `ChargingSessionList`, `ReturnChecklistCard`. |
| `components/owner/charts.tsx` | New | `MiniBarChart`, `BatteryReturnGauge`, `TripTimeline` — inline SVG, no chart library. |
| `app/owner/layout.tsx` | New | Renders `OwnerShell` around `{children}` for the `/owner` route group. Server component (shell itself is client). |
| `app/owner/page.tsx` | New | `/owner` — overview: `AlertsPanel`, 4 `StatTile`s (fleet stats), `MiniBarChart` of recent energy cost, needs-attention roster glance, recent trips list. |
| `app/owner/drivers/page.tsx` | New | `/owner/drivers` — filterable roster (`DriverTable`) including the merged local guest. |
| `app/owner/drivers/[id]/page.tsx` | New | `/owner/drivers/[id]` — one driver's module + checklist breakdown against `modulesForPath(pathMode)` / `CHECKLIST`. |
| `app/owner/trips/page.tsx` | New | `/owner/trips` — status-filtered trip list (`TripTable`). |
| `app/owner/trips/[id]/page.tsx` | New | `/owner/trips/[id]` — mileage, `BatteryReturnGauge`, `TripTimeline`, `ChargingSessionList`, cost-recovery hint card, copy-guest-link (for the unassigned upcoming trip), `ReturnChecklistCard`. |

No existing file outside the three listed as "Edited" (`lib/flow.ts`, `components/OnboardingApp.tsx`,
`app/globals.css`, `components/ui.tsx`, `components/icons.tsx` — five edits total) is touched.
`lib/store.ts`, `lib/tesla.ts`, `lib/tesla-server.ts`, `lib/content.ts`, `lib/config.ts`, and every
`app/api/tesla/**` route are untouched.
Addendum: a follow-up QA-fix commit (93e03b4) temporarily swapped three `lib/content.ts` module `youtubeId`s away from the `@tesla_tutorials` channel, after CLAUDE.md's stale single-channel phrasing ("author_name == 'Tesla'") made those ids look like a defect during browser QA. That swap was reversed once the owner's already-recorded acceptance of `@tesla_tutorials` (2026-06-16) surfaced — `lib/content.ts` on this branch ships identical to master, and the stale rule text in CLAUDE.md and README was corrected instead, out-of-scope pre-existing documentation drift unrelated to the owner dashboard itself.

## 6. Alert rules

`deriveAlerts()` (`lib/owner/alerts.ts`) evaluates five rules against the merged snapshot, the
host's `OwnerState`, the resolved return-charge policy percentage, and `now`. Rules are evaluated
in the order below and the resulting list is sorted **danger before warn**, and within the same
severity, **most-recent relevance first** (e.g. the soonest-starting trip, or the most-recently-
ended trip) — ties broken by the rule's evaluation order above.

1. **`guest-not-started`** (danger) — a driver has an upcoming trip starting within 48 hours of
   `now`, and that driver's `progress` is `null`, or `progress.pct === 0` with no completed
   modules. Message names the driver and the trip's start time; `href` points at
   `/owner/drivers/[id]`.
2. **`required-checklist-open`** (danger) — a driver has an upcoming trip starting within 24
   hours of `now`, and at least one `CHECKLIST` item with `required: true` is not `true` in
   `progress.checklist` (missing keys count as not checked). Message names the driver and the
   specific missing item(s); `href` points at `/owner/drivers/[id]`.
3. **`guest-stalled`** (warn) — `driverStatus(driver, now) === "stalled"` and that driver has an
   upcoming or active trip. Message names the driver and how long they've been idle; `href`
   points at `/owner/drivers/[id]`.
4. **`return-below-policy`** (warn) — a completed trip has `batteryEndPct !== null` and
   `batteryEndPct < policyPct`, **unless** `ownerState.tripChecklists[trip.id]?.chargedToPolicy`
   is `true` (the host has manually recorded that the car was subsequently topped off, which
   suppresses this alert for that trip permanently until the tick is cleared). Message names the
   trip/driver and the percentage gap; `href` points at `/owner/trips/[id]`.
5. **`supercharging-unrecovered`** (warn) — a completed trip ended within the last 14 days of
   `now` and its `tripEnergy(sessions).superchargerCostUsd > 0`. Message names the trip/driver
   and the dollar amount; `href` points at `/owner/trips/[id]`.

`AlertsPanel` renders the resulting list severity-first with a left-border/dot color cue
(`--color-danger` / `--color-warn`), and renders the `EmptyState` "All clear — nothing needs you
right now." when `deriveAlerts()` returns an empty array.

## 7. Mock-data requirements

`lib/owner/mock-data.ts` is the single source of fleet data for v1. Requirements, all binding:

- **Determinism.** No `Math.random()`, no `Date.now()`, and no relative-time arithmetic (e.g.
  `Date.now() - 3 * DAY`) anywhere at module scope. Every timestamp is a literal epoch-millisecond
  number (or an easily-audited `Date.UTC(...)`-derived constant computed once and inlined as a
  literal — not recomputed per render). This guarantees SSR output and first client paint are
  byte-identical (see Decision 3, §8 for the general SSR rule).
- **Era.** All fixture data is anchored to mid-August 2026, consistent with `hostConfig`'s
  present-tense copy and the app's current date.
- **8 drivers**, ids `"drv-01"` through `"drv-08"`, with varied realistic names and emails. Their
  `progress` fields must be constructed so the 8 drivers' `driverStatus()` results (per §4's
  `driverStatus` rule) visibly span all four `DriverStatus` values: at least one `not-started`
  (`progress: null` or zero-progress), at least one `in-progress`, at least one `ready`
  (`progress.isDone === true`), and at least one `stalled` (`progress.updatedAt` more than
  `STALL_THRESHOLD_MS` before the fixture "now"). Any `completed` module ids inside a mock
  `progress.completed` array, and any keys in `progress.checklist`, must be real ids taken from
  `MODULES` and `CHECKLIST` in `lib/content.ts` (read that file first; do not invent ids).
- **11 trips**, ids `"trip-01"` through `"trip-11"`:
  - 6 `completed`, spread across June–August 2026, each with realistic float odometer readings
    (e.g. `18432.6 → 18711.2`) and integer battery percentages (e.g. `90 → 52`). At least 2 of
    the 6 must return with `batteryEndPct` below an 80% policy threshold. At least 3 of the 6
    must have one or more associated Supercharger `ChargingSession`s.
  - 1 `active`, started around August 10, 2026, with `odometerEndMi: null` and
    `batteryEndPct: null` (trip is still in progress).
  - 4 `upcoming`, with `driverId` assigned except for exactly one. At least 2 of the 4 must start
    within 48 hours of the mid-August-2026 "now" anchor (to exercise both danger alert rules).
    **`trip-11` must be the unassigned one** (`driverId: null`), reserved as the target of the
    `?trip=trip-11` demo link that the real local guest claims.
  - Every `chargingSessionIds` array on a trip must reference session ids that exist in the
    fixture's `ChargingSession[]` and whose `startedAt`/`endedAt` fall inside that trip's
    `startAt`/`endAt` window.
- **16–20 charging sessions total**, ids `"chg-01"` upward, split between:
  - Superchargers: realistic California site names such as "Supercharger - Gilroy, CA",
    "Supercharger - Kettleman City, CA", "Supercharger - Santa Nella, CA", "Supercharger - San
    Mateo, CA", `isSupercharger: true`, rate roughly $0.36–$0.52/kWh (i.e. `costUsd / kWhAdded`
    falls in that band).
  - Home/public L2: e.g. "Home charging (garage)" or a public L2 site name, `isSupercharger:
    false`, rate roughly $0.14–$0.20/kWh.
  - All numeric fields must be internally consistent: a trip's total `kWhAdded` and `costUsd`
    summed across its sessions should be a plausible amount for that trip's mileage and battery
    delta, and no session's timestamps fall outside its trip's window.

## 8. SSR & hydration rules

- `useOwnerData()` must render the mock snapshot **identically** on the server and on the client's
  first paint: no `localStorage` read, no `window` access, and no `Date.now()`-derived value may
  affect what is rendered before the component has mounted. The guest-local driver/trip merge
  happens strictly **after** mount, inside a `useEffect`, gated the same way `useOnboarding`'s
  `hydrated` flag gates its own first read (`lib/store.ts`).
- Any `now` value used for alert/status derivation (`driverStatus`, `deriveAlerts`) must be read
  once per render inside the client component (e.g. via `useState(() => Date.now())` or passed
  down from a single call site), never read differently between the server render and the first
  client render. Since `lib/owner/mock-data.ts` contains no live clock reads, the only place
  `Date.now()` is called is inside client-only code paths (post-mount), consistent with Decision 3.
- `readPublishedProgress()` and `useGuestProgress()` must guard every `localStorage`/`window`
  access with `typeof window === "undefined"` checks and `try/catch`, mirroring
  `lib/store.ts`'s `loadState`/`saveState` pattern exactly, so a failure (privacy mode, disabled
  storage, malformed JSON) degrades to `null` rather than throwing during render.
- `app/owner/layout.tsx` stays a server component that only renders `<OwnerShell>{children}</OwnerShell>`;
  all client-only logic (pathname-based nav highlighting, the bottom tab bar, hooks) lives inside
  `OwnerShell.tsx`, which is marked `"use client"`.
- Every `/owner/**` page component fetches its data via `useOwnerData()` (client-side) rather than
  a server-side data fetch, since the driving requirement is deterministic mock-plus-local-guest
  merge, not server data access; this keeps all five route pages simple, uniform, and consistent
  with the SSR-identical-first-paint rule above.

## 9. Accessibility notes

- All three SVG charts (`MiniBarChart`, `BatteryReturnGauge`, `TripTimeline`) carry `role="img"`
  and a caller-supplied `ariaLabel` that states the chart's conclusion in words (e.g. "Energy
  cost by week, $412 to $89" — not just "energy chart"), since the visual encoding alone is not
  accessible to screen-reader users. No chart relies on color alone: `BatteryReturnGauge`'s
  below-policy state also renders the percentage-point delta as text, and `AlertsPanel`'s
  severity cue is paired with the word "warn"/"danger"-equivalent language in the message itself,
  not conveyed by border color alone.
- `AlertsPanel` rows are real `next/link` anchors (via `IconChevronRight`-suffixed link rows), so
  they are keyboard-focusable and reachable via Tab, with visible focus rings per the project's
  existing convention (`app/globals.css` / `components/ui.tsx` focus-ring tokens — reused, not
  reinvented).
- `DriverTable`/`TripTable` render a semantic `<table>` with `<th scope="col">` headers at `md+`
  widths; below `md` they switch to stacked `Card`s carrying the same information as
  labeled rows (label + value pairs), so no information is lost or table-only at small widths —
  this also means screen-reader table navigation is available whenever the tabular layout is
  shown, and nothing is conveyed by table structure alone at narrow widths where it's dropped.
- `ReturnChecklistCard`'s four toggles are large (one-handed, phone-tap-target-sized, consistent
  with the guest app's existing "large tap targets" convention from `CLAUDE.md`), implemented as
  real `<button role="switch" aria-checked>` or `<input type="checkbox">` elements — never a
  `<div onClick>` — so they carry correct semantics and state to assistive tech. The notes
  `<textarea>` has an associated `<label>`.
- `OwnerShell`'s bottom tab bar (below `md`) and sidebar (`md+`) both mark the current section
  with `aria-current="page"` on the active link, not solely a background-color change.
- Every new icon in `components/icons.tsx` is decorative-only (paired with adjacent visible text
  in every usage in this feature), so icons themselves carry `aria-hidden="true"`, matching the
  existing `IconBolt`/etc. convention already in that file.

## 10. Non-goals recap pointer

See §12 for the full out-of-scope list; the items below (§11) are the specific v2 seams this v1
design deliberately leaves attach points for.

## 11. v2 seams

These are not implemented in v1. Each is named here because v1's architecture was deliberately
shaped to make each of these a drop-in extension rather than a rewrite.

- **Live Fleet API host connection — a separate, second OAuth grant from the guest flow.** The
  guest flow's live mode (`lib/tesla-server.ts`) performs a single read-and-discard: exchange
  code for tokens, read identity + vehicle list once, seal only the resulting profile into an
  httpOnly cookie, and throw the tokens away. A host connection is structurally different and
  must **not** reuse that code path: it is a separate OAuth grant against `auth.tesla.com` with
  scopes `openid offline_access vehicle_device_data`, and the resulting refresh token must be
  **persisted** (server-side, not in a browser cookie) so the dashboard can poll on the host's
  behalf indefinitely without asking them to re-authenticate. This is a deliberate, intentional
  departure from the guest flow's single-read-discard-tokens model, not an oversight to reconcile
  — the two flows solve different problems (a guest identifying themselves once vs. a host
  granting standing read access to their fleet) and should stay separate OAuth clients/scopes.
- **`vehicle_data` polling at trip start/end only**, never continuously and never per page view.
  Reads `vehicle_state.odometer` (float, miles) and `charge_state.battery_level` (integer
  percent) — the same two fields the mock `Trip.odometerStartMi`/`odometerEndMi` and
  `batteryStartPct`/`batteryEndPct` already model. The live adapter must resolve the
  region-sharded Fleet API base URL per vehicle (reusing the approach `resolveRegionBase()` in
  `lib/tesla-server.ts` already implements for the guest flow, including handling the HTTP 412
  "wrong region" response) and must respect Tesla's rate limit of 60 realtime requests per minute
  per device. Fleet API billing is pay-per-use with a **$0 default billing cap** — i.e. calls
  will simply fail closed until a host explicitly raises their cap in Tesla's developer console —
  so the live adapter must surface that failure mode as an actionable dashboard message, not a
  silent data gap.
- **Charging history and invoices.** Per-session charging data comes from
  `GET /api/1/dx/charging/history` (paginated), which is available to individual Tesla accounts,
  plus per-session invoice PDFs fetched alongside it. The **structured** `/api/1/dx/charging/sessions`
  endpoint that returns itemized per-session line items is business-fleet-account-only and is
  explicitly not assumed available for an individual host account; the v2 adapter should treat
  `charging/history` + PDF parsing as the baseline, with `charging/sessions` as an optional
  enhancement gated on account type.
- **Caching, not per-view polling.** All live reads (vehicle data, charging history) must be
  cached server-side and refreshed on the schedule described above (trip start/end for vehicle
  data), never re-fetched on every dashboard page load — both to respect the rate limit and
  because Fleet API calls cost money under pay-per-use billing.
- **Pay-per-use billing awareness with a $0 default cap.** The dashboard's live mode should treat
  "Fleet API calls are currently capped to $0 and failing" as an expected, first-class state to
  detect and explain, not an error to swallow — hosts enabling live mode need to know they must
  raise their cap in Tesla's developer console before data will flow.
- **Real owner authentication via middleware.** `/owner` in v1 has no auth (§2 Decision 8). v2
  adds a Next.js middleware gate on the `/owner` route group checking for a host session cookie,
  structurally parallel to the `rtr_tesla` httpOnly cookie pattern `lib/tesla-server.ts` already
  uses for the guest live-auth flow, but semantically distinct (a host session, not a guest
  profile).
- **Multi-car support.** v1's `OwnerSnapshot`/mock data model an implicit single car (mirroring
  `hostConfig`'s single-car model today). A v2 fleet with multiple cars needs a `Vehicle` entity
  that `Trip` references, and `FleetStats`/`DriverTable`/`TripTable` would need a per-vehicle
  filter dimension. `OwnerSnapshot`'s shape (a flat list of trips/drivers/sessions) was kept
  intentionally simple in v1 specifically so this extension is additive (new entity + new foreign
  key) rather than a restructuring.
- **Server persistence.** v1's owner-side state (`rtr:owner:v1`) is browser-local, exactly like
  the guest's own `rtr:state:v1` — it does not survive a different browser or device, and two
  hosts (or a host on two devices) do not see each other's ticks. v2 needs a real backend
  (database-backed `OwnerState` per host account, keyed by the host's authenticated identity from
  the middleware gate above) so return-checklist state and alert-resolution state are durable and
  shared across the host's own devices. `lib/owner/owner-state.ts`'s `load`/`save`/`update`
  functions are the seam: a live implementation swaps the `localStorage` read/write for an API
  call behind the same `useOwnerState()` hook signature, and no owner UI component changes.

## 12. Out of scope for v1

Explicitly not built in this iteration:

- Any real Tesla Fleet API data on the owner side — `/owner` is 100% mock fixtures plus the one
  real signal already available (the local browser's own guest progress via
  `rtr:progress:v1`/`rtr:trip:v1`).
- Owner/host authentication of any kind (see Decision 8 and the middleware seam in §11).
- A server or database of any kind. All owner-side state (`rtr:owner:v1`) is `localStorage`,
  exactly like the existing guest state.
- Multi-car / multi-vehicle support. The mock fleet models trips against an implicit single car,
  matching `hostConfig`'s existing single-car assumption.
- Billing, invoicing, or any Stripe/payment integration — the "cost-recovery hint card" on the
  trip detail page is informational text summarizing `tripEnergy()`'s `superchargerCostUsd`, not
  a bill, an invoice, or a payment flow.
- Editing or overriding guest-facing content (`lib/content.ts`, `lib/config.ts`) from the owner
  dashboard. The dashboard is read-mostly; its only writes are the host's own
  `rtr:owner:v1` checklist ticks/notes.
- Notifications, emails, SMS, or push alerts. `AlertsPanel` is a pull-based, on-page list; there
  is no outbound notification channel in v1.
- Editing, reassigning, or deleting trips/drivers/sessions from the UI. All fixture and merged
  data is read-only from the dashboard's perspective except the four `ReturnChecklistCard`
  toggles and its notes field.
- Any change to guest-facing behavior, routing, or the `rtr:state:v1` schema. The only guest-side
  edit is the addition of `usePublishProgress(...)` inside `OnboardingApp.tsx`, which writes to
  new keys only and never reads or mutates `OnboardingState`.
- Internationalization/localization of owner-side copy.
- Automated tests. Per `CLAUDE.md`, this repository has no lint/test script; this feature follows
  the same convention as the rest of the codebase (type-checking via `pnpm build` is the
  verification mechanism).
