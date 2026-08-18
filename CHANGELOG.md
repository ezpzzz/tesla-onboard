# Changelog

## 0.10.2 — 2026-08-18

- Fix telemetry copy honesty: correct an inverted sentence that claimed telemetry would never start even after operator setup, and a lowercase sentence fragment that had been appended after a full stop. The status strip and the live-state card now derive from one shared cause so they can never contradict each other, and neither offers an action the other says will not help.
- Make deployment-config errors (telemetry proxy or region base URL not configured) reclaimable: previously they were written with a retry interval but excluded from the worker's claim predicate entirely, so they were stranded forever.
- Add a single source of truth for deployment-config error codes (`TELEMETRY_DEPLOYMENT_CONFIG_ERROR_CODES`, `lib/owner/telemetry-policy.ts`), plus a guard test that reads the migration SQL from disk and fails on any drift between it and the TypeScript constant.
- Align with Tesla's official Fleet API docs after an audit: an active enrollment now polls its telemetry config every 12 hours instead of every 5 minutes, removing ~288 billable calls/day/vehicle -- exceeding the account billing limit removes fleet telemetry configurations and Tesla does not restore them.
- Honor Tesla's four distinct skipped-vehicle reasons: a car that merely needs its virtual key paired is retried instead of being parked for 365 days as unsupported hardware, and unrecognized future reasons fail safe (finite retry, honest copy) instead of being mislabeled as unsupported firmware.
- Send telemetry GET and DELETE directly to the regional Fleet API instead of through the vehicle-command proxy, which only the signed configure call requires -- a disconnect now completes on a deployment with no proxy at all.
- Correct the owner-facing firmware floor from 2023.20.6 (the legacy CSR-path value) to 2024.26 (the proxy-signed path this app uses), including the go/no-go gate doc.
- Fix a duplicate migration version prefix that made the repo impossible to replay from an empty database, plus a guard test against recurrence.

## 0.10.1 — 2026-08-18

- Fix Tesla integrations that could get stuck in "Disconnecting" forever: a new admin-gated `force_complete_onlyevs_integration_disconnect` recovery RPC finishes a transition that was never claimed by the worker, with its own audit trail row. The Integrations page now polls while an integration is in a transitional state, detects a disconnect that's been stale for 15 minutes, and offers a Force disconnect action to recover it.
- Make telemetry enrollment errors honest: an error like `telemetry_proxy_not_configured` now says plainly that the telemetry service needs operator configuration, instead of copy that implied it would auto-start.
- Cap the worker's telemetry removal retries (`TELEMETRY_REMOVAL_MAX_ATTEMPTS`) so a disconnect can never spin forever, while still preserving the `telemetry_removal_unconfirmed` marker and its audit event so the unresolved state stays visible rather than silently dropped.
- Deflake the date-anchored telemetry-bookend tests.

### For contributors

- No new dependencies.
- Migration `20260818150000_onlyevs_integration_disconnect_recovery.sql` is standalone-additive and independently applicable.

## 0.10.0 — 2026-08-17

- Add Workspace Mail: a full-content, per-workspace Turo email inbox (`/owner/mail`) so a manager reads, searches, and shares the team's captured Turo mail from inside the app instead of Gmail. Full HTML renders inside a `sandbox=""` iframe (no `allow-scripts`, ever) behind a strict inner CSP, with a client-side `DOMParser` strip pass as a genuine second layer -- zero script execution and zero third-party egress by default; `cid:` images arrive inlined as `data:` payloads from the decrypt-on-read response, oversized ones render an honest inert placeholder with a download link through the authed attachment route instead of inlining, and remote images load only on an explicit per-message opt-in.
- Extract and store attachments as their own encrypted R2 objects (at parse for new mail, and via a standing reconciler for already-captured mail), with an authed, streamed, `Cache-Control: no-store` download route.
- Add first-class deletion: message-, reservation-, and guest-scoped purge actions remove every body copy in one action -- the R2 envelope and attachment objects, the search-index row, and the pre-existing plaintext copy already living in `onlyevs_email_candidates.proposed_state` -- each with an audit row, and `Cache-Control: no-store` on every read route so a cached response can't survive a purge. Retention is config-driven per workspace (default: keep forever) rather than a blanket bucket TTL.
- Add per-user read receipts (audit-visible to workspace managers) and raw-header trust chips (DKIM/SPF/DMARC pass, Turo-domain alignment) on each message.
- Cross-link candidate cards and trip pages to their full email ("View full email"), and vice versa.
- Ships entirely dark: no MX/R2/worker/flag mutation, all `ONLYEVS_EMAIL_*` flags stay default-false, and every surface renders an honest empty state with zero real mail.
- Remediation wave (post-audit): unify the attachment-envelope AAD into a single shared `lib/email/mail-attachment-aad.ts` builder imported by both the worker's write path and every read call site, closing a decrypt-mismatch blocker; make the retention sweep run the full purge machinery (R2 envelope + attachments + search-index row + `onlyevs_email_candidates.proposed_state` scrub), not just an R2/index delete; add the missing `/owner/mail` navigation entry (desktop sidebar and mobile tab bar); fix scale-to-fit on the sandboxed message renderer, which never fired on first paint; and add a full-email expander to inbox candidate cards so confirm/dismiss decisions can be made against the complete message. Expanded hostile-fixture coverage accompanies the fixes.

