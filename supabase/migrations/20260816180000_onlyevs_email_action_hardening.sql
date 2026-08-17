-- Hardening pass for onlyevs_email_actions (additive only -- no existing
-- migration is edited): two CHECK constraints that make the action-execution
-- saga's two load-bearing invariants enforced by the database itself, not
-- just by the plpgsql that happens to run today.
--
-- (a) capability_name has always been hand-set by confirm_onlyevs_email_
--     candidate's `v_capability := case v_action_type ... end` (see
--     20260816150000_onlyevs_email_action_lifecycle.sql:~317-321). Nothing
--     stopped a future writer (a new RPC, a hand-run fixup UPDATE, a bug)
--     from inserting a mismatched pair -- e.g. a 'cancel_trip' row stamped
--     'active_safe', which would let a destructive action skip the
--     capability tier its execution semantics depend on.
-- (b) brake_deadline has always been *populated* correctly by
--     reconcile_onlyevs_sendgrid_event (only once the owner-alert delivery
--     is accepted) and left null while awaiting_owner_alert, but nothing
--     enforced that a destructive action can never reach the states beyond
--     that acceptance boundary without a brake. A blanket "brake_deadline
--     is not null whenever action_type is destructive" version is
--     deliberately NOT used here: it would also cover 'awaiting_owner_alert'
--     and 'queued'/'claimed'/'validating', where brake_deadline is null by
--     design (the brake has not started yet -- see the pgTAP assertion at
--     supabase/tests/onlyevs_email_action_lifecycle.pgtap.sql's "the brake
--     has not started before the owner alert is accepted") and would make
--     that legitimate Confirm flow throw.
-- ---------------------------------------------------------------------------

alter table public.onlyevs_email_actions
  add constraint onlyevs_email_actions_capability_action_binding check (
    case action_type
      when 'create_trip' then capability_name = 'create'
      when 'apply_update' then capability_name = 'pretrip'
      when 'deliver_link' then capability_name in ('pretrip', 'active_safe')
      when 'cancel_trip' then capability_name = 'active_destructive'
      when 'rotate_guest' then capability_name = 'active_destructive'
      when 'swap_vehicle' then capability_name = 'active_destructive'
      when 'revoke_access' then capability_name = 'active_destructive'
      else true
    end
  );

comment on constraint onlyevs_email_actions_capability_action_binding on public.onlyevs_email_actions is
  'Invariant: capability_name is bound to action_type exactly per confirm_onlyevs_email_candidate''s mapping -- create_trip=create, apply_update=pretrip, deliver_link in (pretrip,active_safe), and every destructive action_type (cancel_trip/rotate_guest/swap_vehicle/revoke_access)=active_destructive. Prevents a destructive action from ever being recorded under a non-destructive capability tier, by any writer, not only the current RPC.';

alter table public.onlyevs_email_actions
  add constraint onlyevs_email_actions_destructive_brake_scoped check (
    state not in ('revocation_pending', 'provider_mutating', 'db_committing', 'succeeded')
    or action_type not in ('cancel_trip', 'rotate_guest', 'swap_vehicle', 'revoke_access')
    or brake_deadline is not null
  );

comment on constraint onlyevs_email_actions_destructive_brake_scoped on public.onlyevs_email_actions is
  'Invariant: announce-then-brake is preserved (brake_deadline stays null through queued/claimed/validating/awaiting_owner_alert -- the destructive countdown has not started until the owner alert is accepted), but the brake becomes mandatory once a destructive action passes that acceptance boundary: any destructive action in revocation_pending, provider_mutating, db_committing, or succeeded must carry a non-null brake_deadline. State-scoped deliberately, not a blanket per-action_type check, so it does not fire during the legitimate awaiting_owner_alert window before acceptance.';
