begin;

select plan(9);

select ok(
  exists (select 1 from storage.buckets where id = 'evhost-user-avatars' and public),
  'owner avatar bucket is public presentation media'
);

select is(
  (select file_size_limit from storage.buckets where id = 'evhost-user-avatars'),
  2097152::bigint,
  'owner avatar uploads are limited to 2 MB'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'evhost-user-avatars'),
  array['image/png', 'image/jpeg', 'image/webp']::text[],
  'owner avatar storage accepts raster images only'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'evhost_user_avatars_insert_own'),
  'authenticated users can insert only through the owner-scoped avatar policy'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'evhost_user_avatars_update_own'),
  'authenticated users can update only through the owner-scoped avatar policy'
);

select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'evhost_user_avatars_delete_own'),
  'authenticated users can delete only through the owner-scoped avatar policy'
);

insert into auth.users (id)
values ('71000000-0000-4000-8000-000000000001');
insert into public.workspaces (id, name, slug)
values ('72000000-0000-4000-8000-000000000001', 'Avatar Test', 'avatar-test');

select lives_ok(
  $$insert into public.onlyevs_brand_assets (
      workspace_id, shop_slug, purpose, storage_path, public_url,
      mime_type, byte_size, created_by
    ) values (
      '72000000-0000-4000-8000-000000000001', 'avatar-test', 'logo',
      '72000000-0000-4000-8000-000000000001/avatar-test/local.png',
      'http://127.0.0.1:54321/storage/v1/object/public/onlyevs-brand-assets/local.png',
      'image/png', 32, '71000000-0000-4000-8000-000000000001'
    )$$,
  'local Supabase brand URLs remain valid for controlled browser tests'
);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'evhost-user-avatars',
      '71000000-0000-4000-8000-000000000001/avatar-00000000-0000-4000-8000-000000000002.png',
      '71000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )$$,
  'an authenticated user can insert an avatar inside their own folder'
);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner_id, metadata)
    values (
      'evhost-user-avatars',
      '71000000-0000-4000-8000-000000000099/avatar-00000000-0000-4000-8000-000000000003.png',
      '71000000-0000-4000-8000-000000000001',
      '{}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'an authenticated user cannot insert an avatar inside another user folder'
);

reset role;

select * from finish();
rollback;
