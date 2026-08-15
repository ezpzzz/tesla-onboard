-- Public profile photos are user-owned presentation media. Authentication and
-- workspace authorization never depend on this bucket or auth user metadata.
-- Keep brand uploads testable against the local Supabase origin while
-- retaining HTTPS-only public URLs everywhere else.
alter table public.onlyevs_brand_assets
  drop constraint if exists onlyevs_brand_assets_public_url_check;
alter table public.onlyevs_brand_assets
  add constraint onlyevs_brand_assets_public_url_check
  check (
    public_url ~ '^https://'
    or public_url ~ '^http://(127[.]0[.]0[.]1|localhost)(:[0-9]+)?/'
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evhost-user-avatars',
  'evhost-user-avatars',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy evhost_user_avatars_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evhost-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy evhost_user_avatars_update_own on storage.objects
  for update to authenticated
  using (
    bucket_id = 'evhost-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'evhost-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy evhost_user_avatars_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evhost-user-avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
