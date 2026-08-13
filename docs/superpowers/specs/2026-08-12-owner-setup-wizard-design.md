# Owner Setup Wizard — Design Spec

Date: 2026-08-12
Branch: `owner-dashboard`
Status: design (no implementation in this commit)

## Context & goals

The mission that started this thread:

> "does the app have proper first time setup and a dedicated owner onboarding flow that links to their Tesla account to grab their vehicles for rent?"

It did not. The owner dashboard (`app/owner/*`) assumed a fleet already existed in `rtr:vehicles:v1` — there was no path for a brand-new host to connect their Tesla account, pull in their vehicles, and land on a working dashboard. Guests get a fully adaptive onboarding flow (`lib/flow.ts`, `components/OnboardingApp.tsx`); owners got nothing equivalent.

This spec adds that flow: a first-run **owner setup wizard** at `/owner/setup` that:

1. Introduces what setup does.
2. Lets the owner connect their Tesla account (mock persona picker or live Fleet API OAuth, mirroring the guest sign-in security posture).
3. Imports the resulting vehicle list into the local fleet store, with per-vehicle opt-in and a dedupe ledger so re-running the wizard is safe.
4. Shows a read-only review of the rental configuration the host already set via `lib/config.ts` / env vars.
5. Confirms completion and hands off to the real dashboard.

The wizard is additive: it does not touch the guest flow's behavior, storage key, or routes, beyond one small `?mode=owner` branch in the reused persona screen that is guaranteed byte-identical for guests.

## Decisions & rationale

**Own `rtr:owner-setup:v1` key — one localStorage key per concern.**
The existing convention (`rtr:state:v1` for guest flow, `rtr:owner:v1` for trip checklists, `rtr:vehicles:v1` for the fleet) is one key per concern, each independently loadable/clearable. Setup progress is its own concern — it tracks *wizard resume position*, not fleet data or trip data — so it gets its own key rather than being folded into `rtr:owner:v1`. `lib/owner/setup-state.ts` is a zero-diff mirror of `lib/owner/owner-state.ts`'s load/save/hydrate/spread-merge pattern (same try/catch-degrade-gracefully shape), just pointed at a different key and shape. Keeping the pattern identical means no new mental model for anyone reading owner-side state code.

**Entry by dismissable card, never a forced redirect.**
An owner with an already-populated fleet (e.g. seeded `veh-01`, or someone who set things up before this wizard existed) must not be interrupted by a mandatory redirect to `/owner/setup` on every visit. `needsSetup()` gates a *prominent but dismissable* card on `/owner`, not a route guard. "Not now" sets `dismissedAt` and the card is gone for good (short of an explicit reset) — same philosophy as the guest flow never trapping a user who wants to skip ahead.

**Owner Tesla connect reuses the guest flow's one-shot-read security posture, with fully separate routes and cookies.**
`lib/tesla-server.ts`'s live-mode design is deliberately narrow: exchange the code, read identity + vehicles once, discard tokens, seal only the profile into an httpOnly cookie. That posture is exactly right for the owner side too — the wizard only ever needs a one-time vehicle list, never ongoing vehicle control. Rather than parameterize the guest routes/cookies, the owner side gets **structural copies**: `app/api/owner/tesla/{login,me,logout}/route.ts` and `app/auth/owner/tesla/callback/route.ts`, writing/reading `rtr_owner_state` (CSRF) and `rtr_owner_tesla` (sealed profile) — never `rtr_state`/`rtr_tesla`. This means a guest session and an owner session on the same browser can never collide, race, or leak into each other's cookie, even though both are Tesla sign-ins happening in the same app. The duplication cost is small (four thin route files) and buys total isolation, which is worth more than DRY here given these are auth-adjacent code paths.

