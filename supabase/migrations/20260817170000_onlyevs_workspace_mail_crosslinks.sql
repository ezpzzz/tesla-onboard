-- Workspace Mail: candidate/trip cross-link + per-mechanism trust read RPCs
-- (design doc alex-email-inbox-design-20260817-123909.md, T13/T14, UI lane).
-- Additive only -- does not edit 20260817140000_onlyevs_workspace_mail.sql,
-- 20260817160000_onlyevs_workspace_mail_read_rpcs.sql, or any other prior
-- migration.
--
-- Gap this closes (crosslinks): the design doc's step 4/step 5 asks
-- candidate cards and trip pages to link "into the mail surface", but
-- list_onlyevs_email_messages (20260817160000) only filters by shop/event
-- type/linked/unread -- there is no way for the UI to ask "which indexed
-- message(s) belong to this exact candidate" or "which indexed messages
-- belong to this exact trip" without a direct private-schema read, which the
-- web app (no service-role key) cannot do. These two functions are that
-- bridge and nothing more: same row shape as list_onlyevs_email_messages
-- (so callers can reuse one row type/renderer), same membership-first
-- SECURITY DEFINER posture, never plaintext.
--
-- Gap this closes (trust): private.onlyevs_email_message_index carries
-- dkim_pass/spf_pass/dmarc_pass/from_domain_aligned (20260817140000, closing
-- the same per-mechanism gap for storage), but no RPC has exposed them to
-- the client yet -- list_onlyevs_email_messages deliberately keeps its list
-- row lean and get_onlyevs_email_message_envelope (20260817160000) returns
-- ciphertext coordinates only. T14's raw-headers trust chips need exactly
-- these four booleans for one message; get_onlyevs_email_message_trust below
-- is that dedicated, minimal bridge.
--
-- list_onlyevs_email_messages_for_trip mirrors purge_onlyevs_email_guest's
-- own resolution (20260817140000_onlyevs_workspace_mail.sql): a trip's
-- messages are found via the index row's own trip_id (once some future
-- writer populates it) UNION the candidate.effective_trip_id link the action
-- lifecycle sets at db_committing time (20260816150000_onlyevs_email_action_
-- lifecycle.sql) -- not onlyevs_trips.email_candidate_id, which only names
-- the single candidate/calendar event a trip was originally *created from*.
--
-- Everything here stays dark: no UI route reads these until T13 lands
-- (this migration ships alongside it), and nothing here changes worker
-- behavior or ONLYEVS_EMAIL_WORKER_ENABLED.

create or replace function public.list_onlyevs_email_messages_for_candidate(
  p_workspace_id uuid,
  p_candidate_id uuid,
  p_limit integer default 20
)
returns table (
  id uuid,
  inbound_email_id uuid,
  subject text,
  sender text,
  sent_at timestamptz,
  snippet text,
  has_attachments boolean,
  candidate_id uuid,
  trip_id uuid,
  guest_id uuid,
  event_type text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_limit integer;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 20), 1), 100);

  return query
  select
    m.id, m.inbound_email_id, m.subject, m.sender, m.sent_at, m.snippet, m.has_attachments,
    m.candidate_id, m.trip_id, m.guest_id, c.event_type,
    (r.user_id is not null) as is_read
  from private.onlyevs_email_message_index m
  left join public.onlyevs_email_candidates c
    on c.workspace_id = m.workspace_id and c.id = m.candidate_id
  left join private.onlyevs_email_read_receipts r
    on r.workspace_id = m.workspace_id and r.message_index_id = m.id and r.user_id = (select auth.uid())
  where m.workspace_id = p_workspace_id and m.candidate_id = p_candidate_id
  order by m.sent_at desc, m.id asc
  limit v_limit;
end;
$$;

revoke all on function public.list_onlyevs_email_messages_for_candidate(uuid, uuid, integer) from public, anon;
grant execute on function public.list_onlyevs_email_messages_for_candidate(uuid, uuid, integer) to authenticated;

