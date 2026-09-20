-- Profile pictures + Google sign-in support.
-- Run BEFORE deploying the matching app code. One transaction: all or nothing.

-- 1. profiles.avatar_url --------------------------------------------------------
alter table public.profiles add column avatar_url text;

-- Users may now edit their picture as well as their name. Still NOT is_host or
-- email: column-level grants are the only thing stopping a user from promoting
-- themselves (see 001). GRANT is additive, so this just extends the list.
grant update (first_name, last_name, avatar_url) on public.profiles to authenticated;

-- 2. Signup trigger: understand Google's metadata ------------------------------
-- Email signups send first_name / last_name (see Auth.jsx). Google sends
-- full_name / name, given_name / family_name and picture instead, so without
-- this a Google user would get an empty profile. The first non-empty source wins.
-- is_host is still never read from metadata (users can edit their own).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
declare
  meta      jsonb := new.raw_user_meta_data;
  full_name text  := nullif(trim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), '');
  first     text  := split_part(full_name, ' ', 1);
begin
  insert into public.profiles (id, first_name, last_name, email, avatar_url)
  values (
    new.id,
    coalesce(nullif(meta ->> 'first_name', ''), nullif(meta ->> 'given_name', ''), nullif(first, '')),
    coalesce(
      nullif(meta ->> 'last_name', ''),
      nullif(meta ->> 'family_name', ''),
      nullif(trim(substr(full_name, length(first) + 1)), '')
    ),
    new.email,
    coalesce(meta ->> 'avatar_url', meta ->> 'picture')
  );
  return new;
end;
$$;

-- 3. Avatar storage --------------------------------------------------------------
-- Public bucket: pictures are shown to other members, and public URLs work in
-- <img> tags without a login. 2 MB cap and image types only, enforced by Storage
-- itself (the app also resizes to a 256px JPEG before uploading).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Each user may only touch files inside a folder named after their own user id
-- (avatars/<user-id>/avatar.jpg). Without this, anyone logged in could overwrite
-- or delete anyone else's picture. SELECT is included because replacing a file
-- (upsert) needs to see the existing one.
create policy "Users can read own avatar files"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can upload own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can replace own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Users can delete own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
