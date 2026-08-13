# Vehicle Management — Design Spec

Status: Draft for implementation
Date: 2026-08-12
Branch: `owner-dashboard`

## 1. Context & goals

> "owners should have the ability to manage their vehicles on the dashboard"

The owner dashboard (`/owner`, see `docs/superpowers/specs/2026-08-12-owner-dashboard-design.md`)
today models an implicit single car: every `Trip` is understood to be against "the car," and "the
car" itself is `hostConfig.car` — a compile-time constant one host edits by hand per listing.
There is no way, from inside the dashboard, to see the fleet as a set of vehicles, add a second
car, correct a typo in a car's color, or retire a car that's left the fleet. A host with more than
one Tesla on Turo has no representation of that in the app at all; a host with exactly one car has
no page that says so explicitly either — the car is baked into copy, not a manageable thing.

This spec adds **owner-side vehicle management**: a `/owner/vehicles` list, a `/owner/vehicles/new`
create form, and a `/owner/vehicles/[id]` detail/edit page, backed by a new `Vehicle` entity that
trips reference. It threads that entity through the existing stats/alerts/policy pipeline
(`fleetStats`, `deriveAlerts`, the return-charge-policy resolution used by `BatteryReturnGauge` and
the cost-recovery card) so a per-vehicle return-charge override is honored everywhere a policy
percentage is shown or compared, never in just one place.

Goals for this iteration:

- Let a host see every vehicle they've entered, add a new one, and edit or archive an existing one,
  entirely inside `/owner`.
- Let a host set a **per-vehicle** return-charge policy override (e.g. a second, older car with a
  smaller pack that the host wants back at 90% instead of the fleet default), and have that
  override apply consistently to every place a policy percentage is computed, displayed, or
  compared against a battery reading.
- Preserve the existing single-car deployment's behavior: no filter clutter and no policy-threshold
  change on pages a single-car host already used — trip rows and trip detail do gain a vehicle
  identity line, but nothing about filtering or policy math changes underneath a host who never
  opens `/owner/vehicles`.
- Establish `Vehicle` as the entity `Trip` references, laying the multi-car groundwork the owner
  dashboard spec's §11 "v2 seams" already called out as a deliberate future extension point,
  without pulling in a real backend, Tesla vehicle import, or trip-creation UI to do it.

Non-goals for this iteration: importing vehicles from a connected Tesla account (no owner-side
Tesla identity exists yet — see §2 Decision 5), hard deletion of vehicles, trip creation/editing
UI, and cross-device sync of vehicle records. See §8 (Out of scope) for the full list.

## 2. Decisions & rationale

Each decision below names the alternative considered and rejected.

**(1) Vehicles are stored in a new, dedicated `localStorage` key, `rtr:vehicles:v1` — not in
Supabase, and not merged into an existing key.** *Rejected alternative:* add a `vehicles` table to
the project's Supabase schema (already wired for owner auth per the completed "Supabase Auth
portal" work) and read/write it via the Supabase client. Rejected for three compounding reasons.
First, the shared Supabase project's schema is currently untouched by this feature — every table
in it belongs to the auth/session work, and adding a product table to a schema another concern
owns is exactly the kind of blast-radius increase this codebase's existing specs (see the owner
dashboard spec's Decision 1, which drew the identical line around `rtr:state:v1`) have consistently
avoided. Second, every other piece of owner-side domain data in this app — `OwnerState`
(`rtr:owner:v1`), the guest's own `OnboardingState` (`rtr:state:v1`) — is `localStorage`-backed
today; a mock-first product stays coherent when its newest feature follows the same storage
convention as everything around it, rather than becoming the one part of the demo that quietly
needs a database credential to work. Third, the seam is documented, not foreclosed: `data-source.ts`
already carries a header comment describing the live-adapter shape for trips/charging sessions:
a real deployment gets a `vehicles` table prefixed `onlyevs_` (consistent with this project's
product name inside the shared schema, avoiding collision with the auth tables that already exist
there) the same day a live `OwnerDataSource` is actually built — this spec's `vehicle-state.ts`
is written so that swap is a drop-in behind the same hook shape, exactly like `owner-state.ts`
already promises for checklists.

**(2) `Vehicle[]` lives on `OwnerSnapshot` (`vehicles: Vehicle[]`), not as a sibling top-level
concept threaded separately through every function that needs it.** *Rejected alternative:* pass
`vehicles` as an additional standalone argument everywhere `OwnerSnapshot` is passed today (e.g.
`fleetStats(snapshot, vehicles, policyPct)`). Rejected because `fleetStats`'s signature is called
from multiple existing pages today and is explicitly required to stay unchanged
(`fleetStats(snapshot, globalPolicyPct)` — see the CONTRACTS block) so that every existing call
site keeps compiling and behaving identically the moment `snapshot.vehicles` is empty or absent of
overrides; putting `vehicles` inside the snapshot is what makes that possible; a bolted-on third
argument would force an edit to every call site for a feature most of them don't otherwise care
about.