**Mock mode rides the existing persona screen via an additive `?mode=owner` branch that never writes guest state.**
`app/auth/tesla/page.tsx` is already the shared mock consent screen. Rather than build a second persona picker, it grows one conditional branch: when `?mode=owner` is present, `allow(persona)` skips `saveState()` (the guest write) entirely and instead does a plain redirect back to the owner's `return` path with `owner_connected=1&owner_persona=<key>` — the owner hook resolves the persona client-side. `cancel()` in owner mode goes back to `return` instead of the guest cancel target. The guest code path (no `mode` param) is untouched byte-for-byte; this was verified by reading the diff shape before writing it — the branch wraps existing calls, it doesn't restructure them.

**Dedupe ledger keyed by vin-or-tesla-id, so re-runs update instead of duplicate — and mock mode (no VINs) still dedupes.**
Tesla's live API returns a VIN per vehicle; the mock personas do not (`TeslaVehicle.vin` is optional-add, and persona vehicles are seeded without one). If the ledger were VIN-only, mock-mode imports could never dedupe on re-run — every "Import selected" would blindly create new local vehicles. `teslaKeyOf(tv) = tv.vin ?? String(tv.id)` gives every `TeslaVehicle` — mock or live — a stable key, and `importedTeslaIds: Record<key, localVehicleId>` is the ledger. Re-running the wizard against the same account produces the same keys, so the Import step recognizes "already imported" and offers an update path (`mergePreservingOwnerFields`) rather than a duplicate.

**Explicit "Import selected" commit — nothing is written while browsing.**
The Import step's checkboxes only stage a selection; nothing touches `rtr:vehicles:v1` until the owner presses "Import selected". This matches the review step's read-only stance and the general principle that browsing a wizard step must be free of side effects — back/forward navigation, accidental unmounts, or abandoning the wizard mid-step can never leave partial fleet writes behind.

**`teslaProfile` is persisted in setup state so a refresh doesn't lose the connection.**
Once the owner has connected (mock or live), the resulting `TeslaProfile` — the same shape the guest flow already persists — is written into `OwnerSetupState.teslaProfile`. If the owner refreshes mid-wizard (or closes the tab and comes back), `useOwnerSetupState()` rehydrates it from localStorage and the Import step can render immediately without forcing a second OAuth round-trip. This is the same data class the guest flow already stores client-side, so it introduces no new privacy surface.

**Review step is read-only over env-driven `hostConfig`, by construction.**
`lib/config.ts` is explicitly "the ONE file a host edits per car/listing" and is populated from `NEXT_PUBLIC_*` env vars at build/deploy time. The wizard has no server-side write path to env config (and shouldn't grow one — that's a redeploy-time concern, not a runtime one). `ReviewStep.tsx` renders `hostConfig` fields as plain `Card`s with no `<input>` elements at all, each captioned with its source env var and "change it in `.env.local` / your deploy env, then redeploy." This is a structural guarantee, not a UI convention that could regress — there is nothing in the component that could accept edits.

**"All set" (`done`) sets `completedAt` only on an explicit Finish action, not on mount.**
If `DoneStep` set `completedAt` as a mount side effect, a stray render (or the owner arriving at `done` via `goTo` for any reason) would silently mark setup complete. Requiring an explicit "Finish" button click makes completion an intentional, single, traceable action — consistent with "Import selected" being the only fleet-mutating action in the Import step.

## CONTRACTS (verbatim)

