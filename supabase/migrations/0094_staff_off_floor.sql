-- ---------------------------------------------------------------------------
-- 0094 — the hours an adult was present and NOT counted
--
-- Funding Handbook §9-4 wants staff hours "at times when they were counted towards
-- regulated (ratio) staff". Nothing records that, and three tables each get close:
--
--   staff_attendance_events (0039)  in/out, per person. When they were HERE, not when
--                                   they counted. Two enum values and no third state.
--   staff_count_events (0010)       a centre-level number a human typed. Its own header
--                                   says modelling "who counts toward a ratio while on
--                                   their break" is "a real feature that belongs with the
--                                   rest of centre operations, not smuggled in here".
--   staff_leave (0041)              day-granular, so it cannot express a lunch break.
--
-- WHY THIS RECORDS THE EXCEPTIONS RATHER THAN THE COUNTED INTERVALS
--
-- The alternative was two new values on `attendance_kind` — `off_floor` and `on_floor`.
-- That enum is `('in','out')` (0009:36) and is shared by THREE things: children's
-- attendance, staff attendance, and the signature of `public.kiosk_sign_child(uuid,
-- public.attendance_kind, timestamptz, uuid, uuid, text)` (0044:248). Adding values would
-- give children's attendance two states that can never apply to a child, and change a
-- function signature the kiosk depends on, to model something that is not an arrival or a
-- departure.
--
-- Recording only the exceptions is also how the fact is captured today. The adult-count
-- screen's note field carries the placeholder "two on lunch break" (AdultCount.tsx), which
-- is the same information as free text nothing can read. So: sign-in and sign-out stay the
-- record of presence, and this table subtracts from it.
--
-- Counted hours = paired staff_attendance_events MINUS the intervals here.
--
-- TWO CONSUMERS, which is this repo's bar for building something:
--
--   1. §9-4's StaffHourQualifiedCount and StaffHourNotQualifiedCount on the RS7 return.
--   2. `ratioInputCaveat()` in @ece/core, whose last clause has admitted since 2026-08-18
--      that "an adult does not count while on a break or on non-contact time". It renders
--      on three surfaces and can finally be narrowed.
--
-- WHAT THIS TABLE DOES NOT DECIDE
--
-- Whether the hours can be computed at all. `centres.ratio_source` defaults to 'declared'
-- (0040), and a declared centre records NO per-person staff attendance — only the typed
-- aggregate. For such a centre there is nothing for these intervals to subtract from, and
-- §9-4's figures stay unavailable. That is a property of the centre's configuration, not a
-- defect here, and the return reports it as a named gap rather than a zero.
--
-- NO TIME-RELATIVE CHECK. 0078 had to undo six of those because a CHECK is enforced while a
-- dump's rows land, which made the operational core unrestorable more than a fortnight after
-- a backup. An interval recorded late, or a backfill of last month, is a data-quality
-- question and not a constraint's business.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_off_floor (
  id              uuid primary key default gen_random_uuid(),

  -- No centre_id. The centre is the staff member's fact, and duplicating it here would give
  -- two answers to one question — the same reasoning 0085 gives for child_booking_schedule.
  -- `audit_trigger()` already resolves a centre through `staff_member_id` (0090:89).
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,

  on_date         date not null,
  from_time       time not null,
  to_time         time not null,

  /*
    Why, in words, and deliberately NOT an enum.

    Schedule 2's wording is "at lunch, on a break, or on non-contact time" — a description,
    not a published code list. A CHECK enumerating those three would be inventing a
    vocabulary the Ministry has not published, which AGENTS §7 forbids, and §9-4 does not
    care why: the hours are excluded either way. So this is operational, like
    `service_closures.reason_note`.
  */
  reason          text,

  recorded_at     timestamptz not null default now(),
  recorded_by     uuid references auth.users(id) on delete set null,

  constraint staff_off_floor_times_ordered check (to_time > from_time),

  /*
    A person cannot be off the floor twice at once. Same mechanism and same reasoning as
    `shifts_no_overlap` (0041:64) — and the `2000-01-01` anchor is arbitrary and never read,
    because `on_date with =` has already partitioned by day.

    `[)` half-open, so a break ending at 13:00 and non-contact time starting at 13:00 are
    adjacent rather than overlapping. `service_closures` uses `[]` because a closure's end
    date is an inclusive day; a time boundary is an instant and behaves the other way.
  */
  constraint staff_off_floor_no_overlap exclude using gist (
    staff_member_id with =,
    on_date with =,
    tsrange(('2000-01-01'::date + from_time), ('2000-01-01'::date + to_time), '[)') with &&
  )
);

