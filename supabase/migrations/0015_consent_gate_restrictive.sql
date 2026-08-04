-- 0015 — the consent gate was defeated by another policy on the same table
--
-- THE BUG
--
-- 0013 put the consent check inside `media_select`:
--
--   using ( (staff or guardian or panui) and media_consent_satisfied(id) )
--
-- and separately declared `media_write` as `FOR ALL`. Withdrawing a child's photo consent
-- correctly hid existing media from their whānau — and did **not** hide it from staff.
--
-- Two facts about Postgres RLS combine into that:
--
--   1. `FOR ALL` covers SELECT as well as INSERT/UPDATE/DELETE.
--   2. Multiple *permissive* policies are OR-ed together.
--
-- So `media_write`'s `USING (centre_id in staff centres)` was a second, independent grant of
-- SELECT with no consent condition on it. Staff matched it, the `and` in the other policy never
-- had to be satisfied, and a photograph a family had withdrawn consent for stayed on screen for
-- every educator in the building.
--
-- The parent was hidden correctly, which is what made it survive review: the retroactive half of
-- the gate looked like it worked, because for the caller most likely to be tested it did.
--
-- THE FIX, AND WHY IT IS A RESTRICTIVE POLICY
--
-- The obvious repair is to split `media_write` so it no longer covers SELECT. That is done
-- below, and on its own it would be enough today — and it would break again the next time
-- somebody adds a permissive policy to this table, because every permissive policy is another
-- OR branch that can skip the consent check.
--
-- A **restrictive** policy is AND-ed with all of them. It cannot be routed around by adding
-- another policy, which is the property a consent gate needs: it should be impossible to widen
-- by accident. So the consent condition moves there and stays there.
--
-- General lesson for this schema: a rule that must hold for *every* reader belongs in a
-- restrictive policy. A rule about *which* readers belongs in a permissive one.

-- ---------------------------------------------------------------------------
-- 1. The write policy stops granting reads
-- ---------------------------------------------------------------------------

drop policy if exists media_write on public.media;

create policy media_insert on public.media
  for insert
  with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (uploaded_by is null or uploaded_by = auth.uid())
  );

-- Column-scoped to `audience` and `caption` by the grant in 0013, so this cannot repoint a
-- storage_path at a different file after the consent check passed.
create policy media_update on public.media
  for update
  using      (centre_id in (select public.caller_staff_centre_ids()))
  with check (centre_id in (select public.caller_staff_centre_ids()));

-- Staff must be able to delete media whose consent has been withdrawn — which is precisely
-- media they can no longer read. So the DELETE policy deliberately carries no consent
-- condition, and the restrictive policy below is scoped to SELECT only.
create policy media_delete on public.media
  for delete
  using (centre_id in (select public.caller_staff_centre_ids()));

-- ---------------------------------------------------------------------------
-- 2. Consent becomes a restrictive policy
-- ---------------------------------------------------------------------------

-- Removed from the permissive policy, which goes back to answering only "which readers".
drop policy if exists media_select on public.media;
create policy media_select on public.media
  for select using (
    centre_id in (select public.caller_staff_centre_ids())
    or exists (
      select 1 from public.media_children mc
       where mc.media_id = media.id
         and mc.child_id in (select public.caller_ward_ids())
    )
    or exists (
      select 1 from public.posts p
       where p.id = media.post_id
         and p.kind = 'panui'
         and p.published_at is not null
         and p.centre_id in (select public.caller_centre_ids())
    )
  );

/**
 * The gate. AND-ed with every permissive policy on this table, now and in future.
 *
 * SELECT only: staff need to be able to delete media they can no longer read, which is the
 * whole point of being able to withdraw consent.
 */
create policy media_consent_required on public.media
  as restrictive
  for select
  using (public.media_consent_satisfied(id));

comment on policy media_consent_required on public.media is
  'Restrictive, so it cannot be routed around by adding another permissive policy. Applies to staff as well as whanau — a photo a family has withdrawn consent for is not one an educator should be browsing either.';

-- ---------------------------------------------------------------------------
-- 3. The same trap, checked on the tables around it
-- ---------------------------------------------------------------------------
--
-- Every other `FOR ALL` policy in this schema was re-read after finding this. They are all
-- *narrower* than or equal to the matching select policy, so OR-ing them adds no visibility:
--
--   children_write, guardians_write   owner/manager only; children_select already allows all
--                                     staff, so the write policy is a subset
--   health_write, medication_write    staff-for-child; identical to the select condition
--   post_children_write, media_children_write   staff-for-child; same
--   posts_write                       staff centres; posts_select already allows staff
--                                     everything at their centre, drafts included
--
-- `media` was the only case where the select policy was *narrower* than the write policy, which
-- is exactly the shape that produces this bug — a restriction added to one policy while another
-- grants the same verb without it.
--
-- Anything added later that must hold for every reader goes in a restrictive policy.
