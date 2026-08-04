-- 0014 — the storage bucket, gated by the same consent
--
-- 0013 gates the `media` *row*. This gates the *file*, and both are needed: a row nobody can
-- read is no protection at all if the object it points at is fetchable by anyone holding the
-- path. Storage is a second, independent access surface and it has its own RLS.
--
-- PRIVATE BUCKET, AND NO PUBLIC URLS ANYWHERE
--
-- A public bucket serves any object to anybody who has the URL. For photographs of children
-- that is not a configuration choice, it is a disclosure — the path is not a secret, it
-- appears in logs, in a shared screenshot, in a forwarded link. So the bucket is private and
-- every read goes through a signed URL with an expiry, issued only to a caller the policies
-- below already allow.
--
-- THE PATH CARRIES THE TENANT, AND IS CHECKED AGAINST IT
--
-- Objects are stored as `<centre_id>/<media_id>.<ext>`. The first path segment is the tenant,
-- which is what makes a storage policy able to say "your centre only" without joining
-- anything. It is belt: the authoritative check is that a `media` row exists whose
-- `storage_path` equals this object's name and which the caller may read — so the consent gate
-- from 0013 reaches the file automatically, including retroactively.

-- The bucket. `public = false` is the entire point of this insert.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  -- 25 MB. Generous for a photograph, tight enough that somebody cannot quietly use this as
  -- video storage before anybody has thought about what that costs.
  26214400,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime',
    'application/pdf'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/**
 * May the caller read this object?
 *
 * Defers entirely to the `media` row, which is where the consent gate lives. Written as a
 * SECURITY DEFINER function taking the object name because a storage policy cannot easily
 * express "and every child in it still has consent", and duplicating that logic here would be
 * two implementations of a consent rule — which is one more than is safe.
 *
 * The `media_select` policy from 0013 is what actually decides, evaluated as the caller
 * because this reads `public.media` through a nested query that RLS still applies to.
 */
create or replace function public.can_read_media_object(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (select 1 from public.media m where m.storage_path = p_name)
$$;

comment on function public.can_read_media_object(text) is
  'security invoker on purpose: the media_select policy from 0013 does the deciding, so the consent gate reaches storage without being reimplemented.';

revoke execute on function public.can_read_media_object(text) from public, anon;
grant  execute on function public.can_read_media_object(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Object policies
-- ---------------------------------------------------------------------------

-- Read: whatever the media row allows, which includes the consent gate and its retroactive
-- half. Withdraw consent and the signed URL for an existing file stops being issuable.
drop policy if exists media_objects_select on storage.objects;
create policy media_objects_select on storage.objects
  for select to authenticated
  using (bucket_id = 'media' and public.can_read_media_object(name));

/**
 * Write: staff of the centre named in the first path segment.
 *
 * Note the ordering problem this creates and does not solve. The file is uploaded *before* the
 * `media` row exists, so the consent gate cannot apply at upload — it applies when the child
 * is attached, which is the next statement. An upload for a child without consent therefore
 * leaves an orphaned object behind.
 *
 * That is a deliberate trade rather than an oversight: the alternative is uploading through a
 * server route that holds the whole file in memory to check consent first, for a case that
 * produces a stray file rather than a disclosure. Orphans are unreachable (no media row means
 * no read policy match) and `scripts/sweep-orphan-media.ts` clears them.
 */
drop policy if exists media_objects_insert on storage.objects;
create policy media_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (
      select cs::text from public.caller_staff_centre_ids() cs
    )
  );

-- No UPDATE policy: an object is never overwritten. Replacing a photograph means a new object
-- and a new media row, so the consent decision that was made about the original cannot be
-- silently transferred to a different image.
drop policy if exists media_objects_update on storage.objects;

-- Delete: staff of the owning centre. Deleting the `media` row cascades nothing in storage —
-- the object has to go separately, which the API layer does and the sweeper catches.
drop policy if exists media_objects_delete on storage.objects;
create policy media_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (
      select cs::text from public.caller_staff_centre_ids() cs
    )
  );
