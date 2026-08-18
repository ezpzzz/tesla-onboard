-- Workspace Mail: persist the per-message remote-image opt-in (fix-before-
-- merge review finding, design doc alex-email-inbox-design-20260817-123909.md
-- Open Question 1: "Default: persisted per message per workspace --
-- smallest surprise"). Additive only -- does not edit
-- 20260817140000_onlyevs_workspace_mail.sql, 20260817160000_onlyevs_
-- workspace_mail_read_rpcs.sql, or any other prior migration; the envelope
-- RPC is redefined here (create or replace, same convention every prior
-- migration in this chain already uses to extend an earlier function) only
-- to add the one new column to its result row.
--
-- Before this migration, MailContentFrame.tsx's "Load remote images"
-- opt-in was `useState(false)` -- session-local, reset on every navigation
-- away and back to the same message, contradicting the design doc's stated
-- default. This makes it a real per-message-per-workspace flag: any
-- workspace manager can widen it, it is visible to the whole team (matches
-- "per workspace", not per-user), and it can be read back the next time
-- anyone opens the message.

alter table private.onlyevs_email_message_index
  add column if not exists remote_images_allowed boolean not null default false;

comment on column private.onlyevs_email_message_index.remote_images_allowed is
  'Per-message, per-workspace remote-image opt-in (design doc Open Question 1). Widens the renderer CSP img-src for this message''s render only -- never retroactively narrows once set, matching the "smallest surprise" default.';

-- Re-published with the new column appended to the result row; every other
-- column/behavior is byte-identical to the original definition in
-- 20260817160000_onlyevs_workspace_mail_read_rpcs.sql.
create or replace function public.get_onlyevs_email_message_envelope(
  p_workspace_id uuid,
  p_message_id uuid
)
returns table (
  inbound_email_id uuid,
  subject text,
  sender text,
  sent_at timestamptz,
  r2_object_key text,
  kek_version smallint,
  ciphertext_sha256 text,
  raw_sha256 text,
  normalized_sha256 text,
  alias_hash text,
  remote_images_allowed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;

  return query
  select
    m.inbound_email_id, m.subject, m.sender, m.sent_at,
    e.r2_object_key, e.kek_version, e.ciphertext_sha256, e.raw_sha256, e.normalized_sha256,
    a.alias_hash, m.remote_images_allowed
  from private.onlyevs_email_message_index m
  join public.onlyevs_inbound_emails e
    on e.workspace_id = m.workspace_id and e.id = m.inbound_email_id
  join private.onlyevs_email_aliases a
    on a.integration_id = e.integration_id and a.revision = e.accepted_alias_revision
  where m.workspace_id = p_workspace_id and m.id = p_message_id;
end;
$$;

revoke all on function public.get_onlyevs_email_message_envelope(uuid, uuid) from public, anon;
grant execute on function public.get_onlyevs_email_message_envelope(uuid, uuid) to authenticated;

-- set_onlyevs_email_remote_images_allowed -- the write side. Same
-- membership-first/search_path/revoke-grant convention as
-- record_onlyevs_email_read. Deliberately one-directional in the UI (the
-- client only ever calls this with true -- see MailContentFrame.tsx), but
-- the RPC itself accepts either value so a future "revoke" affordance needs
-- no migration.
create or replace function public.set_onlyevs_email_remote_images_allowed(
  p_workspace_id uuid,
  p_message_id uuid,
  p_allowed boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  update private.onlyevs_email_message_index
    set remote_images_allowed = p_allowed
    where workspace_id = p_workspace_id and id = p_message_id;
  if not found then
    raise exception 'email_message_not_found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_onlyevs_email_remote_images_allowed(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_onlyevs_email_remote_images_allowed(uuid, uuid, boolean) to authenticated;
