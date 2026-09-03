-- ---------------------------------------------------------------------------
-- 0085 — the enrolment agreement, as an effective-dated weekday pattern
--
-- The clearest structural gap in the child data, and the one two separate things need:
--
--   1. ELI's `ChildBookingSchedule` event, which is exactly this shape: a `ChildEntityId`,
--      an `EffectiveDate`, and a `ChildBookingScheduleDetailList` of `DayTimespan` —
--      weekday code, start time, end time — with `maxOccurs="unbounded"`, so more than one
--      block on a weekday is permitted. Checked against https://eli.minedu.govt.nz/eli.xsd
--      on 2026-09-03.
--   2. Funding Handbook §6-5 and §6-7. §6-5 claims for "all sessions/days a child was
--      **enrolled to attend**, but was absent from"; §6-7 requires that "a child's
--      attendance must **match their enrolment agreement** for at least half of each
--      calendar month". Neither question can be asked of a schema that does not record the
--      agreement.
--
-- Today the product has `bookings` — one row per child per calendar date — and
-- `enrolments.days`, a weekday array with no times. Neither is a pattern with times, and
-- §6-7 needs the pattern to compare against.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THIS IS A CONTRACT, NOT A MEASUREMENT — AND THAT IS SOURCED, NOT ASSUMED
--
-- `unverified-claims` item 50 records the mirror-image trap on the staff side:
-- `staff_contact_hours` (0081) was built as a contracted weekly pattern because the XSD's
-- `ContactHoursDetailList` has that shape, and then §14-2 of the Handbook turned out to ask
-- for "**actual** contact hours … actual contact start and finish times spent teaching
-- children". A schema tells you what a field may contain; only the Handbook says what it
-- means.
--
-- So the same question was asked here before cloning the shape, and the child side answers
-- the OTHER way. §6-5 says "enrolled to attend" and §6-7 says "match their enrolment
-- agreement" — both are explicitly about what was agreed, and the *actuals* they are
-- compared against already exist in `attendance_events`. A contract is the right thing to
-- build here, and the reason is a quotation rather than an inference.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- KEYED ON THE CHILD, NOT THE ENROLMENT, AND TWO INDEPENDENT REASONS AGREE
--
-- The agreement intuitively belongs to an enrolment, so this deserves saying:
--
--   - **The XSD keys it on the child.** `ChildBookingSchedule` carries `ChildEntityId` and
--     no enrolment reference at all. Keying on an enrolment here would mean inventing a
--     mapping at the boundary that the Ministry's own contract does not use.
--   - **`audit_trigger()` can only resolve a centre from a fixed column set** —
--     centre_id, child_id, invoice_id, guardian_id, staff_member_id, post_id, template_id,
--     version_id, run_id. `enrolment_id` is not in it, so keying on the enrolment would
--     need a new branch in that function AND a new entry in the attributability class
--     assertion, in this migration. `0081` chose `staff_member_id` for exactly this reason.
--
-- Sequential enrolments with different agreements are handled by the effective window
-- below rather than by the key, which is what an effective window is for.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ITS RELATIONSHIP TO `enrolments.days`, WHICH IS A DUPLICATION AND IS SAID SO
--
-- `enrolments.days smallint[]` also records which days a child attends. Measured before
-- writing this: it is **display-only** — `formatDays()` renders it on the children list and
-- the enrolment row, and nothing in funding, ratios, the roll or the forecast computes with
-- it. So this table does not duplicate a computed fact.
--
-- It does duplicate a recorded one, and that is a real hazard in a repo that has already
-- had two hand-maintained copies of its design tokens silently diverge. The rule from here:
-- **where a schedule exists it is authoritative, and `enrolments.days` is the coarse older
-- form.** Collapsing them — deriving the display from the schedule and dropping the column —
-- is a follow-up, deliberately not done in the same migration that introduces the table,
-- because the table is empty on the day it ships and a reader that preferred it would show
-- every existing child as having no days. Recorded in `unverified-claims`.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ISO WEEKDAYS, NOT `Mo`/`Tu` STRINGS
--
-- 1 = Monday, matching `enrolments.days` and `staff_contact_hours.weekday`. The XSD's
-- `WeekdayCode` enumerates `Mo Tu We Th Fr Sa Su`, and `eliWeekday()` in
-- `packages/core/src/census.ts` already maps one to the other. Wire formats belong at the
-- boundary — 0081 made the same choice and said so.
-- ---------------------------------------------------------------------------

create table if not exists public.child_booking_schedule (
  id              uuid primary key default gen_random_uuid(),
  child_id        uuid not null references public.children(id) on delete cascade,

  -- ISO weekday, 1 = Monday.
  weekday         smallint not null,
  from_time       time not null,
  to_time         time not null,

  -- The effective window. `effective_to` null means open-ended, which is the normal state
  -- of a current agreement — and note it behaves as INFINITY in the exclusion constraint
  -- below, so an open-ended block must be closed before an overlapping later one is
  -- accepted. That surprised the author of 0081 and is written down here to save the next
  -- person the same half hour.
  effective_from  date not null,
  effective_to    date,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null,

  constraint child_booking_schedule_weekday_valid
    check (weekday between 1 and 7),
  constraint child_booking_schedule_times_ordered
    check (to_time > from_time),
  constraint child_booking_schedule_window_ordered
    check (effective_to is null or effective_to >= effective_from),

  -- No two blocks may cover the same minute of the same weekday for one child while their
  -- effective windows overlap. Postgres has no `timerange`, so both times are anchored to
  -- the same arbitrary date and it cancels; `weekday with =` already confines the
  -- comparison to one day. The fourth dimension is the effective window, which is what
  -- makes superseding an agreement legal while double-booking a Tuesday is not.
  --
  -- Same idiom as `shifts_no_overlap` (0041) and `staff_contact_hours_no_overlap` (0081).
  constraint child_booking_schedule_no_overlap exclude using gist (
    child_id with =,
    weekday  with =,
    tsrange(('2000-01-01'::date + from_time), ('2000-01-01'::date + to_time), '[)') with &&,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
  )
);

