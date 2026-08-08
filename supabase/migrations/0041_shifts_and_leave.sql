-- ---------------------------------------------------------------------------
-- 0041 — who is *meant* to be here
--
-- Everything in Phase 10 so far records what happened. This records what is
-- planned, and it is the half that makes the forecast possible: `bookings` already
-- holds the children expected on a given day, and this holds the adults. Neither is
-- much use alone; together they answer "next Tuesday afternoon you are one adult
-- short", a week before anybody is standing in the room counting.
--
-- WHY `on_date` + `from_time` + `to_time` AND NOT A TIMESTAMPTZ RANGE
--
-- Because `bookings` (0018) is shaped that way, and the forecast has to line the two
-- up. A roster is written as "Tuesday, 8 till 4" in the centre's own clock, and
-- storing instants would mean converting both sides back to local time on every
-- comparison — with the conversion, and therefore the bug, in a different place each
-- time. Matching the existing shape means the join is a join.
--
-- WHAT THIS DELIBERATELY IS NOT
--
-- A payroll system. There is no pay rate, no entitlement balance, no accrual. Leave
-- here answers one question — is this person available on that day — because that is
-- what the ratio needs to know. Anything more is a different product, and half of one
-- is worse than none.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.shift_status as enum ('planned', 'confirmed', 'cancelled');
exception when duplicate_object then null; end $$;

comment on type public.shift_status is
  'planned is the draft roster; confirmed is what people have been told. Cancelled rows stay so a change of plan is visible rather than invisible.';

create table if not exists public.shifts (
  id              uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,

  on_date         date not null,
  from_time       time not null,
  to_time         time not null,

  role_note       text,
  status          public.shift_status not null default 'planned',

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint shifts_times_ordered check (to_time > from_time),

  /**
   * One person cannot be in two places at once.
   *
   * Same mechanism as `enrolments_no_overlap` and the same reasoning: a double-booked
   * person is counted twice in a forecast, and the error surfaces as a roster that
   * looks adequately staffed and is not. The database refuses it rather than leaving
   * it to whoever writes the next query.
   *
   * Cancelled shifts are excluded from the constraint — a cancelled 8-till-4 must not
   * block the replacement 8-till-4, which is the whole point of cancelling one.
   *
   * The `2000-01-01` anchor is arbitrary and never read: `on_date with =` already
   * confines the comparison to one day, so the date component only exists because
   * Postgres has no `timerange` type. Both bounds get the same anchor, so it cancels.
   */
  constraint shifts_no_overlap exclude using gist (
    staff_member_id with =,
    on_date with =,
    tsrange(
      ('2000-01-01'::date + from_time),
      ('2000-01-01'::date + to_time),
      '[)'
    ) with &&
  ) where (status <> 'cancelled')
);

comment on table public.shifts is
  'The planned roster. Overlapping shifts for one person are refused, because a double-booked person is counted twice in a forecast and the roster then looks adequately staffed when it is not.';

create index if not exists shifts_date_idx on public.shifts (on_date, from_time);
create index if not exists shifts_member_idx on public.shifts (staff_member_id, on_date desc);

-- ---------------------------------------------------------------------------
-- Leave
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.leave_kind as enum ('annual', 'sick', 'unpaid', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.leave_status as enum ('requested', 'approved', 'declined');
exception when duplicate_object then null; end $$;

create table if not exists public.staff_leave (
  id              uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,

  from_date       date not null,
  to_date         date not null,
  kind            public.leave_kind not null,
  status          public.leave_status not null default 'requested',

  note            text,
  recorded_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint staff_leave_dates_ordered check (to_date >= from_date)
  -- Deliberately NO overlap constraint. Two leave records covering the same day is a
  -- real situation — sick leave declared during booked annual leave — and refusing it
  -- would push the correction outside the system. Only APPROVED leave affects the
  -- forecast, and that is decided when the forecast is computed rather than here.
);

comment on table public.staff_leave is
  'Whether somebody is available, not a payroll entitlement. No rates, no balances, no accrual — the forecast only needs to know who is away.';

create index if not exists staff_leave_member_idx on public.staff_leave (staff_member_id, from_date desc);
create index if not exists staff_leave_range_idx on public.staff_leave (from_date, to_date)
  where status = 'approved';

-- ---------------------------------------------------------------------------
-- Policies
--
-- Read: any staff member of the centre. A roster everybody can see is the point of
-- having one, and somebody who cannot see next week cannot plan around it.
--
-- Write: owner and manager, the same as `staff_members` — the roster decides the
-- forecast, and the forecast is a compliance figure.
--
-- Both reach their centre through `caller_is_staff_for_member`, the definer
-- predicate 0039 added, rather than an inline join. `conventions.md` records why: a
-- policy expression that reads another table inherits that table's RLS, which makes
-- an inline version unpredictable in both directions.
-- ---------------------------------------------------------------------------

/**
 * May the caller roster this person — owner or manager at their centre?
 *
 * The write counterpart to `caller_is_staff_for_member`. A definer function for the
 * same reason that one is: an inline `exists (select … from staff_members …)` in a
 * policy is evaluated as the caller and therefore narrowed by `staff_members_select`,
 * which gives the right answer today and would stop doing so silently the moment that
 * policy changed.
 */
create or replace function public.caller_may_roster(p_member uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.staff_members m
     where m.id = p_member
       and public.caller_has_role(m.centre_id, array['owner', 'manager']::public.member_role[])
  )
$$;

comment on function public.caller_may_roster(uuid) is
  'Owner or manager at the centre this person works for. The write counterpart to caller_is_staff_for_member, and a definer function so it is not narrowed by the policies on staff_members.';

revoke execute on function public.caller_may_roster(uuid) from public;
grant  execute on function public.caller_may_roster(uuid) to authenticated, service_role;

alter table public.shifts      enable row level security;
alter table public.staff_leave enable row level security;

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts
  for select using (public.caller_is_staff_for_member(staff_member_id));

drop policy if exists shifts_write_insert on public.shifts;
create policy shifts_write_insert on public.shifts
  for insert with check (public.caller_may_roster(staff_member_id));

drop policy if exists shifts_write_update on public.shifts;
create policy shifts_write_update on public.shifts
  for update using (public.caller_may_roster(staff_member_id))
          with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_leave_select on public.staff_leave;
create policy staff_leave_select on public.staff_leave
  for select using (public.caller_is_staff_for_member(staff_member_id));

drop policy if exists staff_leave_write_insert on public.staff_leave;
create policy staff_leave_write_insert on public.staff_leave
  for insert with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_leave_write_update on public.staff_leave;
create policy staff_leave_write_update on public.staff_leave
  for update using (public.caller_may_roster(staff_member_id))
          with check (public.caller_may_roster(staff_member_id));

-- No DELETE on either. A cancelled shift and a declined leave request are both facts
-- about what was planned, and a roster somebody can erase cannot show that Tuesday
-- was short before anybody noticed.

revoke all on public.shifts      from anon, authenticated, service_role;
revoke all on public.staff_leave from anon, authenticated, service_role;

grant select, insert, update on public.shifts      to authenticated, service_role;
grant select, insert, update on public.staff_leave to authenticated, service_role;

drop trigger if exists shifts_audit on public.shifts;
create trigger shifts_audit
  after insert or update or delete on public.shifts
  for each row execute function public.audit_trigger();

drop trigger if exists staff_leave_audit on public.staff_leave;
create trigger staff_leave_audit
  after insert or update or delete on public.staff_leave
  for each row execute function public.audit_trigger();
