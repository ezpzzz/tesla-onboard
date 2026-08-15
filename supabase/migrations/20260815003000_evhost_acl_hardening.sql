-- Supabase's managed DDL hooks can add direct anon/authenticated EXECUTE grants
-- when functions are created. Revoking only PostgreSQL's PUBLIC role therefore
-- leaves a wider RPC surface than the application contract intends. Normalize
-- every EVhost entrypoint after the complete migration chain is installed.

revoke all on function public.touch_evhost_record() from public, anon, authenticated;
revoke all on function public.touch_evhost_vehicle() from public, anon, authenticated;
revoke all on function private.touch_onlyevs_access_row() from public, anon, authenticated;

revoke all on function public.bootstrap_evhost_workspace() from public, anon, authenticated;
revoke all on function public.has_minimum_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.request_onlyevs_custom_domain(uuid, text, text) from public, anon, authenticated;
revoke all on function public.request_onlyevs_custom_domain_removal(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_onlyevs_integration(
  uuid, text, text, text, text[], text, text, text, text, text, smallint, timestamptz
) from public, anon, authenticated;
revoke all on function public.create_onlyevs_owner_import_session(
  uuid, text, text, jsonb, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_onlyevs_owner_import_profile(text) from public, anon, authenticated;
revoke all on function public.delete_onlyevs_owner_import_session(text) from public, anon, authenticated;
revoke all on function public.disconnect_onlyevs_integration(uuid, text, text) from public, anon, authenticated;
revoke all on function public.ingest_onlyevs_calendar_candidates(uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_onlyevs_calendar_candidate(
  uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.dismiss_onlyevs_calendar_candidate(uuid) from public, anon, authenticated;
revoke all on function public.resolve_onlyevs_calendar_candidate_change(uuid, text) from public, anon, authenticated;
revoke all on function public.create_onlyevs_manual_trip(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.get_onlyevs_workspace_trip_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz) from public, anon, authenticated;

revoke all on function public.get_onlyevs_trip_invitation(text) from public, anon, authenticated;
revoke all on function public.update_onlyevs_guest_onboarding_progress(text, jsonb) from public, anon, authenticated;
revoke all on function public.complete_onlyevs_guest_onboarding(text, boolean, text) from public, anon, authenticated;
revoke all on function public.get_onlyevs_ready_invite(text) from public, anon, authenticated;

grant execute on function public.bootstrap_evhost_workspace() to authenticated;
grant execute on function public.has_minimum_role(uuid, uuid, text) to authenticated;
grant execute on function public.request_onlyevs_custom_domain(uuid, text, text) to authenticated;
grant execute on function public.request_onlyevs_custom_domain_removal(uuid, uuid) to authenticated;
grant execute on function public.complete_onlyevs_integration(
  uuid, text, text, text, text[], text, text, text, text, text, smallint, timestamptz
) to authenticated;
grant execute on function public.create_onlyevs_owner_import_session(
  uuid, text, text, jsonb, timestamptz
) to authenticated;
grant execute on function public.get_onlyevs_owner_import_profile(text) to authenticated;
grant execute on function public.delete_onlyevs_owner_import_session(text) to authenticated;
grant execute on function public.disconnect_onlyevs_integration(uuid, text, text) to authenticated;
grant execute on function public.ingest_onlyevs_calendar_candidates(uuid, text, uuid, jsonb) to authenticated, onlyevs_worker;
grant execute on function public.confirm_onlyevs_calendar_candidate(
  uuid, uuid, text, text, text, timestamptz
) to authenticated;
grant execute on function public.dismiss_onlyevs_calendar_candidate(uuid) to authenticated;
grant execute on function public.resolve_onlyevs_calendar_candidate_change(uuid, text) to authenticated;
grant execute on function public.create_onlyevs_manual_trip(
  uuid, text, uuid, text, text, text, timestamptz, timestamptz, text, timestamptz
) to authenticated;
grant execute on function public.get_onlyevs_workspace_trip_snapshot(uuid, text) to authenticated;
grant execute on function public.rotate_onlyevs_trip_public_token(uuid, text, timestamptz) to authenticated;

-- These four functions intentionally use a high-entropy trip capability rather
-- than an account session. They return only guest-safe data and are the entire
-- anonymous RPC surface for link-only onboarding.
grant execute on function public.get_onlyevs_trip_invitation(text) to anon, authenticated;
grant execute on function public.update_onlyevs_guest_onboarding_progress(text, jsonb) to anon, authenticated;
grant execute on function public.complete_onlyevs_guest_onboarding(text, boolean, text) to anon, authenticated;
grant execute on function public.get_onlyevs_ready_invite(text) to anon, authenticated;
