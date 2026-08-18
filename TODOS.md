# TODOS

Items below are tagged with the version that deferred them.

## Deferred

- [ ] Pin charging-history pagination/shape against real provider-response evidence -- defensive pagination (cumulative-total / echoed-pageSize / raw-row-count continuation detection, hard page cap, zero-new-invoice stop) is now built in `lib/owner/tesla-charging-client.ts` and `services/onlyevs-worker/index.ts`, but the `pageNo`/`pageSize` query-param names are an unverified assumption pending go/no-go gate 5's real-response capture. (v0.9.0)
- [ ] Keep `public.get_onlyevs_charge_sessions`'s SQL segmentation in lockstep with the TS implementation in `lib/owner/charge-sessions.ts` -- standing invariant; now also covered by the pgTAP suite's function-behavior assertions in addition to the text-level checks. (v0.9.0)
