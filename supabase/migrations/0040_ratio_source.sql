-- ---------------------------------------------------------------------------
-- 0040 — two sources for one number, and the rule that they never blend
--
-- After 0039 there are two ways to answer "how many adults are here": the count
-- somebody typed (`staff_count_events`, 0010) and the people who signed in
-- (`staff_attendance_events`). This is the migration where that becomes a problem,
-- because a compliance figure with two possible derivations and no stated one is
-- worse than either.
--
-- THREE RULES, IN ORDER OF HOW BADLY BREAKING THEM WOULD END
--
-- 1. **Never blend.** Not an average, not a maximum, not "derived if any staff have
--    signed in, otherwise declared". A blended figure is unattributable: nobody
--    reading a binder could say where the number came from, and the binder's whole
--    value is that its provenance is stateable. The centre picks one.
--
-- 2. **Never silently fall back.** If a centre is `derived` and nobody signed in,
--    the answer is zero adults — a visible, alarming, correct statement that nobody
--    recorded their presence. Falling back to the typed count would paper over
--    exactly the failure the switch to derived was meant to expose.
--
-- 3. **Default to `declared`.** Every existing centre keeps the meaning its history
--    already has. A default of `derived` would silently reinterpret every ratio
--    snapshot ever recorded, which is the one thing a compliance record must never
--    do on a deploy.
--
-- WHAT THIS MIGRATION DOES NOT DO
--
-- It does not decide which source a *past* day used. `adults_present_now` answers
-- about now, so the centre's current setting is the right one. Replaying a day in
-- February for a binder is a different question, and it is answered in TypeScript by
-- `replayDay`, which from this commit REQUIRES its caller to state the source — see
-- `staff-as-people.md`. A `DayReplay` that does not know where its adult numbers
-- came from is precisely the ambiguity this file exists to prevent, and making the
-- field optional with a default would recreate it one careless caller later.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.ratio_source as enum ('declared', 'derived');
exception when duplicate_object then null; end $$;

comment on type public.ratio_source is
  'declared: the adult count is a number staff typed. derived: it is the people who signed in. Never both.';

alter table public.centres
  add column if not exists ratio_source public.ratio_source not null default 'declared';

comment on column public.centres.ratio_source is
  'Where the adult half of the ratio comes from. Defaults to declared so no existing centre''s history changes meaning on deploy.';

grant update (ratio_source) on public.centres to authenticated;

-- ---------------------------------------------------------------------------
-- The number itself
--
-- `security invoker` is kept from 0010 and matters more now: the derived branch
-- reads `staff_attendance_events`, whose policy is staff-only. A parent calling this
-- gets zero from either branch, exactly as they do today — no new disclosure, and no
-- special case needed to prevent one.
-- ---------------------------------------------------------------------------

create or replace function public.adults_present_now(p_centre uuid)
returns integer
language sql
stable
security invoker
set search_path = public
as $$
  select case
    when (select c.ratio_source from public.centres c where c.id = p_centre) = 'derived'
    then (
      /*
       * The people whose most recent event today is `in`.
       *
       * Superseded events are excluded first. A correction is a new row citing
       * `corrects`, and it may carry an EARLIER `at` than the row it fixes — somebody
       * signing in at 8:05 and correcting it to 7:50 — so ordering by time alone
       * would pick the original and answer with the wrong state. Excluding anything
       * some other row corrects is transitively right for the same reason
       * `liveAdministrations` is: a correction of a correction removes the middle one
       * as well.
       */
      select count(*)::integer
        from public.staff_members m
       where m.centre_id = p_centre
         and m.archived_at is null
         and (
           select sae.kind
             from public.staff_attendance_events sae
            where sae.staff_member_id = m.id
              and sae.at >= public.centre_day_start(p_centre)
              and not exists (
                select 1 from public.staff_attendance_events c
                 where c.corrects = sae.id
              )
            order by sae.at desc, sae.id desc
            limit 1
         ) = 'in'
    )
    else coalesce(
      (select sce.adults
         from public.staff_count_events sce
        where sce.centre_id = p_centre
          and sce.at >= public.centre_day_start(p_centre)
        order by sce.at desc, sce.id desc
        limit 1),
      -- Zero rather than yesterday's figure, unchanged from 0010: an unrecorded
      -- count is unknown, and a ratio computed against yesterday's staffing would be
      -- confidently wrong. Zero makes the room read as a breach, which is the
      -- failure direction that gets noticed.
      0
    )
  end
$$;

comment on function public.adults_present_now(uuid) is
  'Adults present now, from whichever source the centre has chosen. Never blends the two and never falls back: a derived centre with nobody signed in reports zero, which is the point.';

-- Restated because CREATE OR REPLACE keeps the old ACL and a future DROP + CREATE
-- would not. Same reasoning as 0029 on purge_child.
revoke execute on function public.adults_present_now(uuid) from public, anon;
grant  execute on function public.adults_present_now(uuid) to authenticated, service_role;
