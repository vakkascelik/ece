-- ---------------------------------------------------------------------------
-- 0075 — evidence photos
--
-- Photos on incidents and checklist runs: the ice pack on the arm, the latch that
-- would not close. 1Place has both ("Photos From Details Section", per-answer
-- checklist photos); this schema had neither, and for three weeks the recorded
-- reason was wrong.
--
-- WHY THIS IS NOT `media`, AND WHY THAT IS NO LONGER ABOUT CONSENT
--
-- 0068 deferred checklist photos because a photo with a child in the background
-- was believed to be consent-gated child media. The owner's ruling of 2026-08-29
-- corrected that: photo consent exists for *publication* — `photo_internal` is the
-- whānau journal, `photo_public` is website/social/print — and an evidence photo
-- is internal documentation, a purpose consent was never about. (Recorded with its
-- limits as unverified-claims item 42; 0068's header still gives the old reason
-- and cannot be edited, because applied migrations are checksummed.)
--
-- What survives the correction is the separation itself, with a better reason:
-- routing evidence through the consent-gated `media` table would either block
-- legitimate evidence on a gate that was never about it, or teach people to
-- route around that gate. So: the second storage bucket in this schema's history,
-- its own table, staff-only, and no join to `media_children` — ever.
--
-- WHY ONE TABLE FOR TWO PARENTS, WHEN 0030 REJECTED THE GENERIC TABLE
--
-- incident-register.md rejects a generic `child_register_events` because a jsonb
-- payload defeats the audit log's names-not-values rule and per-kind CHECKs are
-- unwritable. Neither objection reaches this table: there is no payload — the
-- columns are identical whichever parent a photo hangs off — and `audit_trigger()`
-- attributes by the row's own `centre_id`. Two tables would duplicate the policy,
-- grant, storage machinery and sweeper for zero divergence. `num_nonnulls = 1`
-- keeps a photo from claiming both parents or neither.
--
-- FROZEN WITH ITS PARENT
--
-- A photo can be attached or removed only while its parent is still working
-- material — a draft incident, an incomplete run. Finalising the report freezes
-- its photos with it, exactly as the text freezes: the photograph a reviewer sees
-- is the photograph that was there when the report went final. Enforced in the
-- policies' subqueries, not a trigger, so there is no SECURITY DEFINER function
-- whose EXECUTE grant can be forgotten (0031 and 0072 were the same omission).
--
-- There is no UPDATE at all. A caption is set at upload; a wrong photo on a draft
-- is deleted and re-added; a wrong photo on a final report is what amendments are
-- for. An object in the bucket is never overwritten (the 0014 rule) and is
-- deletable only while no row references it — so the app deletes the ROW first,
-- then the object, the reverse of `deleteMedia`'s order, and a frozen photo's
-- object is unreachable for deletion by construction.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidence',
  'evidence',
  false,
  26214400, -- 25MB, matching `media`
  -- Images only. `media` also carries video and PDF; an evidence photo is a
  -- photograph of a thing, and widening the list is a one-line migration the day
  -- somebody needs a walkthrough video.
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.evidence_photos (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,

  /** Exactly one parent. The CHECK below is the whole shape of this table. */
  incident_id uuid references public.incidents(id) on delete cascade,
  run_id      uuid references public.checklist_runs(id) on delete cascade,

  /**
   * `<centre_id>/<uuid>.<ext>`, the 0014 convention: the first segment lets the
   * storage policies say "your centre only" without a join, and the filename is
   * never the original because an original filename can carry a child's name.
   */
  storage_path text not null unique,
  mime_type    text,
  byte_size    integer,
  caption      text,

  uploaded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint evidence_photos_one_parent check (num_nonnulls(incident_id, run_id) = 1)
);

comment on table public.evidence_photos is
  'Staff-only documentation photos on incidents and checklist runs. Not media: no consent applies (consent is for publication — owner ruling 2026-08-29, unverified-claims 42) and nothing here is ever surfaced to a family or joined to media_children. Attach and remove only while the parent is a draft incident or an incomplete run; a finalised parent freezes its photos with it.';