### For contributors

- No new dependencies in owner-app code; `postal-mime` in `services/onlyevs-worker` is a service-tier exception (parses attachment parts only, already the sibling email-ingest worker's own dependency).
- Migrations `20260817140000_onlyevs_workspace_mail.sql`, `20260817160000_onlyevs_workspace_mail_read_rpcs.sql`, `20260817170000_onlyevs_workspace_mail_crosslinks.sql`, and `20260817190000_onlyevs_workspace_mail_remote_images.sql` are additive and ship dark alongside the rest of the email-ingest ladder.
- Pre-landing review fixes: the DB-side purge RPCs now enqueue a `purge` outbox job in the same transaction as their audit row, and the worker's purge executor actually deletes the R2 objects the manager was told were deleted (previously wired but never dispatched); reservation-/guest-scoped purge target resolution no longer depends on a message already having a search-index row, closing a window where a message captured moments before a deletion request could be silently skipped; the cid-image renderer allowlists attachment `content_type` before splicing it into a `data:` URL, and the DOMParser strip pass now also covers `xlink:href`/`background`/`poster`; attachment R2 object keys are now derived from content hash rather than a fresh random id per call, so a crash-retry can't orphan a duplicate encrypted object; and the per-message remote-image opt-in is now actually persisted per message per workspace, matching the design's stated default, instead of resetting on every navigation.
- Added a pgTAP case exercising reservation-scoped purge against a captured-but-not-yet-indexed message, and new migration-security text-level checks for the remote-images RPCs.

## 0.9.0 — 2026-08-17

- Rebuild the vehicle details page around a live evidence ledger: a live-state card with per-field freshness, a cold-start setup status strip, an active-trip card with a location-evidence row, and a 13-month history ledger (lifetime tiles, a kWh-only Energy tile, desktop table / mobile two-line tap-through rows, aria-labeled bucketed health charts) -- every degraded or cold-start state now renders distinctly instead of a blank screen or a generic spinner.
- Capture odometer and battery at trip start and end ("bookends"): the end bookend keeps tracking a late return for up to 24 hours past the scheduled end so the extra miles land in the delta instead of freezing early, each field carries its own 30-minute freshness window before it's shown as stale, and a reading that never arrived or fell outside that window renders an honest partial state rather than a guessed number.
- Roll up each trip's miles driven and energy added, and derive charging sessions from the raw telemetry stream -- a session closes on a non-charging state or a 30-minute signal gap, with sessions that span the gap flagged `gapAffected` rather than silently merged or split. Segmentation now runs server-side in a hardened `public.get_onlyevs_charge_sessions` RPC (window functions, a 13-month clamp, a 2,000-row cap), with the client keeping only the invoice/manual-cost precedence merge on top.
- Attribute charging cost honestly: owners set a private $/kWh home-charging rate (its own settings section, saved separately, never published to guests), DC-fast sessions reconcile against real Tesla charging-history invoices pulled via the newly re-consented `vehicle_charging_cmds` scope, and any session can take a manual owner override -- precedence is always manual > invoice > rate, and a session with no cost source at all shows kWh only rather than a guessed price. Energy tiles show kWh everywhere on this page, never a dollar figure.
- Surface versioned, immutable trip evidence packets in the owner Inbox: miles driven vs. the rental's mileage allowance, battery returned vs. policy, and an out-of-area occurrence count -- coordinates are never included, and a corrected packet lands as a new version rather than an edit, so nothing already delivered is silently rewritten.
- Give guests a durable identity across bookings: exact-key linking (deliberately never fuzzy -- an unstable key only ever splits a record, never wrongly merges one) attaches a trip to an existing guest or creates a new one, and owners get a manual merge tool with named consequences for the rare split, backed by an atomic, advisory-locked `private.link_onlyevs_trip_to_guest` RPC.
- Add a trip-scoped location-evidence read: workspace-allowlisted, gated on an active and consented trip window, and limited to evidence states -- current position, out-of-area, last-known-at -- with no history or breadcrumb endpoint at all, and the underlying data encrypted end to end.
- Add home-area and battery-capacity vehicle settings, including a one-shot "use car's current location" read that may briefly wake the car -- a deliberate, owner-initiated, one-time cost, not a recurring poll -- to seed the home-area center.
- Publish the Phase 0 evidence-gate document (`docs/rollouts/2026-08-17-vehicle-telemetry-go-no-go.md`), gating this feature's UI from master until the self-hosted telemetry collector/Kafka pipeline, Fleet API billing, and the charging-history endpoint are each verified against real Tesla evidence -- mirroring the rigor of the email-ingest rollout doc.
- Fix a pre-existing double-SSR bug where the root layout's Suspense fallback reused `children`, silently double-rendering every `/owner` page into duplicate shells and duplicate account menus; the fallback is now `null`.
- Fix owner navigation flashing back to a loading state on route changes that had already resolved a tenant earlier in the same tab, by caching the resolved tenant per route and adopting it synchronously before the browser paints.
- Harden the release for production trust: manager cost-override rows now pin `created_by` to the acting owner at the database level; the owner-data snapshot cache is fail-closed (cleared on any fetch failure) and capped so it can't grow unbounded; owner-facing "Saved" confirmations are now verified against actual RLS-permitted row counts at three save sites instead of assumed on a successful call; the location write path applies the same consent/grant-status filter the read path already enforced; a single bad Kafka message can no longer stall the telemetry worker for every vehicle behind it; and the charging-history client drops -- never fabricates as a $0 or zero-duration invoice -- any row with a negative cost/kWh or an end time before its start time.
- Guard every new owner surface (vehicle form, guest roster, cost-rate setting, evidence-packet queue, guest-linking) against running without Supabase configured, so demo mode keeps working end to end on all of them.
- Add a one-minute cooldown to the vehicle-details "locate" setup action: it's a billable, potentially car-waking Tesla read, and an impatient double-click (or a scripted retry) could previously fire it back-to-back with nothing standing in the way.
- Stop auto-pricing gap-affected home charging sessions: when a session's kWh estimate spans a signal gap of 30 minutes or more, it may really be two sessions with driving in between, so the rate-based cost step now declines to guess and the session shows kWh only until a real invoice or a manual owner entry prices it. Manual and invoice pricing are unaffected and still take precedence as before.
- Fix charging-invoice matching to pick each invoice's best-overlapping session instead of the first one found, and to sum multiple invoices that land on the same telemetry-derived session (e.g. two Supercharger stops the stream merged into one) rather than dropping the second invoice into the unmatched pile.
- Add defensive pagination to the Tesla charging-history sync so a vehicle's full charging invoice history is fetched across pages (bounded, with per-page dedup and a hard page cap) instead of only ever reading the first page; pair it with a stable invoice identity so re-syncing the same history never double-counts a session.
- Enforce the retention promise already stamped on telemetry rows: an hourly sweep now actually deletes vehicle history past its 13-month retention window and location points past their 30-day window, batched to stay cheap, instead of `delete_after` sitting unenforced.
- Remove unused guest-linking code paths (`linkTripToGuest`, `backfillGuestLinksByEmailHash`, `mergeGuests`, `planGuestReSplit`, and related types) that had no production caller -- the durable `link_onlyevs_trip_to_guest`/`merge_onlyevs_guests` RPCs and the migration's own backfill block are what actually run today.
- Fix a same-tab tenant switch (no route change) briefly repainting the previous tenant's stale branding/config for a beat before catching up.
- Fix an owner-dashboard/guest-flow Tesla-auth-mode mismatch: an unset `NEXT_PUBLIC_TESLA_AUTH_MODE` outside production now consistently reads as mock in both places, instead of the owner dashboard reporting Tesla as unconfigured (hiding "Import Tesla fleet") while the guest flow ran against mock Tesla underneath it.

### For contributors

- No new dependencies.
- Migration `20260817090000_onlyevs_vehicle_telemetry_ledger.sql` is additive and intentionally left unapplied pending the Phase 0 go/no-go gates it depends on.
- Keep the SQL (`public.get_onlyevs_charge_sessions`) and TypeScript (`lib/owner/charge-sessions.ts`) charge-session segmentation implementations in lockstep -- the RPC's window-function logic must keep mirroring the client's segmentation rules exactly.
- Added roughly 85 net tests, including two coverage-audit regression e2e specs (single-shell SSR, kWh-not-dollars Energy tile), plus follow-on unit/contract coverage for the cooldown, gap-affected pricing guard, best-overlap invoice matching, defensive pagination, and retention sweep.
- Telemetry thresholds -- freshness windows, the charge-session gap rule, history retention, charging-sync intervals, and the new locate-setup cooldown -- are centralized in `lib/owner/telemetry-policy.ts` rather than scattered across call sites.
- Reconciled the fleet-stats regression suite with master's cancelled-trip status bucket after merging master into this branch, so the two branches' test expectations agree.
- Added a live-database pgTAP suite for the new migration (`supabase/tests/onlyevs_vehicle_telemetry_ledger.pgtap.sql`, 50 assertions): RLS scoping and denial across the worker-only telemetry/evidence/guest tables, CHECK-constraint boundaries, and `merge_onlyevs_guests`/`get_onlyevs_charge_sessions` authorization and behavior -- alongside the existing text-level checks, not replacing them.

## 0.8.1 — 2026-08-16

- Approved hardening trio for `onlyevs_email_actions` and the Turo sender check (`/autoplan`-reviewed, dual-voice eng review; principal accepted). No behavior change to the live Confirm path -- purely defense-in-depth plus a real sender-spoofing gap close.
  - New additive migration `20260816180000_onlyevs_email_action_hardening.sql` adds two `CHECK` constraints on `public.onlyevs_email_actions`: `onlyevs_email_actions_capability_action_binding` binds `capability_name` to `action_type` exactly per `confirm_onlyevs_email_candidate`'s existing mapping (`create_trip`=`create`, `apply_update`=`pretrip`, `deliver_link` in `(pretrip, active_safe)`, every destructive `action_type`=`active_destructive`), and `onlyevs_email_actions_destructive_brake_scoped` makes `brake_deadline` mandatory for a destructive action once it passes the owner-alert-acceptance boundary (`revocation_pending`/`provider_mutating`/`db_committing`/`succeeded`) -- deliberately state-scoped, not a blanket per-`action_type` check, so the legitimate `awaiting_owner_alert` window (brake not yet started, announce-then-brake) stays unaffected. Both constraints verified directly against a scratch Postgres instance (no supabase CLI project exists in this repo to run pgTAP against locally) covering every `action_type`/`capability_name`/state combination before being added to the pgTAP suite.
  - `lib/email/turo-parser.ts`: the `sender_auth_unverified` blocker now clears only when `receiverAuth.dmarc === "pass"` **and** the visible From-header domain is `turo.com` or a `turo.com` subdomain -- a DMARC pass alone (without checking *which* domain it aligned to) previously cleared the blocker for any DMARC-passing sender, not only Turo's. DKIM `d=` domain binding is deferred (`NormalizedEmailManifest` only carries the boolean DKIM verdict, not the `d=` value) until a real Cloudflare-origin `Authentication-Results` sample is captured; see the `TODO(sender-auth)` left in place.
- Docs: `docs/rollouts/2026-08-16-email-ingest-rollout.md` steps 10-13 (the four `ONLYEVS_EMAIL_AUTO_*` flag-flip steps) marked **RETIRED** per the 2026-08-16 Review-as-strategy decision -- destructive and non-destructive apply actions are standing-policy human-reviewed via manual Confirm with priority owner alerts, not a ladder toward automatic triggering; the gates stay `false` as policy, reassessed only if an on-call capability exists or measured owner-alert ack latency is sustained under 10 minutes. Also fixes a stale §6 line claiming "no app-layer executor" (the executor has existed since PR #25, as the manual Confirm path -- auto-trigger is deliberately unwired, not merely unbuilt), and notes the ToS counsel memo backing gate 4's sign-off is adopted as-draft pending the principal's own live ToS capture.

### For contributors

- All four `ONLYEVS_EMAIL_AUTO_*` gates remain `false` everywhere; nothing in this release flips a gate. No new dependencies.
- New pgTAP coverage in `supabase/tests/onlyevs_email_action_lifecycle.pgtap.sql`: a direct `INSERT` proving the capability-binding constraint rejects a mismatched pair, a restated assertion that the existing manual Confirm cancel_trip scenario still reaches `succeeded` with `brake_deadline` populated, and a paired `UPDATE` negative/positive pair proving the brake-scoped constraint rejects (and then accepts, once `brake_deadline` is set in the same statement) the `awaiting_owner_alert -> revocation_pending` transition.
- New vitest coverage in `lib/email/turo-parser.test.ts` for the domain-binding change: a DMARC-pass message from a non-`turo.com` (and a lookalike-substring) domain still blocks, a `turo.com` From with DMARC not-pass still blocks, a bare (non display-name) and a mixed-case `turo.com`-subdomain address both clear, and all 6 legitimate event-type template shapes (booking/change/cancellation/guest_message/noise/unknown) continue to clear the blocker as a regression check.

## 0.8.0 — 2026-08-16

- Add owner-facing cancellation for manual (and calendar-confirmed) trips. New manager-gated `public.cancel_onlyevs_trip(p_trip_id, p_reason)` RPC (`20260816170000_onlyevs_manual_trip_cancellation.sql`) -- neither existing cancel-capable path fit an owner-invoked action on a manual trip (`resolve_onlyevs_calendar_candidate_change`'s cancel branch only accepts a calendar candidate already in `needs_review`; the email pipeline's `cancel_trip` saga step is only reachable from the dark, `ONLYEVS_EMAIL_AUTO_*`-gated auto-pipeline). The new RPC flips `status` to `cancelled`, stamps the new `cancelled_at`/`cancellation_reason` columns, bumps `schedule_version`/`revision`, and defensively nudges any `onlyevs_access_grants` row toward revocation via the existing worker-claim pattern (manual trips normally have none). It never deletes the trip row -- history is preserved, mirroring the vehicle archive-not-delete rule -- and is idempotent: cancelling an already-cancelled trip is a benign no-op.
- `POST /api/owner/trips/[id]/cancel` (optional `{ reason }` body, persisted to the new column) follows the existing owner-route pattern exactly: same-origin check, `createClient()` session auth, RPC error-message mapping to 404/403/409.
- Owner UI: a "Cancel trip" action on the trip detail page, visible only while a trip is upcoming or active, with the same two-step confirm idiom as the vehicle "Remove from fleet" control (confirm/cancel buttons, focus preservation, named consequences -- guest link stops working, Tesla access is revoked, trip stays in history). Cancelled trips, previously silently dropped by `ownerTripStatus()` (research finding: `status === "cancelled"` mapped to `null` and was filtered out before ever reaching the dashboard), now surface with a "Cancelled" status chip and their own filter tab on `/owner/trips`; reminder-eligibility checks across the trip list/detail views were updated alongside so a cancelled trip no longer offers a reminder button that the reminder RPC would refuse anyway.
- Guest link fail-closed (verified, not new work): `get_onlyevs_trip_invitation`'s `where t.status not in ('cancelled', 'conflict')` clause already means a cancelled trip's `/trip/<token>` resolves to no row, and the guest portal layout already calls `notFound()` on a null snapshot -- confirmed with a new test at the seam `loadGuestTripPortal` actually controls.

### For contributors

- Keep every `ONLYEVS_EMAIL_AUTO_*` gate default-false; no gate flips as part of this release. No new dependencies.
- The action-visibility logic for "Cancel trip" is pulled into a pure predicate, `isTripCancellable` (`lib/owner/derive.ts`), specifically so it's unit-testable: the repo has no jsdom/`@testing-library` (`vitest.config.ts`'s `test.environment` is `node`, and `include` only covers `.ts`, not `.tsx`), so this is the closest available seam to a UI render-by-state test rather than a real component render.

## 0.7.3 — 2026-08-16

- Add forward-first delivery to the email-ingest Worker (`services/email-ingest-worker/src/index.ts`): mail to a valid workspace alias is forwarded to the owner's personal inbox *before* the capture pipeline runs, so delivery fails open even when capture is down, while automation stays fail-closed. Handler order is now intake-gate -> alias verification (unchanged spam gate for the catch-all -- invalid aliases are still rejected before any forward is attempted) -> forward (if configured, wrapped in its own try/catch so a forward failure, e.g. an unverified destination, never blocks capture) -> capture. A capture failure after a successful forward is now accepted (logged via `console.error` with a stable phase tag, no `setReject`) rather than bounced, since the human already received the mail; only the case where both forward and capture fail still rejects, as before.
- New optional Worker env var `EVHOST_EMAIL_FORWARD_TO` (`wrangler.jsonc`, default `""` = forwarding disabled). Deliberately independent of the authorize/DB capture path and of the `ONLYEVS_EMAIL_AUTO_*` automation gates.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- New workerd-runtime coverage in `services/email-ingest-worker/workerd-tests/test/email-handler.workers.spec.ts` for all forward/capture success/failure combinations, plus confirmation that an invalid alias still rejects without ever calling `message.forward()`.

## 0.7.2 — 2026-08-16

- Fix the internal Turo email capture routes (`/api/internal/turo-email/{authorize,capture}`) and the SendGrid delivery-event webhook (`/api/internal/sendgrid/events`) 401/400-ing on every request in production: they authenticated via `createServiceRoleClient()`, which requires `SUPABASE_SERVICE_ROLE_KEY` -- correctly absent from the web deployment under the repo's "the web app never uses a service-role key" invariant. They now connect through a dedicated, narrow Postgres role, `onlyevs_email_capture_svc` (new migration `20260816160000_onlyevs_email_capture_role.sql`), granted `EXECUTE` on exactly the five RPCs those routes call and nothing else, over a direct connection (`ONLYEVS_EMAIL_CAPTURE_DATABASE_URL`) through the Supabase pooler -- the same scoped-role shape `onlyevs_worker` already uses. The service-role key remains banned from the web app; `createServiceRoleClient()` is untouched and still used solely by the owner trip-reminder route, which this fix does not change.
- Shorten workspace email aliases further, to a Turo-compatible shape: a 15-char base32 token + "." + an 8-char base32 signature (24-octet local-part, 40-octet address total). The 0.7.1 fix below shortened the alias enough to clear RFC 5321's 64-octet hard limit but not enough to clear a real Turo-forwarding validator that rejects addresses well under that limit; there is no confirmed exact ceiling (the validator isn't publicly documented and could not be probed live), so this format buys margin by shrinking aggressively rather than chasing a "discovered" number. The token switches from hex to base32 (reusing the signature's existing `lowerBase32Prefix` encoding) so every character carries 5 bits instead of hex's 4, buying local-part length without drawing extra random bytes. Both `verifyWorkspaceAlias` (app) and `verifyAlias` (Worker) now check token/signature length exactly instead of merely requiring non-empty halves, so alias sizing is a coordinated app+Worker deploy going forward, not an independent one. See the rewritten sizing/threat-model comment on `EMAIL_ALIAS_TOKEN_CHARS`/`EMAIL_ALIAS_SIGNATURE_CHARS` in `packages/email-ingest-contract/src/index.ts` for why this format deliberately does not clear a >=120-bit guessing floor (HMAC unforgeability + SMTP-rate-limited guessing + Review-mode fingerprint/authorize gating is the real guarantee) -- do not re-inflate the signature length to chase that figure again.
- Fix a manifest bug where the Worker's `aliasId` was computed from the last 8 characters of the *whole* local part (`token.signature`) instead of the token half, same as the app's `aliasHint`. At the new 8-char signature length this made `aliasId` equal the entire HMAC signature and put it in a manifest; it now reads `localPart.split(".")[0].slice(-8)`, matching `aliasHint` exactly.
- Add `20260816160001_onlyevs_email_alias_format.sql` (renamed 2026-08-18 from `20260816160000` to resolve a duplicate version prefix with `20260816160000_onlyevs_email_capture_role.sql` that broke `supabase db reset`; prod, which applied these two under different timestamps, is unaffected), tightening `onlyevs_email_integrations.alias_address`'s check constraint to the new fixed 15/8-char shape (the previous 20-64/16-86 char-range constraint from `20260816003000` accepted the old format but rejects every alias the new code mints). The migration nulls any stored address that doesn't already match the new shape before adding the stricter constraint, since `ADD CONSTRAINT` validates existing rows.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- New env var: `ONLYEVS_EMAIL_CAPTURE_DATABASE_URL` (see `.env.example`). Provision the `onlyevs_email_capture_svc` LOGIN role out-of-band (this migration creates the NOLOGIN privilege group only, no password) the same way `ONLYEVS_WORKER_DATABASE_URL`'s role is provisioned, and grant it `onlyevs_email_capture_svc` membership.
- Known separate issue, intentionally not touched here: `app/api/owner/trips/[id]/reminder/route.ts` also calls `createServiceRoleClient()` (for `get_onlyevs_trip_reminder_material`, defined in the unrelated `20260815190000_evhost_guest_portal.sql` migration) and is therefore equally broken in any production environment missing `SUPABASE_SERVICE_ROLE_KEY`. It's a different subsystem (guest-portal trip reminders, gated by `EVHOST_REMINDERS_ENABLED`) from the Turo email pipeline this release fixes, so it ships separately.
- Fix the workerd runtime test for the disabled-intake path: it previously asserted the committed `wrangler.jsonc` value of `EVHOST_EMAIL_INGEST_ENABLED` was `"false"`, which broke once PR #27's authorized go-live flipped that var to `"true"` on master. The test now pins the fail-closed behavior via an explicit per-test env override (`EVHOST_EMAIL_INGEST_ENABLED: "false"`) instead of relying on the committed default, plus a new twin assertion that `"true"` proceeds past the gate — so the test asserts gate *behavior*, not deployment state.
- Deploy order for this alias-format change is mandatory: (1) `email-ingest-worker` ships with the new contract, (2) the Next app ships, (3) the `20260816160001` migration runs, (4) the owner re-mints via the integration's existing Rotate action. The one existing alias (already dead on arrival per 0.7.1's note below) is nulled by step 3 regardless.
- **Correction to the 0.7.1 entry below**: it described the format it shipped as "26-char token + signature, 21-char signature (48 octets total)" -- that text was stale at the moment it was written. The format 0.7.1 actually shipped (and this release replaces) was a 26-char token + "." + 25-char signature, 52 octets total, with >= 96/125-bit entropy floors. The corrected numbers are reflected in the 0.7.1 entry text below; this note exists so the discrepancy itself is part of the record.