```
// ---- additive Tesla edits (the ONLY guest-adjacent changes) ----
// lib/tesla.ts: TeslaVehicle gains vin?: string (optional, non-breaking). Verify personaByKey (or equivalent) is exported; if no such helper exists, add one additively.
// lib/tesla-server.ts: inside fetchVehicles()'s .map(), include the already-in-scope vin local in the returned object literal. ONE-token-scale change; nothing else in this file.
// app/auth/tesla/page.tsx: post-mount, parse ?mode=owner&return=<path> from window.location.search. When mode==="owner": allow(persona) SKIPS the guest saveState() entirely and instead window.location.href = return + "?owner_connected=1&owner_persona=" + persona key; cancel() navigates back to return. Guest path (mode absent) byte-identical. Small "Connecting as the host" caption when owner mode so the reused screen isn't confusing.

// ---- owner-side live OAuth mirror (structural copies of the guest routes; separate cookies; runtime nodejs + force-dynamic) ----
// app/api/owner/tesla/login/route.ts: config = { ...getConfig(), redirectUri: process.env.TESLA_OWNER_REDIRECT_URI ?? "" }; pre-check TESLA_OWNER_REDIRECT_URI itself (assertConfigured's messages name guest vars); CSRF cookie rtr_owner_state; all failure redirects -> /owner/setup?owner_tesla_error=<code>.
// app/auth/owner/tesla/callback/route.ts: verify rtr_owner_state via safeEqual; exchangeCode/fetchProfile with the owner-redirectUri config; seal profile into httpOnly rtr_owner_tesla (same seal()/secret, 1hr); redirect /owner/setup?owner_connected=1.
// app/api/owner/tesla/me/route.ts + app/api/owner/tesla/logout/route.ts: read/clear rtr_owner_tesla; shapes mirror the guest me/logout routes; Cache-Control no-store.
// Security posture inherited: one-shot identity+vehicles read, tokens discarded, scopes stay openid vehicle_device_data, NO offline_access anywhere.

// ---- lib/owner/setup-flow.ts (NEW, pure) ----
export type SetupStepId = "welcome" | "connect" | "import" | "review" | "done";
export const SETUP_STEPS: { id: SetupStepId; title: string }[]  // Welcome / Connect Tesla / Import vehicles / Rental settings / All set
export function indexOfSetupStep(id: SetupStepId): number; export function nextStepId(id: SetupStepId): SetupStepId | null; export function prevStepId(id: SetupStepId): SetupStepId | null;

// ---- lib/owner/setup-state.ts (NEW; key rtr:owner-setup:v1; mirrors owner-state.ts load/save/hydrate/spread-merge exactly) ----
export interface OwnerSetupState {
  version: 1;
  step: SetupStepId;                          // resume pointer
  teslaProfile: TeslaProfile | null;           // owner-side profile (mock persona or live /me result); same data class the guest already persists
  importedTeslaIds: Record<string, string>;    // dedupe ledger: (vin ?? tesla vehicle id) -> local Vehicle id
  completedAt: number | null;
  dismissedAt: number | null;
}
export function needsSetup(s: OwnerSetupState): boolean   // !completedAt && !dismissedAt
export function useOwnerSetupState(): { state, hydrated, update, reset }   // reset clears ONLY this key, never rtr:vehicles:v1

// ---- lib/owner/use-owner-tesla-connect.ts (NEW client hook) ----
// connectHref(): AUTH_MODE mock -> "/auth/tesla?mode=owner&return=/owner/setup"; live -> "/api/owner/tesla/login".
// Mount effect: (a) mock: read owner_connected/owner_persona params, resolve persona -> update setup state teslaProfile, strip params; (b) live: on ?owner_connected=1 fetch /api/owner/tesla/me -> teslaProfile, strip params; (c) surface ?owner_tesla_error=<code> via ownerAuthErrorMessage(code) (owner-phrased copy map colocated here; reuse the guest error-code vocabulary, not its guest-phrased strings).
// useDifferentAccount(): live -> POST /api/owner/tesla/logout; both modes -> teslaProfile = null.

// ---- lib/owner/import-mapping.ts (NEW, pure) ----
export function teslaKeyOf(tv: TeslaVehicle): string                      // tv.vin ?? String(tv.id)
export function vehicleInputFromTesla(tv: TeslaVehicle, fallbackYear: number): VehicleInput
//   displayName tv.displayName?.trim() || "{year} {model}"; trim ""; color ""; shifter via heuristic (Model 3 >=2024 screen; Model Y >=2025 screen; S/X stalk; default screen); vin tv.vin ?? null; plate null; pct null; notes "".
export function mergePreservingOwnerFields(fresh: VehicleInput, existing: Vehicle): VehicleInput   // keep existing trim/color/plate/notes/pct when re-importing

// ---- wizard UI ----
// app/owner/setup/page.tsx (NEW, "use client"): controller mirroring components/OnboardingApp.tsx in miniature — reads useOwnerSetupState post-hydration, renders the step component for state.step, nav { next, back, goTo } persists step. Progress bar + step label. Shell: reuse AppShell from components/ui.tsx if its props fit cleanly (progress, stepLabel, onRestart -> setup reset with confirm); otherwise a minimal centered column reusing the same tokens — decide by reading AppShell, do not modify it.
// components/owner/setup/WelcomeStep.tsx: intro copy (what setup does) + "Get started" + ghost "Skip for now" (sets dismissedAt, router.push /owner).
// components/owner/setup/ConnectStep.tsx: unconnected -> "Connect with Tesla" (connectHref) + ghost "Skip — I'll add vehicles manually" (straight to import); connected -> name + vehicle count + Continue + "Use a different account"; inline error line on owner_tesla_error.
// components/owner/setup/ImportStep.tsx: with teslaProfile: one pre-checked checkbox Card per profile vehicle; vehicles whose teslaKeyOf is already in importedTeslaIds render checked-disabled with "Already imported" Badge; "Import selected" commits via useVehicleState().addVehicle / updateVehicle(mergePreservingOwnerFields) and records the ledger entries; after commit, each imported vehicle shows an inline expandable vehicle-form (mode edit) to optionally complete trim/color/shifter now, with a "finish later on the Vehicles page" note. Without teslaProfile (skipped/0 vehicles): EmptyState + "Add a vehicle manually" (vehicle-form mode create) as primary CTA. Continue always enabled.
// components/owner/setup/ReviewStep.tsx: READ-ONLY Cards for hostConfig contact fields + rental policy + house rules, each captioned with its NEXT_PUBLIC_* env var (or lib/config.ts) source and "change it in .env.local / your deploy env, then redeploy". No inputs.
// components/owner/setup/DoneStep.tsx: summary ("N vehicles in your fleet"), sets completedAt via an explicit "Finish" action (not on mount), buttons -> /owner and /owner/vehicles.
// app/owner/page.tsx (EDIT, additive): when hydrated && needsSetup(setupState): a prominent "Set up your fleet" Card ABOVE the alerts panel — "Start setup" -> /owner/setup, ghost "Not now" -> dismissedAt = now (no navigation). Plus a permanent low-emphasis "Fleet setup" link in the page header row.
// app/owner/vehicles/page.tsx (EDIT, additive): "Import from Tesla" secondary Button -> /owner/setup (works whether or not setup was completed; wizard is idempotent via the ledger).

// ---- env/docs ----
// .env.example: TESLA_OWNER_REDIRECT_URI added (blank) in the live-OAuth section with a comment: second redirect URI for the owner-side connect; must be registered with Tesla (re-run scripts/tesla-setup.mjs register / dashboard) alongside the guest one.
```