create index if not exists evidence_photos_incident_idx
  on public.evidence_photos (incident_id) where incident_id is not null;
create index if not exists evidence_photos_run_idx
  on public.evidence_photos (run_id) where run_id is not null;

-- ---------------------------------------------------------------------------
-- Policies
--
-- Staff at the centre, nobody else. Note the deliberate asymmetry with the
-- incident itself: a guardian reads their child's final incident REPORT, and does
-- not read its photos. Whether a photo should ride the report to the child's own
-- guardian is an open product decision recorded in incident-register.md — widening
-- later is one policy line, narrowing later is a disclosure.
-- ---------------------------------------------------------------------------

alter table public.evidence_photos enable row level security;

drop policy if exists evidence_photos_select on public.evidence_photos;
create policy evidence_photos_select on public.evidence_photos
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists evidence_photos_insert on public.evidence_photos;
create policy evidence_photos_insert on public.evidence_photos
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (uploaded_by is null or uploaded_by = auth.uid())
    /*
      The parent must belong to the same centre and still be working material.
      The subqueries run under the caller's own RLS on the parent tables, which
      staff at the centre already satisfy — so what these refuse is exactly a
      cross-centre pointer or a frozen parent.
    */
    and (
      (incident_id is not null and exists (
        select 1 from public.incidents i
        where i.id = incident_id
          and i.centre_id = evidence_photos.centre_id
          and i.status = 'draft'))
      or
      (run_id is not null and exists (
        select 1 from public.checklist_runs r
        where r.id = run_id
          and r.centre_id = evidence_photos.centre_id
          and r.completed_at is null))
    )
  );

drop policy if exists evidence_photos_delete on public.evidence_photos;
create policy evidence_photos_delete on public.evidence_photos
  for delete using (
    centre_id in (select public.caller_staff_centre_ids())
    and (
      (incident_id is not null and exists (
        select 1 from public.incidents i
        where i.id = incident_id and i.status = 'draft'))
      or
      (run_id is not null and exists (
        select 1 from public.checklist_runs r
        where r.id = run_id and r.completed_at is null))
    )
  );

-- No UPDATE policy and no UPDATE grant: a photo is attached, not edited.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.evidence_photos from anon, authenticated, service_role;
grant select, insert, delete on public.evidence_photos to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Storage policies
--
-- Simpler than `media`'s: this store is staff-only on both sides, so reads need no
-- row-deferring function — the folder IS the tenant. Deletion is the one place a
-- function earns its keep: an object is deletable only while NO row references it,
-- which protects a frozen photo's object with the same freeze as its row, and
-- still lets the upload-failure path clean up an object whose row never landed.
-- ---------------------------------------------------------------------------

create or replace function public.can_delete_evidence_object(p_name text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select not exists (
    select 1 from public.evidence_photos e where e.storage_path = p_name
  )
$$;

comment on function public.can_delete_evidence_object(text) is
  'True when no evidence_photos row references the object, i.e. it is an orphan. SECURITY INVOKER on purpose: within the caller''s own centre folder (the storage policy''s other conjunct) RLS shows staff every referencing row, so "no row" means orphan rather than "no row I may see".';

revoke execute on function public.can_delete_evidence_object(text) from public, anon;
grant execute on function public.can_delete_evidence_object(text) to authenticated, service_role;

drop policy if exists evidence_objects_select on storage.objects;
create policy evidence_objects_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] in (select cs::text from public.caller_staff_centre_ids() cs)
  );

drop policy if exists evidence_objects_insert on storage.objects;
create policy evidence_objects_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] in (select cs::text from public.caller_staff_centre_ids() cs)
  );

-- No UPDATE policy: objects are never overwritten. Replacing a photo is a new
-- object and a new row — the 0014 rule, kept for the same reason.

drop policy if exists evidence_objects_delete on storage.objects;
create policy evidence_objects_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] in (select cs::text from public.caller_staff_centre_ids() cs)
    and public.can_delete_evidence_object(name)
  );

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

drop trigger if exists evidence_photos_audit on public.evidence_photos;
create trigger evidence_photos_audit
  after insert or update or delete on public.evidence_photos
  for each row execute function public.audit_trigger();
