-- ---------------------------------------------------------------------------
-- 0043 — shutting the four doors 0042 opened, before there is a key
--
-- `caller_centre_ids()` answers "which centres does this caller belong to" without
-- asking in what capacity. Every policy that reads it therefore trusts a membership
-- row rather than a person, and a `kiosk` membership is a membership row.
--
-- Six policies read it. Audited one at a time against the live catalogue:
--
--   centres_select          KEEP.    A kiosk has to render the centre's name.
--   audit_insert            KEEP.    The audit trigger writes as whoever acted; a
--                                    kiosk that cannot be audited is worse.
--   posts_select            NARROW.  Published pānui. Centre-wide notices about
--                                    children, on a screen in the entrance.
--   media_select            NARROW.  The photographs attached to those pānui. This
--                                    is the one that matters.
--   memberships_select      NARROW.  The staff list. No names, but no reason.
--   message_threads_insert  NARROW.  A door tablet could open a thread as the
--                                    centre, with `child_id` null.
--
-- WHY AN ALLOWLIST AND NOT `role <> 'kiosk'`
--
-- Because a denylist is wrong the next time somebody adds a role, and wrong
-- silently — the new role inherits everything and nothing fails. `caller_staff_
-- centre_ids()` already names its three roles explicitly, which is why it needed no
-- change here at all: it was safe against a role that did not exist when it was
-- written. That is the property worth copying.
--
-- So `caller_person_centre_ids()` names the four human roles. A fifth role added
-- tomorrow gets nothing until somebody writes it down, and the failure direction is
-- "the new role cannot see enough", which is visible in a minute rather than never.
-- ---------------------------------------------------------------------------

/**
 * Centres where the caller is a *person*, as opposed to a device the centre owns.
 *
 * The role-aware counterpart to `caller_centre_ids()`. Same shape, same definer
 * treatment, one extra clause — and the clause is an allowlist for the reason above.
 */
create or replace function public.caller_person_centre_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select centre_id
    from public.memberships
   where user_id = auth.uid()
     and revoked_at is null
     and role in ('owner', 'manager', 'educator', 'parent')
$$;

comment on function public.caller_person_centre_ids() is
  'Centres where the caller is a person rather than a device. An allowlist of the four human roles, so a role added later inherits nothing by default.';

revoke execute on function public.caller_person_centre_ids() from public;
grant  execute on function public.caller_person_centre_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The four narrowings.
--
-- Each is the existing policy with one function name changed. They are restated in
-- full rather than patched, because a policy is not a diff — reading it has to tell
-- you what it does now.
-- ---------------------------------------------------------------------------

drop policy if exists posts_select on public.posts;
create policy posts_select on public.posts
  for select using (
    centre_id in (select public.caller_staff_centre_ids())
    or (
      published_at is not null
      and archived_at is null
      and centre_id in (select public.caller_person_centre_ids())
      and (
        kind = 'panui'::public.post_kind
        or exists (
          select 1 from public.post_children pc
           where pc.post_id = posts.id
             and pc.child_id in (select public.caller_ward_ids())
        )
      )
    )
  );

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
         and p.kind = 'panui'::public.post_kind
         and p.published_at is not null
         and p.centre_id in (select public.caller_person_centre_ids())
    )
  );

drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select using (centre_id in (select public.caller_person_centre_ids()));

drop policy if exists message_threads_insert on public.message_threads;
create policy message_threads_insert on public.message_threads
  for insert with check (
    (started_by is null or started_by = auth.uid())
    and (
      centre_id in (select public.caller_staff_centre_ids())
      or (
        centre_id in (select public.caller_person_centre_ids())
        and (child_id is null or child_id in (select public.caller_ward_ids()))
      )
    )
  );

/*
 * `centres_select` and `audit_insert` are deliberately untouched.
 *
 * A kiosk renders the centre's name, so it reads `centres`. And it must be able to
 * write an audit row: the alternative is a device that acts and leaves no trace,
 * which is the opposite of what an append-only attendance record is for. Both are
 * recorded here so the next reader knows the omission was decided rather than
 * missed.
 */