create index if not exists child_booking_schedule_child_idx
  on public.child_booking_schedule (child_id, weekday, effective_from desc);

comment on table public.child_booking_schedule is
  'The enrolment agreement as a recurring weekday pattern with times: what the child is enrolled to ATTEND, not what was observed. The observed side is attendance_events. Funding Handbook 6-5 claims for sessions a child was enrolled to attend and was absent from; 6-7 compares attendance against this agreement. Keyed on the child because the ELI ChildBookingSchedule event is, and because audit_trigger() can resolve a centre from child_id. Where a row exists here it is authoritative over enrolments.days, which is the coarse display-only form.';

comment on column public.child_booking_schedule.effective_to is
  'Null means open-ended, and behaves as infinity in the overlap constraint - so an open-ended block blocks a later overlapping one until it is closed. Ending one block and starting another is how an agreement is changed, which 6-7 requires when attendance stops matching it.';

comment on column public.child_booking_schedule.weekday is
  'ISO weekday, 1 = Monday, matching enrolments.days and staff_contact_hours. The ELI WeekdayCode strings (Mo, Tu, ...) are a wire format and are mapped at the boundary by eliWeekday() in @ece/core.';

-- ---------------------------------------------------------------------------
-- Who may write it: owner or manager at the child's own centre.
--
-- A new predicate, because the existing ones do not answer this question. `enrolments_write`
-- can use `caller_has_role(centre_id, ...)` directly because `enrolments` carries a
-- `centre_id`; this table does not, deliberately, so the role has to be resolved through the
-- child. `caller_is_staff_for_child` is the read-side predicate and is too broad — an
-- educator may read a child's record and may not rewrite the agreement their funding rests
-- on.
--
-- Definer, so it is not narrowed by the policies on `children`. Exactly the shape and
-- reasoning of `caller_may_roster` (0041), which is the write counterpart to
-- `caller_is_staff_for_member`.
-- ---------------------------------------------------------------------------
create or replace function public.caller_may_enrol(p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.children c
     where c.id = p_child
       and public.caller_has_role(c.centre_id, array['owner', 'manager']::public.member_role[])
  )
$$;

comment on function public.caller_may_enrol(uuid) is
  'Owner or manager at the centre this child is enrolled at. The write counterpart to caller_may_see_child, and narrower than caller_is_staff_for_child on purpose: an educator may read a child''s record and may not rewrite the enrolment agreement their funding rests on.';

revoke all on function public.caller_may_enrol(uuid) from public;
revoke execute on function public.caller_may_enrol(uuid) from anon;
grant execute on function public.caller_may_enrol(uuid) to authenticated, service_role;

alter table public.child_booking_schedule enable row level security;

-- Verb-split rather than `for all`, and the delete USING is written character-identical to
-- the insert WITH CHECK. 0025's lesson: a narrowing condition placed only in WITH CHECK is
-- not enforced on DELETE, because PostgreSQL checks USING for that — and the class assertion
-- in rls_isolation.sql compares the two.
drop policy if exists child_booking_schedule_select on public.child_booking_schedule;
create policy child_booking_schedule_select on public.child_booking_schedule
  for select using (public.caller_may_see_child(child_id));

drop policy if exists child_booking_schedule_write_insert on public.child_booking_schedule;
create policy child_booking_schedule_write_insert on public.child_booking_schedule
  for insert with check (public.caller_may_enrol(child_id));

drop policy if exists child_booking_schedule_write_update on public.child_booking_schedule;
create policy child_booking_schedule_write_update on public.child_booking_schedule
  for update
  using (public.caller_may_enrol(child_id))
  with check (public.caller_may_enrol(child_id));

drop policy if exists child_booking_schedule_write_delete on public.child_booking_schedule;
create policy child_booking_schedule_write_delete on public.child_booking_schedule
  for delete using (public.caller_may_enrol(child_id));

-- The grant is the FIRST check Postgres makes, before any policy. A table with perfect
-- policies and no grant is unreachable.
revoke all on public.child_booking_schedule from anon, authenticated, service_role;
grant select, insert, update, delete on public.child_booking_schedule to authenticated, service_role;

-- DELETE is granted, and that is a decision rather than a default. An agreement entered
-- wrongly this morning should be removable; an agreement that has been superseded should be
-- closed with an `effective_to` instead, so the history a funding claim rests on survives.
-- The screen offers the second and the API offers both, which is the same split
-- `staff_contact_hours` made.

-- Audited. `child_id` is in audit_trigger()'s resolvable column set, so no new branch is
-- needed — see the header. 0059 exists because three tables carried triggers that silently
-- wrote nothing for months, and the class assertion checks the trigger by name.
drop trigger if exists child_booking_schedule_audit on public.child_booking_schedule;
create trigger child_booking_schedule_audit
  after insert or update or delete on public.child_booking_schedule
  for each row execute function public.audit_trigger();
