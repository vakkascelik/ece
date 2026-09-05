-- ---------------------------------------------------------------------------
-- 0095 — an adult on their break does not count towards the ratio
--
-- `ratioInputCaveat()` in @ece/core has said since 2026-08-18 that "an adult does not count
-- while on a break or on non-contact time", and it has been true: `adults_present_now`
-- counts, on the `derived` source, staff whose MOST RECENT attendance row is `in`. Somebody
-- at lunch has not signed out, so they were counted.
--
-- `0094` gave that fact somewhere to live. This is the half that makes the ratio use it, and
-- until now the two were separate: `staff_off_floor` fed §9-4's funding figures and nothing
-- else. A caveat is only retired when the thing it describes stops being true, so this
-- migration and that sentence move together — see the header of `ratios.ts`.
--
-- WHY ONLY THE `derived` SOURCE
--
-- A `declared` centre records an adult count somebody typed. There is nothing per-person to
-- subtract from, and the note field on that screen is where "two on lunch" already goes. So
-- the `else` branch is untouched, and 0040's rule stands: the two sources never blend.
--
-- HALF-OPEN, `[from_time, to_time)`
--
-- The same bound as `staff_off_floor_no_overlap`. A break ending at 13:00 and non-contact
-- time starting at 13:00 are adjacent, and at exactly 13:00 the person is back on the floor.
-- Getting this inclusive at both ends would make the two adjacent intervals both current for
-- one instant, which is the sort of thing that shows up as a ratio flickering by one adult.
--
-- SECURITY INVOKER, UNCHANGED, AND IT MATTERS THAT THE NEW READ IS TOO
--
-- The function is `security invoker` and stays so. `staff_off_floor`'s select policy is
-- `caller_is_staff_for_member`, exactly like `staff_attendance_events` — so a caller who
-- cannot see the attendance cannot see the exclusions either, and both answer the same way
-- for the same person. A definer read here would let a caller who can see neither still be
-- affected by one, which is a different figure for the same room depending on who asked.
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
       * The people whose most recent event today is `in`, MINUS anyone currently off the
       * floor.
       *
       * Superseded events are excluded first. A correction is a new row citing `corrects`,
       * and it may carry an EARLIER `at` than the row it fixes — somebody signing in at 8:05
       * and correcting it to 7:50 — so ordering by time alone would pick the original and
       * answer with the wrong state. Excluding anything some other row corrects is
       * transitively right for the same reason `liveAdministrations` is: a correction of a
       * correction removes the middle one as well.
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
         /*
          * 0094, and the reason this function changed at all. The centre's own wall clock —
          * `now() at time zone ce.timezone` — because AGENTS §4 rule 3 applies here as much
          * as anywhere: PostgREST connects as UTC and New Zealand is half a day ahead, so
          * `current_date` would put the morning's breaks on yesterday.
          */
         and not exists (
           select 1
             from public.staff_off_floor f
             join public.centres ce on ce.id = m.centre_id
            where f.staff_member_id = m.id
              and f.on_date = (now() at time zone ce.timezone)::date
              and f.from_time <= (now() at time zone ce.timezone)::time
              and f.to_time   >  (now() at time zone ce.timezone)::time
         )
    )
    else coalesce(
      (select sce.adults
         from public.staff_count_events sce
        where sce.centre_id = p_centre
          and sce.at >= public.centre_day_start(p_centre)
        order by sce.at desc, sce.id desc
        limit 1),
      -- Zero rather than yesterday's figure, unchanged from 0010: an unrecorded count is
      -- unknown, and a ratio computed against yesterday's staffing would be confidently
      -- wrong. Zero makes the room read as a breach, which is the failure direction that
      -- gets noticed.
      0
    )
  end
$$;

comment on function public.adults_present_now(uuid) is
  'Adults present now, from whichever source the centre has chosen. Never blends the two and never falls back: a derived centre with nobody signed in reports zero, which is the point. Since 0095 the derived branch also excludes anyone inside a staff_off_floor interval right now - Schedule 2 says an adult does not count while at lunch, on a break, or on non-contact time, and until 0094 there was nowhere to record it. The declared branch is untouched: a typed total has nothing per-person to subtract.';

-- Restated because CREATE OR REPLACE keeps the old ACL and a future DROP + CREATE would not.
-- Same reasoning as 0029 on purge_child, and as 0040 gave for this same function.
revoke execute on function public.adults_present_now(uuid) from public, anon;
grant  execute on function public.adults_present_now(uuid) to authenticated, service_role;

/*
  ASSERTED, not assumed — the whole point of the migration, checked against a real row.

  0089 shipped a silent audit trigger and 0094's own inline self-check turned out to skip on a
  database with no staff members. So this one creates everything it needs, proves the count
  moves, and rolls itself back by deleting what it made.
*/
do $$
declare
  v_centre uuid;
  v_member uuid;
  v_before integer;
  v_during integer;
  v_local  time;
  v_source public.ratio_source;
  v_flipped boolean := false;
begin
  select id into v_centre from public.centres where ratio_source = 'derived' limit 1;
  if v_centre is null then
    select id, ratio_source into v_centre, v_source from public.centres limit 1;
    if v_centre is null then
      raise notice '0095: no centres, the exclusion was not exercised';
      return;
    end if;
    -- Borrowed, and PUT BACK below. A self-check that leaves a centre on a different ratio
    -- source than it chose would change a live figure to prove a point about a live figure.
    update public.centres set ratio_source = 'derived' where id = v_centre;
    v_flipped := true;
  end if;

  insert into public.staff_members (centre_id, full_name)
  values (v_centre, '0095 self-check') returning id into v_member;

  insert into public.staff_attendance_events (staff_member_id, kind, at, client_uuid)
  values (v_member, 'in', public.centre_day_start(v_centre) + interval '1 minute', gen_random_uuid());

  v_before := public.adults_present_now(v_centre);

  -- An interval that certainly contains the centre's current wall clock.
  select (now() at time zone ce.timezone)::time into v_local
    from public.centres ce where ce.id = v_centre;

  insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time, reason)
  select v_member, (now() at time zone ce.timezone)::date,
         greatest(v_local - interval '30 minutes', time '00:00:00'),
         least(v_local + interval '30 minutes', time '23:59:59'),
         '0095 self-check'
    from public.centres ce where ce.id = v_centre;

  v_during := public.adults_present_now(v_centre);

  delete from public.staff_off_floor where staff_member_id = v_member;
  delete from public.staff_attendance_events where staff_member_id = v_member;
  delete from public.staff_members where id = v_member;
  if v_flipped then
    update public.centres set ratio_source = v_source where id = v_centre;
  end if;

  if v_before < 1 then
    raise exception '0095: the signed-in self-check member was not counted (got %)', v_before;
  end if;
  if v_during <> v_before - 1 then
    raise exception '0095: being off the floor did not reduce the count (% then %)', v_before, v_during;
  end if;
end $$;