create or replace function public.list_onlyevs_email_messages_for_trip(
  p_workspace_id uuid,
  p_trip_id uuid,
  p_limit integer default 50
)
returns table (
  id uuid,
  inbound_email_id uuid,
  subject text,
  sender text,
  sent_at timestamptz,
  snippet text,
  has_attachments boolean,
  candidate_id uuid,
  trip_id uuid,
  guest_id uuid,
  event_type text,
  is_read boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_limit integer;
begin
  if (select auth.uid()) is null
    or not public.has_minimum_role(p_workspace_id, (select auth.uid()), 'manager') then
    raise exception 'workspace_manager_required' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);

  return query
  select
    m.id, m.inbound_email_id, m.subject, m.sender, m.sent_at, m.snippet, m.has_attachments,
    m.candidate_id, m.trip_id, m.guest_id, c.event_type,
    (r.user_id is not null) as is_read
  from private.onlyevs_email_message_index m
  left join public.onlyevs_email_candidates c
    on c.workspace_id = m.workspace_id and c.id = m.candidate_id
  left join private.onlyevs_email_read_receipts r
    on r.workspace_id = m.workspace_id and r.message_index_id = m.id and r.user_id = (select auth.uid())
  where m.workspace_id = p_workspace_id
    and (
      m.trip_id = p_trip_id
      or m.candidate_id in (
        select ec.id from public.onlyevs_email_candidates ec
        where ec.workspace_id = p_workspace_id and ec.effective_trip_id = p_trip_id
      )
    )
  order by m.sent_at desc, m.id asc
  limit v_limit;
end;
$$;

revoke all on function public.list_onlyevs_email_messages_for_trip(uuid, uuid, integer) from public, anon;
grant execute on function public.list_onlyevs_email_messages_for_trip(uuid, uuid, integer) to authenticated;

-- =====================================================================
-- T13 -- single-message metadata by the message's own id. The detail page
-- (app/owner/mail/[id]/page.tsx) knows only `id` from the URL -- every
-- other list-shaped reader above is keyed by candidate/trip/workspace, not
-- by one message's own id, so without this the detail page would have no
-- way to read candidate_id/trip_id/guest_id/event_type/subject/sender for
-- its own header, cross-links, and purge-scope resolution short of
-- decrypting the full envelope. Same row shape as list_onlyevs_email_messages
-- for one-function reuse of the same row type/mapper.
-- =====================================================================

create or replace function public.get_onlyevs_email_message(
  p_workspace_id uuid,
  p_message_id uuid
)
returns table (
  id uuid,
  inbound_email_id uuid,
  subject text,
  sender text,
  sent_at timestamptz,
  snippet text,
  has_attachments boolean,
  candidate_id uuid,
  trip_id uuid,
  guest_id uuid,
  event_type text,
  is_read boolean
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
    m.id, m.inbound_email_id, m.subject, m.sender, m.sent_at, m.snippet, m.has_attachments,
    m.candidate_id, m.trip_id, m.guest_id, c.event_type,
    (r.user_id is not null) as is_read
  from private.onlyevs_email_message_index m
  left join public.onlyevs_email_candidates c
    on c.workspace_id = m.workspace_id and c.id = m.candidate_id
  left join private.onlyevs_email_read_receipts r
    on r.workspace_id = m.workspace_id and r.message_index_id = m.id and r.user_id = (select auth.uid())
  where m.workspace_id = p_workspace_id and m.id = p_message_id;
end;
$$;

revoke all on function public.get_onlyevs_email_message(uuid, uuid) from public, anon;
grant execute on function public.get_onlyevs_email_message(uuid, uuid) to authenticated;

comment on function public.get_onlyevs_email_message(uuid, uuid) is
  'Single-message metadata by its own id (T13 detail page). Same row shape as list_onlyevs_email_messages.';

comment on function public.list_onlyevs_email_messages_for_candidate(uuid, uuid, integer) is
  'Cross-link bridge (T13): messages already linked to one email candidate. Same row shape as list_onlyevs_email_messages.';
comment on function public.list_onlyevs_email_messages_for_trip(uuid, uuid, integer) is
  'Cross-link bridge (T13): messages linked to a trip via message_index.trip_id or a resolved candidate.effective_trip_id.';

-- =====================================================================
-- T14 -- per-mechanism trust chips. Single-message read, empty set (never
-- an exception) on a missing/foreign message id -- same "empty set over
-- exception" convention as get_onlyevs_email_message_envelope.
-- =====================================================================

create or replace function public.get_onlyevs_email_message_trust(
  p_workspace_id uuid,
  p_message_id uuid
)
returns table (
  dkim_pass boolean,
  spf_pass boolean,
  dmarc_pass boolean,
  from_domain_aligned boolean
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
  select m.dkim_pass, m.spf_pass, m.dmarc_pass, m.from_domain_aligned
  from private.onlyevs_email_message_index m
  where m.workspace_id = p_workspace_id and m.id = p_message_id;
end;
$$;

revoke all on function public.get_onlyevs_email_message_trust(uuid, uuid) from public, anon;
grant execute on function public.get_onlyevs_email_message_trust(uuid, uuid) to authenticated;

comment on function public.get_onlyevs_email_message_trust(uuid, uuid) is
  'Per-mechanism receiver-auth booleans for one message (T14 trust chips). Each column is independently nullable -- unknown, not fail, when not yet populated.';