**(3) Exactly one pure function, `resolveVehiclePolicyPct(vehicle, globalPolicyPct)`, is the only
place an effective per-trip charge policy is computed.** *Rejected alternative:* let each consumer
(the alert rule, the trip-detail battery gauge, the trip table's policy chip) independently check
`vehicle?.returnChargeLevelPct ?? globalPolicyPct` inline. Rejected because that is a two-line
one-liner that is trivially easy to get subtly wrong in one of three call sites (e.g. forgetting
the `?? globalPolicyPct` fallback, or resolving against the wrong vehicle lookup) and, once wrong
in exactly one place, produces the worst kind of dashboard bug: the alert badge and the gauge on
the same page disagreeing about whether a return was compliant, with no error, just silently
different numbers. A single exported function that every one of those three call sites imports
makes that class of bug structurally impossible — there is only one implementation to be wrong in,
and fixing it fixes all three renderings at once.

**(4) Vehicle mutations are exposed as four narrow, typed verbs on the hook —
`addVehicle`/`updateVehicle`/`archiveVehicle`/`unarchiveVehicle` — not a single generic `update`
patch function (unlike `useOwnerState`'s `update(patch)`).** *Rejected alternative:* mirror
`useOwnerState()`'s `update(patch: Patch)` shape exactly, letting callers spread arbitrary partial
`VehicleState` patches. Rejected because `OwnerState`'s only mutable surface is a `Record` of
independent per-trip checklists where a generic merge patch is safe and natural; `VehicleState`'s
`vehicles` record has real invariants around it — id assignment must be sequential and race-safe
against concurrent tabs, and archiving must respect "never archive the last active vehicle." A
generic patch function invites a caller to bypass those invariants by writing a raw record; four
named verbs are the only way to mutate vehicle state, and each one is the single place its
invariant is enforced (`nextVehicleId` inside `addVehicle`, `canArchiveVehicle`'s check gating
`archiveVehicle` at call sites).

**(5) No Tesla-import path onto a vehicle record in this iteration — vehicles are host-entered
data only, exactly like `hostConfig.car` is today.** *Rejected alternative:* let a host connect
their own Tesla account from the vehicle form and pull VIN/model/year/color directly from the
Fleet API, the way live guest sign-in already does via `lib/tesla-server.ts`. Rejected because no
owner-side Tesla OAuth identity exists anywhere in this codebase yet — `lib/tesla-server.ts`'s
entire live-mode implementation is scoped to a *guest* proving they can drive a specific rented
car, a fundamentally different grant (see the owner dashboard spec's §11 "Live Fleet API host
connection" seam, which already calls out that a host grant needs `openid offline_access
vehicle_device_data` scopes and persisted refresh tokens — the opposite of the guest flow's
single-read-discard design). Building a real owner-Tesla-identity OAuth client just to prefill four
text fields on a form would be building the hard, security-sensitive half of a much bigger feature
as a side effect of a CRUD form. A separate, already-tracked mission ("Build first-run owner setup
wizard with Tesla vehicle import") is where that identity and import flow belongs; this spec's
`vin`/`vehicle-import` fields exist in the `Vehicle` type (`vin: string | null`) specifically so
that future wizard can populate them without a schema change, but nothing in this iteration writes
to them except a host typing into a text field.

**(6) A single-car deployment gets no filter clutter and no policy-threshold change: the vehicle
Segmented filter on `/owner/trips` is gated on "more than one **active** vehicle," and policy
resolution (alerts, gauge, cost-recovery) already degrades to today's exact flat-`policyPct`
behavior when there's only one vehicle to resolve against.** Trip rows and trip detail do gain a
vehicle identity line (`VehicleChip` / header text) regardless of fleet size — that is new, visible
UI, not a zero-diff claim. *Rejected alternative:* always show the vehicle filter/chips once this
feature ships, even for single-car hosts. Rejected because the entire owner dashboard spec's premise
is that today's single-car host — the only host this app has ever actually been used by — should not
experience a feature they have no use for as clutter; a filter control with one meaningless option
is worse than no filter control. Gating on `>1` *active* vehicle (not `>1` vehicle total) means an
archived second car doesn't leave a dead one-option filter behind either.

**(7) Archiving a vehicle is a status flip, never a delete, and is blocked when it is the sole
active vehicle — but is always allowed when trips still reference it.** *Rejected alternative A:*
hard-delete the vehicle record. Rejected because trips (`Trip.vehicleId`, once wired) are expected
to keep referencing a vehicle's id indefinitely for historical stats/energy-cost reporting, exactly
the way `veh-01`'s seeded trips will; deleting the row a completed trip points at turns "Unknown
vehicle" into the *normal* case for old trips instead of an edge case, which is a worse default.
*Rejected alternative B:* block archiving any vehicle that any trip still references (a cascade
guard). Rejected because that would make the one guaranteed-seeded vehicle (`veh-01`, referenced by
every mock trip via `MOCK_TRIPS`) permanently unarchivable in the shipped demo, which defeats the
point of having an archive control at all. The only invariant actually worth protecting is "a host
must always have at least one active vehicle to assign new trips against" — hence `canArchiveVehicle`
blocking solely on "is this the sole active vehicle," with historical-trip references handled by
degrading gracefully (§7 Edge cases) rather than by blocking the archive.

**(8) The dedicated `/owner/vehicles/new` route, not a modal or inline expand-in-place on the
list page.** *Rejected alternative:* an in-page "Add vehicle" panel/modal on `/owner/vehicles`
itself. Rejected for consistency with the one other creation flow this app already has — trip
detail's guest-link flow lives at its own URL structure, and, more directly, this keeps the create
form and the edit form as the *same* component (`vehicle-form.tsx`, `mode: "create" | "edit"`)
reachable from two distinct, linkable, back-button-friendly routes, rather than needing the list
page to hold create-vs-edit-vs-closed UI state itself.

**(9) The guest-facing walkthrough is untouched — `hostConfig.car` still feeds every guest-visible
string, and the vehicle form carries an explicit hint that editing a vehicle record here does not
change what a guest sees.** *Rejected alternative:* have the guest flow read the active/primary
`Vehicle` record instead of `hostConfig.car`, so editing a vehicle here would flow through to guest
copy. Rejected because `hostConfig.ts` is explicitly documented (`CLAUDE.md`) as "the ONE file a
host edits per car/listing" for guest-facing content, and rewiring that read path is a materially
larger, riskier change than this spec's actual goal (owner-side bookkeeping) — it would also make
`/owner/vehicles`' per-vehicle records guest-visible the moment a host has more than one vehicle,
with no defined rule for *which* vehicle's data a guest should see. Leaving `hostConfig.car` as the
guest flow's sole source, and calling the resulting drift out explicitly in the form's copy (per
CONTRACTS: "Editing here doesn't change what guests see in the walkthrough — that still comes from
the host config"), is honest about the seam instead of silently papering over it. A future
multi-car guest flow (which trip a guest is walking through, and which vehicle it maps to) is
exactly the kind of larger redesign the owner dashboard spec's "Multi-car support" v2 seam already
flagged as out of scope for now.

## 3. Architecture overview

```
lib/owner/vehicle-state.ts (NEW)         lib/owner/derive.ts (EDIT)            components / routes (NEW/EDIT)
──────────────────────────────           ─────────────────────────             ───────────────────────────────
rtr:vehicles:v1 (localStorage)     →     resolveVehiclePolicyPct(vehicle, →    vehicle-form.tsx
  seed-once from hostConfig.car             globalPolicyPct): number             VehicleChip (owner-ui.tsx)
useVehicleState()                        vehicleStats(vehicleId, trips,          TripTable +vehicles prop
  add/update/archive/unarchive             sessions): VehicleStats            →
  nextVehicleId, validateVehicleInput    fleetStats(snapshot, policyPct)         /owner/vehicles (list)
  canArchiveVehicle                        — signature unchanged, resolves      /owner/vehicles/new (create)
                                            per-trip via snapshot.vehicles       /owner/vehicles/[id] (detail/edit)
lib/owner/types.ts (EDIT)          →                                            /owner/trips (+ vehicle filter)
  Vehicle, VehicleInput, VehicleStatus   lib/owner/alerts.ts (EDIT)              /owner/trips/[id] (+ VehicleChip,
  VehicleStats                             deriveAlerts(...vehicles)              gauge fed resolved pct)
  Trip.vehicleId: string                   return-below-policy uses per-trip     /owner/page.tsx (alerts +vehicles)
  OwnerSnapshot.vehicles: Vehicle[]        resolveVehiclePolicyPct              OwnerShell.tsx (+Vehicles nav item)

lib/owner/mock-data.ts (EDIT)      →     lib/owner/data-source.ts (EDIT)   →   lib/owner/use-owner-data.ts (EDIT)
  MOCK_VEHICLE_SEED: Vehicle               MockOwnerDataSource.getSnapshot      composes useVehicleState()
  every MOCK_TRIPS gains vehicleId           gains vehicles: [MOCK_VEHICLE_SEED] INITIAL_SNAPSHOT.vehicles seeded
    "veh-01"                                                                    merged snapshot swaps in
                                                                                   vehicleState.vehicles once
                                                                                   hydrated
                                                                                 hydrated = data && vehicle
```

Data flow, end to end:

1. `lib/owner/vehicle-state.ts` owns `rtr:vehicles:v1`, structured identically in spirit to
   `lib/owner/owner-state.ts`: SSR-safe load/save, spread-merge on load, try/catch around every
   `localStorage` access, and a `useVehicleState()` hook with a `hydrated` flag. The very first
   time the key is read and found empty, it is seeded with exactly one vehicle — `veh-01` — built
   from `hostConfig.car`, so an existing single-car deployment gets a `Vehicle` record for free
   with no host action required.
2. `lib/owner/types.ts` gains the `Vehicle`/`VehicleInput`/`VehicleStatus`/`VehicleStats` types,
   `Trip.vehicleId: string` (required — every trip, mock or future-live, is now unconditionally
   assigned to a vehicle), and `OwnerSnapshot.vehicles: Vehicle[]`.
3. `lib/owner/mock-data.ts`'s `MOCK_VEHICLE_SEED` constant is the same values the store seeds —
   defined once, imported by both the store's fallback path (conceptually; the store computes its
   own seed independently per its own contract, see §7) and `data-source.ts`'s mock snapshot — and
   every existing `MOCK_TRIPS` literal is given `vehicleId: "veh-01"`.
4. `lib/owner/derive.ts` gains `resolveVehiclePolicyPct` (the single per-vehicle-or-global policy
   resolver) and `vehicleStats` (per-vehicle trip count / miles / energy cost / average return
   charge, reusing `tripMiles`/`sessionsForTrip`/`tripEnergy`). `fleetStats`'s signature is
   unchanged; internally it now looks up each trip's vehicle from `snapshot.vehicles` and resolves
   its effective policy through `resolveVehiclePolicyPct` instead of using the flat global
   `policyPct` for every trip — with no vehicle overrides present (today's exact fixture state),
   output is byte-identical to before this feature.
5. `lib/owner/alerts.ts`'s `deriveAlerts` gains a `vehicles: Vehicle[]` argument; only the
   `return-below-policy` rule's threshold changes, from the flat `policyPct` to each trip's
   resolved effective policy, and its message names the vehicle when an override applied.
6. `lib/owner/use-owner-data.ts` composes `useVehicleState()` alongside its existing snapshot
   fetch and `useGuestProgress()`. `INITIAL_SNAPSHOT.vehicles` is seeded with `[MOCK_VEHICLE_SEED]`
   so SSR/first-paint stays deterministic exactly as today. Once the vehicle store's own hydration
   lands (independent of, and not gated by, the mock-snapshot/guest-progress hydration), the merged
   snapshot's `vehicles` array is swapped for the live `vehicleState.vehicles` — the host's actual
   edits, not the static mock — and the returned `hydrated` boolean becomes
   `dataHydrated && vehicleHydrated`, still a single boolean; no consumer's destructuring changes.
7. UI: `components/owner/vehicle-form.tsx` is the one create/edit form, used by both
   `/owner/vehicles/new` and `/owner/vehicles/[id]`. `components/owner/owner-ui.tsx` gains
   `VehicleChip` and a `vehicles` prop on `TripTable`, so every existing trip row can name its car
   and resolve its own policy chip. `OwnerShell.tsx` gains a fourth nav item.

## 4. Type contracts (verbatim)

The following type/function signatures are normative and must be implemented exactly as written —
field names and types are load-bearing across parallel implementation work.

```ts
// ---- lib/owner/types.ts (EDIT, additive) ----
export type VehicleStatus = "active" | "archived";
export interface Vehicle {
  id: string;                          // "veh-01", "veh-02", ... zero-padded sequential
  displayName: string;
  model: string;
  trim: string;
  year: number;
  color: string;
  shifter: "stalk" | "screen";
  licensePlate: string | null;
  vin: string | null;
  returnChargeLevelPct: number | null; // null = fall back to global policy
  notes: string;
  status: VehicleStatus;
  createdAt: number;
  updatedAt: number;
}
export type VehicleInput = Omit<Vehicle, "id" | "status" | "createdAt" | "updatedAt">;
export interface VehicleStats { vehicleId: string; tripCount: number; milesRented: number; energyCostUsd: number; avgReturnChargePct: number | null; }
// Trip gains: vehicleId: string   (required)
// OwnerSnapshot gains: vehicles: Vehicle[]

// ---- lib/owner/vehicle-state.ts (NEW) ----
export const VEHICLE_KEY = "rtr:vehicles:v1";
export interface VehicleState { version: 1; vehicles: Record<string, Vehicle>; }
// Seed-once: loadVehicleState() -> if key never written, seed veh-01 from hostConfig.car
// (displayName "{year} {model}", trim/color/shifter copied, plate/vin null, pct null, notes "",
//  createdAt/updatedAt = SEED_EPOCH where const SEED_EPOCH = Date.UTC(2026, 0, 1) — fixed literal, deterministic).
// Spread-merge load, try/catch save, SSR guards — mirror lib/owner/owner-state.ts exactly.
export function nextVehicleId(state: VehicleState): string            // first free "veh-NN"
export function validateVehicleInput(input: VehicleInput, currentYear: number): Partial<Record<keyof VehicleInput, string>>
//   displayName/model/trim/color required (trimmed non-empty); year in [2008, currentYear+1]; pct null or [10,100]
export function canArchiveVehicle(state: VehicleState, id: string): boolean   // false only when id is the sole active vehicle
export function useVehicleState(): {
  vehicles: Vehicle[]; hydrated: boolean;
  addVehicle(input: VehicleInput): string;       // returns new id; reads fresh from storage, not stale closure
  updateVehicle(id: string, input: VehicleInput): void;
  archiveVehicle(id: string): void;              // status flip only, never delete; respect canArchiveVehicle at call sites
  unarchiveVehicle(id: string): void;
}

// ---- lib/owner/mock-data.ts (EDIT) ----
// export MOCK_VEHICLE_SEED: Vehicle — identical field values to the store's veh-01 seed (from hostConfig.car, SEED_EPOCH).
// Every MOCK_TRIPS literal gains vehicleId: "veh-01". Also fix the stale header-comment car description if it contradicts hostConfig.

// ---- lib/owner/data-source.ts (EDIT) ----
// MockOwnerDataSource snapshot gains vehicles: [MOCK_VEHICLE_SEED].

// ---- lib/owner/derive.ts (EDIT) ----
export function resolveVehiclePolicyPct(vehicle: Vehicle | null | undefined, globalPolicyPct: number): number  // vehicle?.returnChargeLevelPct ?? globalPolicyPct
export function vehicleStats(vehicleId: string, trips: Trip[], sessions: ChargingSession[]): VehicleStats      // reuse tripMiles/sessionsForTrip/tripEnergy; avg return over completed trips with batteryEndPct
// fleetStats(snapshot, globalPolicyPct): SIGNATURE UNCHANGED — internally resolve per-trip policy via snapshot.vehicles + resolveVehiclePolicyPct (identical output to today when no overrides exist).

// ---- lib/owner/alerts.ts (EDIT) ----
// deriveAlerts args gain vehicles: Vehicle[]; policyPct stays as the GLOBAL fallback. Only return-below-policy changes:
// per-trip effective policy via resolveVehiclePolicyPct; message names the vehicle displayName when an override applied.

// ---- lib/owner/use-owner-data.ts (EDIT) ----
// Compose useVehicleState(); INITIAL_SNAPSHOT.vehicles = [MOCK_VEHICLE_SEED]; merged snapshot uses vehicleState.vehicles once ITS hydration lands (independent of guest-progress hydration); return gains vehicles; hydrated = dataHydrated && vehicleHydrated (single boolean, external shape unchanged).

// ---- components/owner/vehicle-form.tsx (NEW) ----
// Props: { mode: "create" | "edit"; initialValues?: Partial<VehicleInput>; globalPolicyPct: number; onSubmit(input: VehicleInput): void; onCancel?(): void; submitLabel?: string }
// .field inputs; Segmented for shifter; returnChargeLevelPct number input where EMPTY string maps to null (never 0/NaN), placeholder "Global: {globalPolicyPct}%"; inline per-field errors from validateVehicleInput; muted hint "Editing here doesn't change what guests see in the walkthrough — that still comes from the host config."; real <form> semantics, autoComplete off, 44px targets.

// ---- components/owner/owner-ui.tsx (EDIT, additive) ----
// export VehicleChip { vehicle: Vehicle | null } — displayName (or "Unknown vehicle") + Badge "Archived" when applicable.
// TripTable gains vehicles: Vehicle[] prop; rows render VehicleChip; policy chip resolves per-trip via resolveVehiclePolicyPct.

// ---- routes ----
// app/owner/vehicles/page.tsx (NEW, "use client"): active vehicles as Cards (identity line + 4 compact stats from vehicleStats using existing formatters) linking to detail; de-emphasized "Archived" section below w/ Unarchive; "Add vehicle" Button -> /owner/vehicles/new; !hydrated -> loading Card.
// app/owner/vehicles/new/page.tsx (NEW): vehicle-form mode create; on submit const id = addVehicle(input); router.push("/owner/vehicles/" + id); Cancel -> list.
// app/owner/vehicles/[id]/page.tsx (NEW): useParams; EmptyState not-found guard; vehicle-form mode edit (save stays on page w/ brief "Saved" flash); 4 StatTiles from vehicleStats; linked trips list (existing row style, links to trip detail); Archive control = two-step confirm (first click reveals warning listing N upcoming/active trips referencing it), disabled + explanation when !canArchiveVehicle; Unarchive button when archived.
// app/owner/trips/page.tsx (EDIT): vehicle Segmented filter rendered ONLY when >1 active vehicle; pass vehicles to TripTable.
// app/owner/trips/[id]/page.tsx (EDIT): header line uses vehicles lookup (fallback hostConfig.car text); VehicleChip linking to the vehicle; policyPct fed to BatteryReturnGauge/cost-recovery = resolveVehiclePolicyPct(vehicle, globalPolicyPct).
// app/owner/page.tsx (EDIT): deriveAlerts call gains vehicles.
// components/owner/OwnerShell.tsx (EDIT, additive): nav gains { href: "/owner/vehicles", label: "Vehicles" } in BOTH desktop sidebar and mobile tab bar (keep tab bar layout sane at 4 items).
```

## 5. File plan

| File | New/Edited | Purpose |
|---|---|---|
| `lib/owner/types.ts` | Edited | Add `VehicleStatus`, `Vehicle`, `VehicleInput`, `VehicleStats`; add `vehicleId: string` to `Trip`; add `vehicles: Vehicle[]` to `OwnerSnapshot`. Additive only — no existing field renamed or removed. |
| `lib/owner/vehicle-state.ts` | New | `rtr:vehicles:v1` store: `VEHICLE_KEY`, `VehicleState`, seed-once-from-`hostConfig.car` load, `nextVehicleId`, `validateVehicleInput`, `canArchiveVehicle`, `useVehicleState()`. |
| `lib/owner/mock-data.ts` | Edited | Add `MOCK_VEHICLE_SEED`; add `vehicleId: "veh-01"` to every `MOCK_TRIPS` entry; correct the header comment's car description if it no longer matches `hostConfig.car`. |
| `lib/owner/data-source.ts` | Edited | `MockOwnerDataSource.getSnapshot()` returns `vehicles: [MOCK_VEHICLE_SEED]` alongside the existing drivers/trips/sessions. |
| `lib/owner/derive.ts` | Edited | Add `resolveVehiclePolicyPct`, `vehicleStats`; `fleetStats` internals resolve per-trip policy through `snapshot.vehicles` — signature unchanged. |
| `lib/owner/alerts.ts` | Edited | `deriveAlerts` gains `vehicles` arg; `return-below-policy` resolves its per-trip threshold via `resolveVehiclePolicyPct` and names the vehicle when an override applied. |
| `lib/owner/use-owner-data.ts` | Edited | Compose `useVehicleState()`; seed `INITIAL_SNAPSHOT.vehicles`; swap in live vehicle records post-hydration; return gains `vehicles`; `hydrated` becomes the AND of both hydration flags. |
| `components/owner/vehicle-form.tsx` | New | Shared create/edit form used by both vehicle routes; field-level validation via `validateVehicleInput`; empty-charge-pct → `null` mapping; drift-disclosure hint. |
| `components/owner/owner-ui.tsx` | Edited | Add `VehicleChip`; `TripTable` gains a `vehicles` prop and renders it per row alongside a per-trip-resolved policy chip. |
| `app/owner/vehicles/page.tsx` | New | `/owner/vehicles` — active vehicles as stat cards, de-emphasized archived section with Unarchive, "Add vehicle" entry point. |
| `app/owner/vehicles/new/page.tsx` | New | `/owner/vehicles/new` — create form; on submit, navigates to the new vehicle's detail page. |
| `app/owner/vehicles/[id]/page.tsx` | New | `/owner/vehicles/[id]` — edit form, stat tiles, linked trips, two-step archive/unarchive control. |
| `app/owner/trips/page.tsx` | Edited | Vehicle `Segmented` filter, gated on `>1` active vehicle; `vehicles` passed to `TripTable`. |
| `app/owner/trips/[id]/page.tsx` | Edited | Header car line and `VehicleChip` resolved from `vehicles` (fallback to today's `hostConfig.car` text when the trip's vehicle can't be found); `BatteryReturnGauge`/cost-recovery policy fed through `resolveVehiclePolicyPct`. |
| `app/owner/page.tsx` | Edited | `deriveAlerts()` call gains `vehicles`. |
| `components/owner/OwnerShell.tsx` | Edited | `NAV_ITEMS` gains `{ href: "/owner/vehicles", label: "Vehicles" }` in both the sidebar and the bottom tab bar. |

No other file is touched. `lib/owner/owner-state.ts` (return-checklist state), `lib/config.ts`,
`lib/content.ts`, `lib/store.ts`, `lib/tesla.ts`, `lib/tesla-server.ts`, `lib/progress-bridge.ts`,
every `app/api/tesla/**` route, `app/owner/drivers/**`, and the guest-facing `components/steps/*`
are all untouched by this feature.

## 6. Alert rule change

Only one of `deriveAlerts`'s five existing rules changes behavior: `return-below-policy`. Today it
compares every completed trip's `batteryEndPct` against the single flat `policyPct` argument. After
this change, its threshold for a given trip is
`resolveVehiclePolicyPct(vehicles.find(v => v.id === trip.vehicleId), policyPct)` — the trip's own
vehicle's override if one is set, otherwise the same global `policyPct` as before. When an override
applied, the alert's message names the vehicle explicitly (e.g. "veh-02 (Marcus Webb) was returned
at 84%, below Model S's 90% return policy" instead of the generic global-policy wording), so a host
scanning alerts can immediately tell *why* a return that looks fine against the fleet default is
still flagged. All four other rules (`guest-not-started`, `required-checklist-open`,
`guest-stalled`, `supercharging-unrecovered`) are unaffected — none of them compare against a charge
percentage, so `vehicles` is passed to the function but not read by their logic.

## 7. Edge cases

- **Archiving a vehicle that trips still reference.** Allowed, always, with no cascade — archiving
  is a status flip on the `Vehicle` record only; every `Trip.vehicleId` pointing at it is left
  exactly as-is. Historical stats (`vehicleStats`, `fleetStats`) keep counting those trips against
  the now-archived vehicle. This is the intended behavior (§2 Decision 7): the only thing blocked
  is archiving the *last active* vehicle, via `canArchiveVehicle`.
- **A trip whose `vehicleId` doesn't match any known vehicle** (a defensive case — should not occur
  through normal UI flows, since every trip is always seeded or created with a real vehicle id, but
  must degrade cleanly rather than throw if it ever does, e.g. via manually edited `localStorage`).
  Every read site that looks up a trip's vehicle (`VehicleChip`, the trip-detail header, `TripTable`
  rows) treats a missed lookup as `vehicle: null` and renders "Unknown vehicle" rather than
  crashing or omitting the row. Policy resolution for such a trip falls back to the global
  `policyPct` — `resolveVehiclePolicyPct(null, globalPolicyPct)` returns `globalPolicyPct` by
  definition, so an orphaned trip is never silently exempted from policy comparison, it just loses
  its (nonexistent) override.
- **A host redeploys with a changed `hostConfig.car`** (e.g. edits the file to describe a different
  trim or color for a re-listed car) **after `rtr:vehicles:v1` has already been seeded.** The
  already-seeded `veh-01` record does **not** resync to the new `hostConfig.car` values — the seed
  is a one-time bootstrap (`loadVehicleState()` only seeds "if the key was never written"), not a
  standing sync. This is a deliberate consequence of `localStorage`-backed, host-editable vehicle
  records: once a host has (or even could have) edited `veh-01`'s fields through the UI, silently
  overwriting them on every redeploy would clobber real edits with stale config-file defaults. A
  host who wants `veh-01` to reflect a `hostConfig.car` change made after first load must edit it
  through `/owner/vehicles/veh-01` themselves, the same as any other field edit.
- **Blank return-charge-percent input on the vehicle form.** An empty string in the
  `returnChargeLevelPct` field must map to `null` (fall back to global policy) — never to `0` and
  never to `NaN`. `0` would mean "accept the car back with 0% charge," a materially different and
  dangerous-to-silently-produce value from "no override, use the fleet default." The form's submit
  path explicitly checks for an empty string before any numeric coercion, not after.
- **A guest-visible `hostConfig.car` and an owner-edited `Vehicle` record diverge** (e.g. a host
  corrects a vehicle's color in `/owner/vehicles/veh-01` but the guest walkthrough still shows the
  old color from `hostConfig.car`). This is expected, not a bug (§2 Decision 9) — the vehicle
  form's hint text calls it out directly so a host isn't surprised when their edit doesn't show up
  in the guest-facing flow.
- **Single-vehicle fleets never see the trip-list vehicle filter**, per the `>1` active vehicle
  gate (§2 Decision 6) — archiving down to one active vehicle after having briefly had two removes
  the filter from `/owner/trips` on the very next render, same as it never existing.

## 8. QA plan

Manual verification (this repository has no test suite or lint script — see `CLAUDE.md`; `pnpm
build` is the type-checking gate):

1. `pnpm build` succeeds with no new TypeScript errors, confirming every edited signature
   (`fleetStats`, `deriveAlerts`, `useOwnerData`'s return shape) still satisfies every existing
   call site.
2. Fresh browser profile (`rtr:vehicles:v1` unset): load `/owner/vehicles` — confirm exactly one
   active vehicle appears, seeded from `hostConfig.car`'s current values, with stats matching
   `MOCK_TRIPS`' single vehicle's worth of trips.
3. `/owner/trips` and `/owner/trips/[id]` show no filter control and no visible policy-override
   chip when only one active vehicle exists, and every gauge/alert threshold is unchanged from
   today's flat `policyPct` — this is the no-clutter, no-policy-change claim in §2 Decision 6 and
   must be checked visually, not just by signature compatibility. Trip rows and trip detail *do*
   now show a vehicle identity line (`VehicleChip` / header text) even in this single-vehicle case;
   confirm that line renders correctly rather than expecting it to be absent.
4. Add a second vehicle via `/owner/vehicles/new` with a `returnChargeLevelPct` override (e.g.
   90%) different from the global policy. Confirm: (a) the trip vehicle filter now appears on
   `/owner/trips`; (b) a trip assigned to the new vehicle shows the overridden percentage — not the
   global one — on its `BatteryReturnGauge`, its cost-recovery card, and its `return-below-policy`
   alert message and threshold, and that all three agree with each other.
5. Validation: submit the create form with an empty `displayName`/`model`/`trim`/`color`, an
   out-of-range year, and an out-of-range charge percent — confirm inline errors per
   `validateVehicleInput` and no localStorage write. Submit with a blank charge-percent field —
   confirm the saved record's `returnChargeLevelPct` is `null`, not `0`.
6. Archive attempt on the sole active vehicle — confirm the control is disabled with an explanatory
   message, and no state change occurs. Add a second active vehicle, archive the first — confirm it
   succeeds even though historical trips still reference it, its trips still render correctly with
   `VehicleChip` showing its name plus an "Archived" badge, and its historical stats are unchanged.
   Unarchive it — confirm it reappears in the active list.
7. Refresh the page mid-way through each of the above (e.g. right after adding a vehicle) —
   confirm the edit persisted (`rtr:vehicles:v1` is the source of truth, not component state) and
   `hydrated` gates prevent any flash of the seeded default overwriting a real edit.
8. Confirm the guest walkthrough (`/`) is visually and functionally unchanged throughout — no
   vehicle-management edit should be reachable from, or observable in, the guest-facing flow.

## 9. Out of scope

Explicitly not built in this iteration:

- Trip creation or editing UI. Trips remain `mock-data.ts` fixtures (each now carrying
  `vehicleId: "veh-01"`) plus the existing guest-local claim mechanism; nothing in this feature
  lets a host create a new trip or reassign an existing trip's vehicle from the UI.
- Hard deletion of vehicle records. Archiving (§2 Decision 7) is the only removal mechanism; there
  is no "delete forever" control.
- Cross-device or cross-browser sync of vehicle records. `rtr:vehicles:v1` is `localStorage`,
  exactly like every other owner-side or guest-side state key in this app today — a host on a
  second device or browser sees the seeded default, not their edits from elsewhere, until a real
  backend exists (§2 Decision 1's documented `onlyevs_`-prefixed-table seam).
- Tesla-account vehicle import (VIN/model/year/color pulled live from a connected Tesla). No
  owner-side Tesla OAuth identity exists yet; that belongs to the separately tracked "first-run
  owner setup wizard with Tesla vehicle import" mission (§2 Decision 5).
- Any change to what the guest-facing walkthrough displays. `hostConfig.car` remains its sole data
  source; the divergence this can create between it and an owner-edited `Vehicle` record is a
  documented, disclosed edge case (§7), not something this iteration reconciles.
- Multi-vehicle-aware guest flow (a guest's trip resolving to a specific vehicle's copy/photos).
  Flagged as future work in the owner dashboard spec's v2 seams; unaffected by this iteration.
- Server persistence / a real backend of any kind, and owner authentication changes — both remain
  exactly as already specified and built for the rest of `/owner`.

## 10. Self-review

Checked this spec for placeholders, internal contradictions, and ambiguity before committing:

- **Contradiction check — Decision 1 vs. File plan.** Decision 1 discusses a future
  `onlyevs_`-prefixed Supabase table as the eventual live seam; the File plan and CONTRACTS
  correctly show zero Supabase files touched in this iteration. No live-adapter file is listed as
  "New" — confirmed consistent; the Supabase mention in §2 is scoped as documented-future-seam
  language only, matching how the owner dashboard spec treats its own v2 seams (§11 there), not a
  claim that this iteration touches Supabase.
- **Contradiction check — Decision 7 vs. Edge cases vs. CONTRACTS' `canArchiveVehicle`.** Decision
  7 states archiving is blocked "only when it is the sole active vehicle"; the CONTRACTS block's
  `canArchiveVehicle` docstring says the same ("false only when id is the sole active vehicle");
  Edge cases' first bullet confirms referenced-trips do not block archiving. All three agree — no
  drift found.
- **Ambiguity resolved — "vehicleStats reuse."** The CONTRACTS comment for `vehicleStats` says
  "reuse tripMiles/sessionsForTrip/tripEnergy; avg return over completed trips with
  batteryEndPct" without stating the averaging is per-vehicle (filtered to that `vehicleId`'s own
  trips first). Clarified here: `vehicleStats(vehicleId, trips, sessions)` must filter `trips` to
  `t.vehicleId === vehicleId` before computing `tripCount`/`milesRented`/`energyCostUsd`/
  `avgReturnChargePct` — an implementer reading only the one-line contract comment could plausibly
  average across all trips passed in rather than filtering first; this spec's §3 and §6 make clear
  every per-vehicle number is scoped to that vehicle's own trips.
- **Ambiguity resolved — "no filter clutter / no policy-threshold change" scope.** §2 Decision 6 and
  §8 QA step 3 both now spell out precisely what stays unchanged for a single-car deployment: no
  filter control on `/owner/trips`, and no policy-threshold change anywhere a percentage is computed
  or compared (gauge, cost-recovery, alert). Trip rows and trip detail *do* gain a vehicle identity
  line — that is new, visible UI on pages a single-car host already used, not a zero-diff claim, and
  the earlier "zero visual change" phrasing overstated it. `/owner/vehicles` itself is separately
  new UI a single-car host will see only if they navigate to it via the new nav item.
- **Placeholder check.** No TBD/TODO/"fill in later" markers remain; every CONTRACTS signature in
  §4 has a corresponding File plan row (§5), edge case coverage where relevant (§7), and a QA step
  that exercises it (§8). `SEED_EPOCH`'s literal (`Date.UTC(2026, 0, 1)`) is fixed and matches the
  CONTRACTS text verbatim, consistent with the owner dashboard spec's existing rule (§8 there)
  against any `Date.now()`/relative-time value affecting first-paint output.
- **Terminology consistency.** "Global policy" / "global fallback" / "fleet default" are used
  interchangeably in prose throughout this document to refer to the same `policyPct` /
  `globalPolicyPct` parameter (`parseReturnPolicyPct(hostConfig.rental.returnChargeLevel)`,
  unchanged from the owner dashboard spec) — no additional named concept is introduced by the
  varied phrasing; flagged here for the implementer's awareness rather than rewritten, since the
  variation reads naturally in context and CONTRACTS' own code comments use "global" and "policy"
  interchangeably too.

## 11. Post-audit remediation

Recorded after implementation, during the docs/spec accuracy pass on branch `owner-dashboard`:

- **`lib/content.ts` contamination.** During the review phase of this feature, an out-of-lane edit
  landed in `lib/content.ts` (guest-facing tutorial module content, entirely outside this spec's
  scope) — it altered the "official Tesla video" verification-comment wording to admit
  `@tesla_tutorials` as a qualifying channel, and added three `video` entries not covered by this
  spec's file plan. That edit is present in the committed history at `3fdeb79` (`feat: vehicle
  management in the owner dashboard`) as a diff against `master` (`984225e`). The working tree has
  since been restored to `master`'s `lib/content.ts` byte-for-byte via `git checkout master --
  lib/content.ts`; as of this writing that restore is staged as an uncommitted change relative to
  `3fdeb79` — the contaminated version remains in that commit's history until a follow-up commit
  lands the restore. No further edits to `lib/content.ts` were made as part of this docs pass.
- **Duplicate trip-detail vehicle chip.** An earlier pass of `app/owner/trips/[id]/page.tsx` briefly
  carried two separate renderings of the trip's vehicle identity (a header text line and a
  standalone `VehicleChip`, out of sync with each other). This was merged into a single
  presentation: the header subtitle links to `/owner/vehicles/[id]` and shows the vehicle's
  `displayName`/trim/color plus an inline "Archived" badge when applicable (falling back to plain,
  unlinked `hostConfig.car` text when the trip has no resolvable vehicle) — there is exactly one
  visual representation of "which vehicle," not two competing ones. Note this is a hand-rolled
  `Link`+`Badge` in the page itself, not a reuse of the shared `VehicleChip` component from
  `owner-ui.tsx` (which is used elsewhere, e.g. in `TripTable`) — functionally equivalent, but not
  the same component the earlier wording of this note implied.
- **Seed dependency inversion.** `lib/owner/vehicle-state.ts`'s seed-once logic used to build its
  `veh-01` record inline from `hostConfig.car`, duplicating the field-by-field construction that also
  lived in `lib/owner/mock-data.ts`'s `MOCK_VEHICLE_SEED` — two independent places computing what is
  supposed to be one deterministic value (§4 CONTRACTS' `SEED_EPOCH` note already assumes these
  byte-match). The fix inverted the dependency through a new `lib/owner/vehicle-seed.ts` exporting the
  single `buildSeedVehicle()` construction function (and `SEED_EPOCH`), imported by both
  `vehicle-state.ts`'s store fallback and `mock-data.ts`'s `MOCK_VEHICLE_SEED`, so there is exactly
  one implementation to keep in sync. That file has since landed; `CLAUDE.md`'s `lib/owner/*`
  inventory now lists `vehicle-seed.ts` alongside `vehicle-state.ts`.
- **QA evidence hygiene.** Screenshot evidence from the manual QA pass (§8) lives in-repo at
  `.qa-shots/` (gitignored via `/.qa-shots/` in `.gitignore`, never committed) — covering the
  vehicles list, two-vehicle policy override, archive-blocked-on-sole-active-vehicle, validation
  errors, and mobile layouts. That QA run's notes were truncated before landing and did not enumerate
  the 3 minor issues it found (the three items above: the `lib/content.ts` contamination, the
  duplicate trip-detail chip, and the seed dependency inversion) — none were blocking, but none were
  written down either. Recorded here as an evidence-hygiene miss in the QA process itself: a QA pass
  that finds issues and fixes or defers them must say so in its own notes, not rely on a later audit
  to reconstruct what was found.