## 0.7.1 — 2026-08-16

- Fix workspace email aliases minted by `createWorkspaceAlias` being RFC 5321-overlong (69-octet local-part: 36-char token + "." + 32-char signature) and therefore undeliverable -- Cloudflare's inbound MX rejected RCPT TO with "500 5.5.2 ... Invalid email user" before the email worker ever ran, so no mintable alias had ever actually delivered mail. The local-part format is shortened to 26-char token + "." + 25-char signature (52 octets total, comfortably under the 64-octet hard limit) while keeping the same HMAC keyring scheme, `token.signature` structure, and >= 96/120-bit entropy floors -- see the sizing comment on `EMAIL_ALIAS_TOKEN_BYTES`/`EMAIL_ALIAS_SIGNATURE_CHARS` in `packages/email-ingest-contract/src/index.ts`.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- There is no backward-compat constraint on the alias format: no alias minted before this fix could ever have been delivered, so nothing depends on the old 69-octet shape. The one existing prod integration record (minted under the old, undeliverable format) must be rotated after this ships -- use the integration's existing "rotate" action.

## 0.7.0 — 2026-08-16

- Add the Turo email action executor: a manager-authenticated confirm/abort saga for booking, change, and cancellation candidates, with a 30-minute destructive-action brake before any provider-facing revoke proceeds. Still fully dark — automation stays behind the default-false `ONLYEVS_EMAIL_WORKER_ENABLED` and `ONLYEVS_EMAIL_AUTO_*` gates end to end; confirm/abort remain manual owner actions.
- Enrich parsed Turo emails with guest avatar/phone/message, vehicle name/year, DST-aware pickup-address and trip-window facts, surfaced in the owner Inbox with a live countdown/Abort control for in-flight destructive actions and a real Confirm action for pending candidates. Trip-window resolution needs an IANA timezone; the worker now sources it from the workspace's linked Google Calendar integration when one is connected, and otherwise blocks the candidate on `trip_timezone_unresolved` rather than guessing.
- Add Workers-runtime test coverage for the email-ingest handler running inside Miniflare/workerd against a real R2 binding, and close the cancellation-template evidence gap with a captured real sample.
- Version the SendGrid Event Webhook's signing keyring and fix a per-source pagination-depth bug in the owner Inbox query.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.
- `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEY` is renamed to the plural, versioned `EVHOST_SENDGRID_EVENT_WEBHOOK_PUBLIC_KEYS` (`"1:<key>,2:<key>"`; a bare value is still accepted as version 1). The code reads the old singular name as a temporary fallback when the plural one is unset, so this deploy will not start rejecting SendGrid webhook events on an environment that hasn't been updated yet — still update any configured deployment's env var name to the plural form at your convenience, since the fallback will be removed in a future release.
- The Workers-runtime suite for the email-ingest handler lives in `services/email-ingest-worker/workerd-tests/`, an isolated, opt-in test harness kept **outside** the pnpm workspace (see that directory's README.md; it is not matched by any `pnpm-workspace.yaml` glob). Running `pnpm test:worker-email` installs `vitest` + `@cloudflare/vitest-pool-workers` — and transitively `workerd`, `miniflare`, and `wrangler` — into that harness only, via its own `pnpm-workspace.yaml` and lockfile. The root workspace dependency graph is unchanged from 0.6.0: `pnpm-lock.yaml` is byte-identical to 0.6.0's, and neither `@cloudflare/vitest-pool-workers` nor any of its transitive deps enter it.

## 0.6.0 — 2026-08-16

- Add a private Turo email intake pipeline for booking notifications, kept dark and Review-only behind default-false gates end to end.
- Consolidate the owner Inbox on desktop and mobile, moving the calendar candidate review queue out of Trips into a single review surface.
- Add the `onlyevs_email_ingestion` migration, the `@evhost/email-ingest-contract` package, and the `email-ingest-worker` service.
- Fix the ingest worker's Dockerfile to include the workspace contract package, scope the owner Inbox per shop, close the mobile Inbox dialog correctly, guard the email capture handler with an explicit reject path, and enforce the intake gate server-side on the owner Turo-email API route.

### For contributors

- Keep every email-ingestion feature flag default-false; no gate flips as part of this release.

## 0.5.0 — 2026-08-15

- Add an always-available owner Integrations center with honest Tesla Fleet and Google Calendar connection health, actions, and setup states.
- Keep safe, read-only Tesla fleet import available while commands, telemetry, and automatic access remain behind verified operations infrastructure.
- Enable Google Calendar OAuth and initial event import independently of background operations, with imported events visible in the Trips review queue.
- Keep trip confirmation and access scheduling fail-closed until the operations service passes its production gates.
- Prevent cross-workspace connection-state flashes and validate credential keyrings with the same exact parser used by production encryption.
- Improve OAuth recovery for origin mismatch, expired sessions, denied access, missing persistent grants, and workspace authorization changes.

### For contributors

- Add callback and capability coverage for OAuth state validation, provider configuration, initial import, empty calendars, encrypted persistence, ingestion failures, and operations-off behavior.
- Document the provider-specific deployment gates and environment variables required for live integrations.

## 0.4.1 — 2026-08-15

- Keep the mobile guest-invitation drawer within the viewport, including native date controls, and limit its scroll surface to vertical movement.
- Remove the stray blue square from the active owner tab while preserving the accessible blue icon, label, and current-page state.

### For contributors

- Add Mobile Safari regression coverage for drawer overflow and bottom-navigation active styling.

## 0.4.0 — 2026-08-15

- Invite the next guest from the primary Today action, with a focused desktop dialog and a mobile bottom sheet that preserve context and keyboard accessibility.
- Use signed-in provider profile photos throughout the owner portal, and let owners upload or remove a personal avatar and tenant brand logo.
- Keep owner navigation visually stable with persistent shared data, route-matched loading geometry, and less flashing during background refreshes.
- Tighten vehicle artwork framing across owner and guest surfaces, remove the redundant header settings control, and improve responsive spacing and contrast.
- Harden raster uploads, same-origin checks, object cleanup, and per-user storage policies with route, database, browser, accessibility, and layout-shift coverage.

## 0.3.0 — 2026-08-15

- Rebuild the owner experience around a light desktop sidebar, five stable mobile tabs, deadline-first handoffs, Guests, Vehicles, Insights, Integrations, and responsive detail surfaces.
- Add the link-only guest trip portal with Home, Guide, Vehicle, Help, and trip-detail destinations across upcoming, active, and completed phases.
- Add a prominent owner-dashboard action for creating private, vehicle-linked guest onboarding trips.
- Persist only hashed guest-link capabilities and sync bounded progress across devices for owner tracking.
- Open private trip links directly without booking-email validation; the unexpired 256-bit link is the guest capability for that trip.
- Let owners rotate a lost guest link while invalidating the previous URL immediately.
- Retain resendable trip capabilities as server-only AES-256-GCM envelopes and add SendGrid reminder delivery with durable cooldown, retry, and daily limits.
- Improve the readiness rail, trip schedule ribbon, detail-page hierarchy, mobile wrapping, truthful reminder audits, and rolling-deploy database compatibility.
- Move EVhost tenants, owner membership, fleet, branding, trips, and access state into a dedicated Supabase project with first-login workspace claiming and a narrowly scoped anonymous guest-link surface.

## 0.2.0 — 2026-08-14

- Rename the platform to evhost.app and add canonical/custom-domain routing.
- Add tenant brand media, accessible accent colors, and refined mobile owner navigation.
- Stage durable Tesla owner credentials, trip-bound driver access, Fleet Telemetry stats/location, and Google Calendar trip review behind a fail-closed production capability flag.
- Add exact guest binding, provider reconciliation, redeemed-driver removal, calendar cancellation/rescheduling, and time-driven trip lifecycle handling.
- Add scoped worker, database migration, deployment templates, unit/contract coverage, and mobile browser regression tests.
- Preserve the production-compatible read-only Tesla import path until the additive control plane is provisioned and verified.
- Upgrade the application runtime to Next.js 16.3.1, adopt the `proxy.ts` convention, and clear the production dependency audit.
