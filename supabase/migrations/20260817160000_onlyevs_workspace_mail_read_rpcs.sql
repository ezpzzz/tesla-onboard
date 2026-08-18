-- Workspace Mail: decrypt-on-read bridge RPCs (design doc
-- alex-email-inbox-design-20260817-123909.md, T11, routes lane). Additive
-- only -- does not edit 20260817140000_onlyevs_workspace_mail.sql or any
-- other prior migration.
--
-- Gap this closes: T11's decrypt-on-read Next route mirrors the
-- location-evidence KEK posture (1A) -- get_onlyevs_vehicle_location_evidence
-- (20260817090000_onlyevs_vehicle_telemetry_ledger.sql) is that route's own
-- model, a SECURITY DEFINER bridge that hands the authenticated web app
-- exactly the encrypted-object coordinates it needs, membership-checked, and
-- nothing else. The mail read route needs the equivalent bridge: the raw
-- envelope's R2 object key/KEK version plus the AAD components
-- (evmailAad in @evhost/email-ingest-contract) needed to decrypt it --
-- inbound_email_id, raw_sha256, normalized_sha256, and alias_hash. The first
-- three already sit on public.onlyevs_inbound_emails, which a workspace
-- manager can already SELECT directly under
-- onlyevs_inbound_emails_manager_select RLS -- but alias_hash lives in
-- private.onlyevs_email_aliases, granted only to onlyevs_worker
-- (20260816003000_onlyevs_email_ingestion.sql), so the web app -- which
-- never holds a service-role key -- cannot reconstruct the AAD without a
-- SECURITY DEFINER bridge for that one private-schema field. These three
-- functions are that bridge and nothing more: they return ciphertext
-- coordinates and presentation metadata only, never plaintext, never a
-- KEK, and never any other private.onlyevs_email_* row than the exact one
-- addressed by (workspace_id, message_id)/(workspace_id, attachment_id).
--
-- Everything here stays dark: no UI route reads these until T11/T13 land
-- (this migration ships alongside T11), and nothing here changes worker
-- behavior or ONLYEVS_EMAIL_WORKER_ENABLED.

-- =====================================================================
-- get_onlyevs_email_message_envelope -- one row: everything the read route
-- needs to fetch the raw envelope from R2 and reconstruct its AAD exactly
-- as services/onlyevs-worker/email.ts's loadAndDecrypt does. Returns the
-- empty set (never an exception) when the message/inbound row doesn't
-- exist so the route can render an honest not_found rather than leaking
-- existence via error shape -- same "empty set over exception for a missing
-- row" choice get_onlyevs_vehicle_location_evidence makes.
-- =====================================================================

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
  alias_hash text
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
    a.alias_hash
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

-- =====================================================================
-- list_onlyevs_email_message_attachments -- the attachment manifest for a
-- message (T11 content route: builds `attachments` + the cid: inline
-- candidates; T12 renderer: cid -> data: rewriting keys off content_id).
-- Never returns bytes -- r2_object_key is a coordinate the read route
-- resolves server-side, same posture as the envelope RPC above.
-- =====================================================================

create or replace function public.list_onlyevs_email_message_attachments(
  p_workspace_id uuid,
  p_message_id uuid
)
returns table (
  id uuid,
  filename text,
  content_type text,
  size_bytes integer,
  content_id text,
  sha256 text,
  r2_object_key text
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
  select a.id, a.filename, a.content_type, a.size_bytes, a.content_id, a.sha256, a.r2_object_key
  from private.onlyevs_email_attachments a
  join private.onlyevs_email_message_index m
    on m.workspace_id = a.workspace_id and m.id = a.message_index_id
  where a.workspace_id = p_workspace_id and m.id = p_message_id
  order by a.created_at, a.id;
end;
$$;

revoke all on function public.list_onlyevs_email_message_attachments(uuid, uuid) from public, anon;
grant execute on function public.list_onlyevs_email_message_attachments(uuid, uuid) to authenticated;

-- =====================================================================
-- get_onlyevs_email_message_attachment -- single attachment, scoped to a
-- specific message (not just workspace): the attachment download route
-- addresses /api/owner/mail/[id]/attachments/[aid], and this function
-- 404s (empty set) rather than 200s when [aid] belongs to a different
-- message than [id] -- a caller cannot probe attachment ids across
-- messages it doesn't already know the message id for.
-- =====================================================================

create or replace function public.get_onlyevs_email_message_attachment(
  p_workspace_id uuid,
  p_message_id uuid,
  p_attachment_id uuid
)
returns table (
  id uuid,
  filename text,
  content_type text,
  size_bytes integer,
  content_id text,
  sha256 text,
  r2_object_key text
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
  select a.id, a.filename, a.content_type, a.size_bytes, a.content_id, a.sha256, a.r2_object_key
  from private.onlyevs_email_attachments a
  join private.onlyevs_email_message_index m
    on m.workspace_id = a.workspace_id and m.id = a.message_index_id
  where a.workspace_id = p_workspace_id and m.id = p_message_id and a.id = p_attachment_id;
end;
$$;

revoke all on function public.get_onlyevs_email_message_attachment(uuid, uuid, uuid) from public, anon;
grant execute on function public.get_onlyevs_email_message_attachment(uuid, uuid, uuid) to authenticated;

comment on function public.get_onlyevs_email_message_envelope(uuid, uuid) is
  'Decrypt-on-read bridge (T11): ciphertext coordinates + AAD components only, never plaintext. Membership-checked.';
comment on function public.list_onlyevs_email_message_attachments(uuid, uuid) is
  'Attachment manifest for a message (T11/T12): coordinates only, never bytes.';
comment on function public.get_onlyevs_email_message_attachment(uuid, uuid, uuid) is
  'Single attachment scoped to its owning message (T11 download route); returns empty, not another message''s row, on a cross-message id.';