create index if not exists staff_off_floor_member_idx
  on public.staff_off_floor (staff_member_id, on_date desc);

comment on table public.staff_off_floor is
  'Intervals when a staff member was present but NOT counted towards regulated staff - a lunch break, or non-contact time. Funding Handbook 9-4 wants staff hours "at times when they were counted towards regulated (ratio) staff", and this is the subtraction: counted hours are the paired staff_attendance_events minus these. Records the EXCEPTIONS rather than the counted intervals, so sign-in and sign-out remain the record of presence and attendance_kind is not widened - that enum is shared with children''s attendance and with kiosk_sign_child''s signature. Cannot help a centre whose ratio_source is declared: it records no per-person staff attendance for these to subtract from.';

comment on column public.staff_off_floor.reason is
  'Free text, and deliberately not an enum. Schedule 2 says "at lunch, on a break, or on non-contact time" - a description, not a published code list, and 9-4 does not care which. Operational only, never serialised.';

alter table public.staff_off_floor enable row level security;

/*
  READ is every colleague; WRITE is owner or manager.

  The read predicate is `caller_is_staff_for_member` (0039:91), the same one staff attendance
  uses: a person's presence is not private from the people they work beside, and the ratio
  surfaces need it. A parent reads none of it, which is what the separate table guarantees.

  The write predicate is `caller_may_roster` (0041:144), the same one `shifts` and
  `staff_leave` use. Recording that somebody was off the floor changes a funding figure and a
  ratio assessment, so it is a management act — an educator cannot mark themselves uncounted.

  Verb-split, with the delete USING character-identical to the insert WITH CHECK. 0025's
  lesson, and there is a class assertion in rls_isolation.sql comparing the two.
*/

drop policy if exists staff_off_floor_select on public.staff_off_floor;
create policy staff_off_floor_select on public.staff_off_floor
  for select using (public.caller_is_staff_for_member(staff_member_id));

drop policy if exists staff_off_floor_write_insert on public.staff_off_floor;
create policy staff_off_floor_write_insert on public.staff_off_floor
  for insert with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_off_floor_write_update on public.staff_off_floor;
create policy staff_off_floor_write_update on public.staff_off_floor
  for update
  using (public.caller_may_roster(staff_member_id))
  with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_off_floor_write_delete on public.staff_off_floor;
create policy staff_off_floor_write_delete on public.staff_off_floor
  for delete using (public.caller_may_roster(staff_member_id));

/*
  A new table needs its own table grant. Postgres tests the table privilege BEFORE the
  policy, so without this line every caller is refused with 42501 and no policy ever runs.
  Not column-scoped: only `centres` is, in this schema.
*/
revoke all on public.staff_off_floor from anon, authenticated, service_role;
grant select, insert, update, delete on public.staff_off_floor to authenticated, service_role;

/*
  Audited, because it is editable and it changes a funding figure. `audit_trigger()` already
  resolves the centre through `staff_member_id` (0090:89), so unlike 0089 this needs no
  companion migration — checked before writing it, which is the whole lesson of 0090.
*/
drop trigger if exists staff_off_floor_audit on public.staff_off_floor;
create trigger staff_off_floor_audit
  after insert or update or delete on public.staff_off_floor
  for each row execute function public.audit_trigger();

/*
  The audit wiring, asserted rather than assumed — 0089 shipped a silent audit trigger and
  the 0059 guard caught it the same day. This is that guard, inline, so a future edit to
  `audit_trigger()`'s column list cannot quietly orphan this table.
*/
do $$
declare
  v_member uuid;
  v_id     uuid;
  v_rows   integer;
begin
  select id into v_member from public.staff_members limit 1;
  if v_member is null then
    raise notice '0094: no staff members, audit wiring not exercised';
    return;
  end if;

  insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time, reason)
  values (v_member, current_date, '12:00', '12:30', '0094 self-check')
  returning id into v_id;

  select count(*) into v_rows
    from public.audit_events
   where entity = 'staff_off_floor' and entity_id = v_id::text;

  delete from public.staff_off_floor where id = v_id;

  if v_rows = 0 then
    raise exception '0094: the audit trigger did not record an insert';
  end if;
end $$;