## File plan

New:
- `lib/owner/setup-flow.ts`
- `lib/owner/setup-state.ts`
- `lib/owner/use-owner-tesla-connect.ts`
- `lib/owner/import-mapping.ts`
- `app/owner/setup/page.tsx`
- `app/api/owner/tesla/login/route.ts`
- `app/api/owner/tesla/me/route.ts`
- `app/api/owner/tesla/logout/route.ts`
- `app/auth/owner/tesla/callback/route.ts`
- `components/owner/setup/WelcomeStep.tsx`
- `components/owner/setup/ConnectStep.tsx`
- `components/owner/setup/ImportStep.tsx`
- `components/owner/setup/ReviewStep.tsx`
- `components/owner/setup/DoneStep.tsx`

Edited (additive only):
- `lib/tesla.ts` — `TeslaVehicle.vin?: string`; export `personaByKey` (or verify/add equivalent).
- `lib/tesla-server.ts` — one field added inside `fetchVehicles()`'s `.map()` return.
- `app/auth/tesla/page.tsx` — `?mode=owner` branch in `allow()`/`cancel()`; owner caption.
- `app/owner/page.tsx` — setup card + header link.
- `app/owner/vehicles/page.tsx` — "Import from Tesla" button.
- `.env.example` — `TESLA_OWNER_REDIRECT_URI`.

