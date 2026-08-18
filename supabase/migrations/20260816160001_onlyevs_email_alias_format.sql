-- Tighten onlyevs_email_integrations.alias_address to the shorter,
-- Turo-compatible alias shape: a 15-char base32 token + "." + an 8-char
-- base32 signature (24-octet local-part, 40-octet address total). See the
-- sizing/threat-model comment on EMAIL_ALIAS_TOKEN_CHARS /
-- EMAIL_ALIAS_SIGNATURE_CHARS in packages/email-ingest-contract/src/index.ts
-- for why this format exists and why it deliberately does not chase a
-- >=120-bit entropy floor.
--
-- The prior check (20260816003000) allowed a 20-64 char token and a 16-86
-- char signature -- every alias under the new fixed 15/8 shape violates
-- both bounds, so this is a required, not cosmetic, migration: without it
-- configure_onlyevs_email_integration rejects the first alias minted under
-- the new app+Worker code with a check-constraint violation.
--
-- Deploy order for this alias-format change is mandatory and this
-- migration must run third:
--   1. email-ingest-worker ships with the new contract (verifyAlias enforces
--      the new exact lengths)
--   2. the Next app ships (createWorkspaceAlias mints the new shape)
--   3. this migration (tightens the stored-address constraint)
--   4. the owner re-mints via the integration's existing Rotate action
-- Any alias_address already stored predates step 2 by definition (nothing
-- in the codebase could have minted the new shape before this deploys), so
-- it is stale under the new constraint. ADD CONSTRAINT validates existing
-- rows, so the stale value must be cleared first or this migration fails;
-- clearing it here (rather than leaving a row that can never re-validate)
-- also matches step 4 above -- the owner is expected to rotate regardless.
update public.onlyevs_email_integrations
  set alias_address = null
  where alias_address is not null
    and alias_address !~ '^[a-z2-7]{15}\.[a-z2-7]{8}@mail\.evhost\.app$';

alter table public.onlyevs_email_integrations
  drop constraint if exists onlyevs_email_integrations_alias_address_check;

alter table public.onlyevs_email_integrations
  add constraint onlyevs_email_integrations_alias_address_check
  check (alias_address is null or alias_address ~ '^[a-z2-7]{15}\.[a-z2-7]{8}@mail\.evhost\.app$');
