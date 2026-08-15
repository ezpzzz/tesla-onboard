begin;
select plan(20);

select has_table('public'::name, 'workspaces'::name);
select has_table('public'::name, 'workspace_users'::name);
select has_table('public'::name, 'workspace_branding'::name);
select has_table('public'::name, 'onlyevs_vehicles'::name);
select has_table('private'::name, 'evhost_workspace_claims'::name);
select has_function('public', 'bootstrap_evhost_workspace', array[]::text[]);
select ok(
  not has_function_privilege('anon', 'public.bootstrap_evhost_workspace()', 'execute'),
  'anonymous callers cannot bootstrap an owner workspace'
);
select ok(
  has_function_privilege('authenticated', 'public.bootstrap_evhost_workspace()', 'execute'),
  'authenticated owners can bootstrap a workspace'
);
select ok(
  not has_table_privilege('anon', 'public.onlyevs_vehicles', 'select'),
  'anonymous guests cannot read private fleet records'
);
select ok(
  has_table_privilege('authenticated', 'public.onlyevs_vehicles', 'select'),
  'authenticated owners receive the fleet table grant before RLS'
);

insert into auth.users (id, email, raw_user_meta_data)
values (
  '81000000-0000-4000-8000-000000000001',
  'new-owner@example.com',
  '{"full_name":"New Owner Rentals"}'::jsonb
);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"email":"new-owner@example.com"}', true);
select lives_ok(
  $$select public.bootstrap_evhost_workspace()$$,
  'a verified first-time owner can bootstrap a tenant'
);
select is(
  (select count(*) from public.workspace_users
   where user_id = '81000000-0000-4000-8000-000000000001' and role = 'owner'),
  1::bigint,
  'bootstrap creates one owner membership'
);
select is(
  (select w.name from public.workspaces w
   join public.workspace_users wu on wu.workspace_id = w.id
   where wu.user_id = '81000000-0000-4000-8000-000000000001'),
  'New Owner Rentals',
  'bootstrap uses verified owner profile metadata for the draft name'
);
select lives_ok(
  $$select public.bootstrap_evhost_workspace()$$,
  'repeating bootstrap is idempotent'
);
select is(
  (select count(*) from public.workspace_users
   where user_id = '81000000-0000-4000-8000-000000000001'),
  1::bigint,
  'repeating bootstrap does not create another tenant'
);

insert into public.workspaces (id, name, slug)
values ('82000000-0000-4000-8000-000000000001', 'Migrated Rentals', 'migrated-rentals');
insert into private.evhost_workspace_claims (workspace_id, email_hash)
values (
  '82000000-0000-4000-8000-000000000001',
  encode(extensions.digest('migrated@example.com', 'sha256'), 'hex')
);
insert into auth.users (id, email, raw_user_meta_data)
values ('81000000-0000-4000-8000-000000000002', 'migrated@example.com', '{}'::jsonb);
select set_config('request.jwt.claim.sub', '81000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"email":"migrated@example.com"}', true);
select lives_ok(
  $$select public.bootstrap_evhost_workspace()$$,
  'a verified migrated owner can claim a staged tenant'
);
select is(
  (select workspace_id from public.workspace_users
   where user_id = '81000000-0000-4000-8000-000000000002'),
  '82000000-0000-4000-8000-000000000001'::uuid,
  'the email digest attaches the owner to the migrated workspace'
);
select is(
  (select claimed_by from private.evhost_workspace_claims
   where workspace_id = '82000000-0000-4000-8000-000000000001'),
  '81000000-0000-4000-8000-000000000002'::uuid,
  'the migration claim records the verified auth identity'
);

insert into public.onlyevs_vehicles (
  id, workspace_id, shop_slug, display_name, model, trim, year, color
) values (
  '83000000-0000-4000-8000-000000000001',
  '82000000-0000-4000-8000-000000000001',
  'migrated-rentals', 'Model 3', 'Model 3', 'Performance', 2024, 'Solid Black'
);
update public.onlyevs_vehicles set notes = 'updated'
where id = '83000000-0000-4000-8000-000000000001';
select is(
  (select revision from public.onlyevs_vehicles
   where id = '83000000-0000-4000-8000-000000000001'),
  2::bigint,
  'fleet updates advance the optimistic concurrency revision'
);

insert into public.workspace_branding (workspace_id, shop_slug, display_name, features)
values (
  '82000000-0000-4000-8000-000000000001',
  'migrated-rentals', 'Migrated Rentals',
  '{"onlyevs":{"publishedAt":1786752000000}}'::jsonb
);
set local role anon;
select is(
  (select count(*) from public.workspace_branding where shop_slug = 'migrated-rentals'),
  1::bigint,
  'anonymous guests can resolve only a published tenant snapshot'
);
reset role;

select * from finish();
rollback;
