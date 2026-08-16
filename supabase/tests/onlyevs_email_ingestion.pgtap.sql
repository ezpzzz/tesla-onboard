begin;
select plan(43);

select has_table('public'::name, 'onlyevs_email_integrations'::name);
select has_table('public'::name, 'onlyevs_inbound_emails'::name);
select has_table('public'::name, 'onlyevs_email_candidates'::name);
select has_table('public'::name, 'onlyevs_email_actions'::name);
select has_table('public'::name, 'onlyevs_email_deliveries'::name);
select has_table('public'::name, 'onlyevs_email_outbox'::name);
select has_table('public'::name, 'onlyevs_inbox_archives'::name);
select has_table('private'::name, 'onlyevs_email_aliases'::name);
select has_table('private'::name, 'onlyevs_sendgrid_events'::name);
select has_table('private'::name, 'onlyevs_email_key_references'::name);
select has_table('private'::name, 'onlyevs_email_capture_nonces'::name);

select has_index('public'::name, 'onlyevs_inbound_emails'::name, 'onlyevs_inbound_message_id_idx'::name);
select has_index('public'::name, 'onlyevs_inbound_emails'::name, 'onlyevs_inbound_raw_fallback_idx'::name);
select has_index('public'::name, 'onlyevs_email_candidates'::name, 'onlyevs_email_candidates_inbox_idx'::name);
select has_index('public'::name, 'onlyevs_email_actions'::name, 'onlyevs_email_actions_due_idx'::name);
select has_index('public'::name, 'onlyevs_email_outbox'::name, 'onlyevs_email_outbox_due_idx'::name);
select has_index('public'::name, 'onlyevs_trips'::name, 'onlyevs_trips_email_candidate_unique_idx'::name);

select policies_are('public', 'onlyevs_email_integrations', array['onlyevs_email_integrations_manager_select','onlyevs_email_integrations_worker_all']);
select policies_are('public', 'onlyevs_inbound_emails', array['onlyevs_inbound_emails_manager_select','onlyevs_inbound_emails_worker_all']);
select policies_are('public', 'onlyevs_email_candidates', array['onlyevs_email_candidates_manager_select','onlyevs_email_candidates_worker_all']);
select policies_are('public', 'onlyevs_email_actions', array['onlyevs_email_actions_manager_select','onlyevs_email_actions_worker_all']);
select policies_are('public', 'onlyevs_email_deliveries', array['onlyevs_email_deliveries_manager_select','onlyevs_email_deliveries_worker_all']);
select policies_are('public', 'onlyevs_email_outbox', array['onlyevs_email_outbox_worker_all']);
select policies_are('public', 'onlyevs_inbox_archives', array['onlyevs_inbox_archives_manager_select','onlyevs_inbox_archives_worker_all']);

select table_privs_are('private', 'onlyevs_email_aliases', 'authenticated', array[]::text[]);
select table_privs_are('private', 'onlyevs_sendgrid_events', 'authenticated', array[]::text[]);
select table_privs_are('private', 'onlyevs_email_key_references', 'authenticated', array[]::text[]);

select has_function('private', 'claim_onlyevs_due_email', array['text','integer']);
select has_function('public', 'archive_onlyevs_inbox_item', array['uuid','uuid','uuid']);
select has_function('public', 'restore_onlyevs_inbox_item', array['uuid','uuid']);
select has_function('public', 'claim_onlyevs_email_capture_nonce', array['smallint','text','timestamp with time zone']);
select has_function('public', 'update_onlyevs_email_integration', array['uuid','uuid','bigint','text','text']);
select has_function('public', 'dismiss_onlyevs_email_candidate', array['uuid','uuid','bigint']);
select function_privs_are('private', 'claim_onlyevs_due_email', array['text','integer'], 'public', array[]::text[]);

select has_trigger('public'::name, 'onlyevs_inbound_emails'::name, 'validate_onlyevs_inbound_email_transition'::name);
select has_trigger('public'::name, 'onlyevs_email_candidates'::name, 'validate_onlyevs_email_candidate_transition'::name);
select has_trigger('public'::name, 'onlyevs_email_actions'::name, 'validate_onlyevs_email_action_transition'::name);
select has_trigger('public'::name, 'onlyevs_email_deliveries'::name, 'validate_onlyevs_email_delivery_transition'::name);

select has_column('public'::name, 'onlyevs_trips'::name, 'email_candidate_id'::name, 'trip email candidate link exists');
select has_column('public'::name, 'onlyevs_trips'::name, 'pii_scrubbed_at'::name, 'trip PII scrub timestamp exists');
select ok(exists(select 1 from pg_constraint where conname = 'onlyevs_trips_source_xor'), 'trip source XOR exists');
select ok(exists(select 1 from pg_constraint where conname = 'onlyevs_inbox_archives_email_fk'), 'email archive FK exists');
select ok(exists(select 1 from pg_constraint where conname = 'onlyevs_inbox_archives_calendar_fk'), 'calendar archive FK exists');

select * from finish();
rollback;