Untouched: `lib/flow.ts`, `components/OnboardingApp.tsx`, `lib/store.ts`, `lib/content.ts`, `lib/config.ts`, all guest API routes, `AppShell` (read-only reference).

## Live-mode runbook

1. Add `TESLA_OWNER_REDIRECT_URI` to `.env.local` (and the deploy environment), e.g. `https://<host>/auth/owner/tesla/callback`. This is deliberately a **second, distinct** URI from the guest `TESLA_REDIRECT_URI` — Tesla's Fleet API partner accounts support multiple registered redirect URIs per app.
2. Register the new URI directly in the Tesla developer dashboard (<https://developer.tesla.com>) — add the owner callback URL there alongside the guest one. `scripts/tesla-setup.mjs register` cannot do this: it only POSTs `{domain}` to `/api/1/partner_accounts` for one-time partner-account registration and has no redirect-URI parameter at all.
3. `scripts/tesla-setup.mjs verify` does not list or confirm redirect URIs either — it only checks that Tesla has the expected partner public key on file for `TESLA_APP_DOMAIN` (`GET /api/1/partner_accounts/public_key`). There is no CLI step to confirm the redirect URI was saved; confirm it visually in the developer dashboard.
4. No new scopes: owner connect uses the same `openid vehicle_device_data` scope pair as guest connect. `offline_access` stays excluded everywhere — the owner flow is a one-shot read, identical in kind to the guest flow's one-shot read, not a standing integration.
5. `rtr_owner_state` / `rtr_owner_tesla` use the same `seal()`/secret mechanism as the guest cookies (same signing key), just different cookie names — no new secret to provision.

## Edge cases

- **0-vehicle Tesla account.** `teslaProfile.vehicles` is `[]`. Import step renders the "no vehicles found" empty state (same visual branch as "skipped connect"), with "Add a vehicle manually" as the CTA. This is a *valid, complete* setup — Continue is still enabled, `completedAt` can still be set at Done. Setup is about walking through the flow once, not about guaranteeing a non-empty fleet.
- **Connect declined / OAuth error.** Live-mode failures redirect to `/owner/setup?owner_tesla_error=<code>`; mock-mode `cancel()` returns to `/owner/setup` with no error param (a plain skip). Either way `ConnectStep` renders inline error copy via `ownerAuthErrorMessage(code)` and both connect options (retry / manual) remain live — never a dead end requiring a full restart.
- **Partial import.** If the owner unchecks some vehicles before "Import selected," only the checked ones get written to `rtr:vehicles:v1` and ledgered. Unchecked ones are simply not present after this run — they can be imported on a later re-run of the wizard (from the Vehicles page's "Import from Tesla" button) with no special resume state needed, since `teslaProfile` is still available.
- **Re-run idempotency.** Running the wizard twice against the same Tesla account: previously-imported vehicles show checked-disabled "Already imported" and are skipped by "Import selected" (or, per the ImportStep contract, participate in `mergePreservingOwnerFields` update semantics rather than being re-created) — no duplicate `Vehicle` rows in the fleet store.
- **Seeded `veh-01` is never auto-merged with an imported Tesla vehicle.** The seed vehicle's `vin` is `null` (it predates this feature and was never Tesla-linked). `mergePreservingOwnerFields`/the ledger key on `vin ?? id`, and a `null` VIN can never equal a real VIN or a mock `id`-derived key, so `veh-01` is structurally unmatchable by the importer — it is left alone, and an import always creates a distinct new vehicle rather than silently overwriting the seed. An owner who wants to consolidate does so manually on the Vehicles page.
- **Browser Back leaves the wizard.** Unlike the guest flow (which mirrors step navigation into `history.pushState` via `useStepHistory`), the owner wizard's `nav.next/back/goTo` only updates `setup-state.ts`'s `step` field — there is no `history-nav.ts` equivalent for `/owner/setup`. Pressing OS/browser Back therefore leaves the wizard route entirely (to whatever page preceded `/owner/setup`) rather than stepping back within the wizard. This is an accepted scope cut: the guest flow's step-level Back/Forward mirroring is worth its complexity for a rental guest who may background the browser mid-checklist; the owner wizard is a short, one-time setup run where reaching for in-app Back/"←" controls is sufficient. `useOwnerSetupState()`'s persisted `step` still means refreshing or navigating back into `/owner/setup` resumes at the right place — only true OS-level Back-within-the-wizard is out of scope.

## QA plan

Mock mode (`NEXT_PUBLIC_TESLA_AUTH_MODE` unset / `mock`):
1. Fresh browser (no localStorage): visit `/owner` → setup card shown, "Fleet setup" header link present.
2. "Start setup" → Welcome → "Get started" → Connect step.
3. "Connect with Tesla" → persona screen shows "Connecting as the host" caption → pick a persona → redirected to `/owner/setup?owner_connected=1&owner_persona=<key>` → params strip, ConnectStep shows name + vehicle count.
4. Continue → Import step: all persona vehicles pre-checked → uncheck one → "Import selected" → confirm only checked vehicles land in `/owner/vehicles`; ledger recorded (inspect `rtr:owner-setup:v1` in devtools).
5. Continue → Review step: confirm every field is non-editable and captioned with its env source.
6. Continue → Done: vehicle count matches; "Finish" sets `completedAt`; confirm setup card no longer appears on `/owner` after finishing.
7. Re-run via "Import from Tesla" on `/owner/vehicles`: previously-imported vehicle shows "Already imported" checked-disabled; import the previously-unchecked one; confirm no duplicates in the fleet.
8. Skip path: fresh state → Welcome → "Skip for now" → confirm `dismissedAt` set, redirected to `/owner`, card gone; confirm `rtr:vehicles:v1` untouched.
9. Connect-skip path: Connect step → "Skip — I'll add vehicles manually" → Import step empty state → "Add a vehicle manually" opens vehicle-form create.
10. Reset: trigger `onRestart` from the wizard shell, confirm only `rtr:owner-setup:v1` clears — `rtr:vehicles:v1` and `rtr:owner:v1` untouched.
11. Cancel from persona screen in owner mode → returns to `/owner/setup`, no error param, no guest `rtr:state:v1` write occurred (compare localStorage before/after).
12. Confirm the guest flow (`/`, no `mode` param) is pixel/behavior-identical before and after this change — sign-in, persona pick, cancel all unaffected.

Live mode (requires `.env.local` with `TESLA_OWNER_REDIRECT_URI` registered):
13. `/api/owner/tesla/login` → Tesla consent → callback → `rtr_owner_state` verified via `safeEqual`, `rtr_owner_tesla` sealed cookie set, redirect to `/owner/setup?owner_connected=1`.
14. `/api/owner/tesla/me` returns the sealed profile; confirm `Cache-Control: no-store`.
15. "Use a different account" → `/api/owner/tesla/logout` clears `rtr_owner_tesla`; confirm `teslaProfile` resets client-side.
16. Tamper with `rtr_owner_state` cookie or CSRF param → confirm failure redirects to `/owner/setup?owner_tesla_error=<code>` with no cookie set.
17. Confirm no `offline_access` scope is requested and tokens are not persisted anywhere (network tab / server logs).
18. Confirm guest live-mode routes (`/api/tesla/*`, `/auth/tesla/callback`) are unaffected — separate cookies, separate code paths.

## Post-audit remediation

A security/correctness audit of the initial implementation surfaced several gaps. All of the following are landed in the same commit this addendum ships in — the prior run left the wizard implemented but uncommitted; that is no longer the case.

- **Open-redirect hardening on the mock `?mode=owner&return=<path>` branch.** `return` is attacker-influenceable query input reflected into a client-side `window.location.href` redirect. `isSafeReturnPath` now rejects control characters (which browsers/servers can strip or reinterpret to smuggle a `javascript:`/`//host` payload past a naive prefix check) in addition to the existing same-origin-path checks, and normalizes the URL before validating it so encoded traversal (`%2F%2F`, backslashes, etc.) can't slip past the check and then get decoded differently downstream.
- **Owner OAuth mirror brought inside the middleware auth matcher.** `app/api/owner/tesla/{login,me,logout}/route.ts` and `app/auth/owner/tesla/callback/route.ts` were previously reachable outside `middleware.ts`'s matcher, meaning the Supabase owner-auth gate (when configured) didn't cover them. The matcher now includes these routes so an unauthenticated visitor can't drive the owner-side Tesla OAuth dance (and mint/read the sealed `rtr_owner_tesla` cookie) without first passing the owner login gate.
- **`seal()` gained AAD (additional authenticated data) context binding.** The sealed-cookie helper now binds a context string (e.g. which cookie/purpose it's for) into the AES-GCM AAD, so a sealed value produced for one purpose (or one cookie name) can't be replayed/swapped into another — closing a class of cross-cookie confusion between the guest (`rtr_tesla`) and owner (`rtr_owner_tesla`) sealed profiles that share the same signing key.
- **Idempotent re-import via `teslaImportKey`, surviving "Start over" in every mode.** The dedupe ledger now keys off a stable `teslaImportKey(tv)` (the same `vin ?? tesla vehicle id` derivation as `teslaKeyOf`, promoted into `import-mapping.ts` as the canonical dedupe key used by both the ledger and the vehicle record itself) so an import is recognized as "already imported" even after the wizard's own state (`rtr:owner-setup:v1`) has been reset via "Start over" — resume state can be wiped without losing dedupe, because the signal now lives on the vehicle record in `rtr:vehicles:v1`, not only in the ledger. This also covers **archived-restore**: if a previously-imported vehicle was archived (not deleted — see the "Removal is archive-not-delete" rule), re-running import against the same Tesla account recognizes the archived vehicle by `teslaImportKey` and offers to restore/update it in place rather than creating a second, duplicate vehicle alongside the archived one.
- **`ImportStep` empty-state gating fixed.** The empty state still gates on the raw `teslaProfile.vehicles.length === 0` (an account with zero vehicles on the Tesla side, or no connected account at all), but that's now correct by construction: since re-import matches existing/archived vehicles by `teslaImportKey` (see above) rather than by list length, an account whose only vehicle is already imported has `vehicles.length === 1 > 0` and correctly falls through to the picker, which renders it as "Already imported" instead of hitting the empty state.
- **Param-safe redirect building.** Redirect URLs constructed from route handlers (owner OAuth error redirects, the mock persona screen's `return` handoff, etc.) are now built via `URL`/`URLSearchParams` rather than manual string concatenation, eliminating a class of malformed or injectable query strings when a value (persona key, error code) contains characters that need escaping.



- Editing env config (`hostConfig` / `NEXT_PUBLIC_*` vars) from the wizard — Review step stays read-only by construction; env changes remain a redeploy-time action.
- Owner telemetry / live vehicle-control scopes (`vehicle_cmds`, `vehicle_charging_cmds`, etc.) — the wizard only ever requests `openid vehicle_device_data`, matching the guest flow's read-only posture. Granting control scopes to the owner dashboard is a separate, larger feature.
- A guided tour of the dashboard itself (alerts panel, per-vehicle detail, trip checklists) — `DoneStep` hands off to `/owner` and `/owner/vehicles` but does not add any dashboard-side tour/tooltip UI.
