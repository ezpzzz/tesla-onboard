# TODOS

Items below are tagged with the version that deferred them.

## Deferred

- [ ] Add rate-limit/cooldown to the locate-setup wake endpoint -- it is billable and owner-gated but currently unthrottled (`app/api/owner/vehicles/[id]/locate-setup`). (v0.9.0)
- [ ] Add charging-history pagination and confirm provider-invoice-id stability, blocked on go/no-go gate 5's real-response evidence (`lib/owner/tesla-charging-client.ts`). (v0.9.0)
- [ ] Decide the billing treatment for gap-affected charge sessions -- they currently bill as one session using battery-delta kWh, and the `gapAffected` flag is informational only. (v0.9.0)
- [ ] Improve invoice-to-session matching -- it is greedy 1:1, so a second overlapping invoice lands in `unmatchedInvoices` (`lib/owner/charge-sessions.ts`, `reconcileChargingInvoices`). (v0.9.0)
- [ ] Add pgTAP live-database tests for the new migration's RLS policies and CHECK constraints -- only text-level tests exist today. (v0.9.0)
- [ ] Add a retention-enforcement job for telemetry history and location points -- `delete_after` is set on rows but nothing app-level enforces it (an R2-style lifecycle rule equivalent is needed). (v0.9.0)
- [ ] Keep `public.get_onlyevs_charge_sessions`'s SQL segmentation in lockstep with the TS implementation in `lib/owner/charge-sessions.ts`. (v0.9.0)
- [ ] `backfillGuestLinksByEmailHash` has no production caller -- wire it into a backfill job or remove it. (v0.9.0)
- [ ] `TenantConfigProvider`'s module-level resolution cache can serve one stale paint after a same-tab tenant switch (low severity). (v0.9.0)
