-- Dedicated scoped Postgres role for the internal Turo email capture routes
-- (app/api/internal/turo-email/{authorize,capture}) and the SendGrid
-- delivery-event webhook (app/api/internal/sendgrid/events), all defined in
-- supabase/migrations/20260816003000_onlyevs_email_ingestion.sql. Those
-- routes run in the public web deployment, where the repo's "the web app
-- never uses a service-role key" invariant applies -- SUPABASE_SERVICE_ROLE_KEY
-- is intentionally absent from that environment, which previously made every
-- request to these routes fail closed with a silent 401/400 in production.
--
-- This role grants exactly the five EXECUTE privileges those routes need,
-- mirroring the onlyevs_worker privilege-group pattern from
-- supabase/migrations/20260814193000_onlyevs_access_lifecycle.sql instead of
-- depending on the all-tables, all-functions service_role. It is additive:
-- no existing grant (service_role's own EXECUTE grants included) is revoked.
--
-- Every target function is `security definer`, so the caller only needs
-- EXECUTE on the function itself -- not direct grants on the private-schema
-- tables those functions read and write.
--
-- LOGIN + password are provisioned out-of-band, the same as onlyevs_worker:
-- this migration creates the NOLOGIN privilege group only and never contains
-- a password.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'onlyevs_email_capture_svc') then
    create role onlyevs_email_capture_svc nologin noinherit;
  end if;
end $$;

grant usage on schema public to onlyevs_email_capture_svc;

grant execute on function public.claim_onlyevs_email_capture_nonce(smallint,text,timestamptz)
  to onlyevs_email_capture_svc;
grant execute on function public.authorize_onlyevs_email_alias(text,uuid,text)
  to onlyevs_email_capture_svc;
grant execute on function public.init_onlyevs_email_capture(uuid,bigint,text,text,integer,integer,text,smallint)
  to onlyevs_email_capture_svc;
grant execute on function public.finalize_onlyevs_email_capture(uuid,text,text,integer,text,smallint,timestamptz)
  to onlyevs_email_capture_svc;
grant execute on function public.reconcile_onlyevs_sendgrid_event(text,uuid,uuid,text,text,smallint,timestamptz)
  to onlyevs_email_capture_svc;

comment on role onlyevs_email_capture_svc is
  'NOLOGIN privilege group for the evhost.app internal Turo email capture and SendGrid event-webhook routes; provision a separate LOGIN role out-of-band and grant this role.';
