-- ---------------------------------------------------------------------------
-- 0028 — an owner or manager may publish and archive a colleague's post
--
-- `posts_write` was declared `FOR ALL` with the author condition in its WITH CHECK only:
--
--   using      (centre_id in (select caller_staff_centre_ids()))
--   with check (centre_id in (select caller_staff_centre_ids())
--               and (author_id is null or author_id = auth.uid()))
--
-- Which produced two different problems that 0022's split made visible, and 0025 fixed one of.
--
-- 0025 removed DELETE: the author condition was absent from it, so any educator could destroy
-- a colleague's write-up of a child's day while being correctly refused permission to edit it.
--
-- THIS ONE IS THE UPDATE SIDE, and it fails in the opposite direction. `publishPost` and
-- `archivePost` are UPDATEs, and the WITH CHECK is evaluated against the resulting row — whose
-- `author_id` is still the colleague's. So **nobody but the author can publish or archive a
-- post**, including the centre's owner. The screen offers both buttons to every staff member
-- (`canManage={isStaff}`), so a manager pressing Publish on an educator's draft got a bare
-- 42501 through `actionError`. Offered by the UI, refused by the policy, and no test covered
-- the combination because the fixture publishes its own posts.
--
-- WHY THE POLICY MOVES RATHER THAN THE BUTTON
--
-- Hiding the button from managers would make the two consistent and would be wrong about the
-- domain. A manager is accountable for what a centre publishes to its whānau: they have to be
-- able to hold back a draft that names a child whose consent is not in place, and to archive
-- something already sent. An educator writes the daily record; a manager is answerable for it.
--
-- WHAT DOES NOT CHANGE
--
-- `posts_write_insert` keeps the strict author condition, so **nobody can create a post
-- attributed to somebody else** — that is impersonation of a professional record and there is no
-- reason for it. The residual hole this leaves is narrow and worth naming: a manager could now
-- hand-craft an UPDATE that reassigns `author_id`, because the check no longer pins it. Nothing
-- in the app does that (`publishPost` and `archivePost` set one timestamp each), and closing it
-- properly needs a trigger comparing old and new — recorded rather than built, because a trigger
-- to stop a manager doing something the UI does not offer is speculative.
-- ---------------------------------------------------------------------------

drop policy if exists posts_write_update on public.posts;
create policy posts_write_update on public.posts
  as permissive for update to public
  using (
    centre_id in (select public.caller_staff_centre_ids())
    and (
      author_id is null
      or author_id = auth.uid()
      or public.caller_has_role(centre_id, array['owner','manager']::public.member_role[])
    )
  )
  with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (
      author_id is null
      or author_id = auth.uid()
      or public.caller_has_role(centre_id, array['owner','manager']::public.member_role[])
    )
  );

comment on policy posts_write_update on public.posts is
  'The author, or an owner or manager of the centre. A manager is accountable for what the centre '
  'publishes to its whanau, so they must be able to hold back or archive a draft they did not '
  'write — see 0028. Creating a post attributed to somebody else is still refused, by the insert '
  'policy.';
