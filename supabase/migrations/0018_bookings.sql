-- 0018 — bookings and the waitlist
--
-- WHY THIS IS NOT `enrolments.days`
--
-- An enrolment carries a contracted pattern: "Mondays, Tuesdays and Wednesdays". A booking is what
-- is actually planned for a specific date — and the two diverge constantly. A swap for one week, a
-- family holiday, an extra day for a hospital appointment, a public holiday the centre is closed.
--
-- Rolling those into the enrolment would mean editing a funding-relevant contract every time a
-- parent asks for a Thursday, and losing the pattern that the contract actually says. So the
-- enrolment stays the agreement and bookings are the plan.
--
-- WHAT A BOOKING IS NOT
--
-- It is not attendance. A booked day the child did not attend is an absence, and a day they attended
-- without a booking still happened. Funding is claimed from `attendance_events` and nothing here
-- feeds it — a claim built on what was *planned* rather than what was *recorded* would be a claim
-- for hours nobody observed.

do $$ begin
  create type public.booking_status as enum ('booked', 'absent', 'cancelled', 'closed');
exception when duplicate_object then null; end $$;

comment on type public.booking_status is
  'absent = booked and did not attend (usually still charged). cancelled = withdrawn in time. closed = the centre was shut, so nobody owes anything.';

create table if not exists public.bookings (
  id         uuid primary key default gen_random_uuid(),
  centre_id  uuid not null references public.centres(id)  on delete cascade,
  child_id   uuid not null references public.children(id) on delete cascade,

  on_date    date not null,
  status     public.booking_status not null default 'booked',

  /** Planned session times, for rooms that run sessions rather than all-day care. */
  from_time  time,
  to_time    time,

  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),

  -- One booking per child per day. Two would double-count a roll and, later, an invoice.
  constraint bookings_one_per_day unique (child_id, on_date),
  constraint bookings_times_ordered check (to_time is null or from_time is null or to_time > from_time)
);

create index if not exists bookings_centre_date_idx on public.bookings (centre_id, on_date);
create index if not exists bookings_child_idx       on public.bookings (child_id, on_date desc);

-- ---------------------------------------------------------------------------
-- Waitlist
-- ---------------------------------------------------------------------------

/**
 * An enquiry that is not an enrolment.
 *
 * Separate from `children` on purpose. A waitlist entry is a name, a phone number and a hoped-for
 * start date — creating a child record for it would put somebody who may never attend into the roll,
 * the ratio and the retention schedule.
 */
create table if not exists public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  centre_id     uuid not null references public.centres(id) on delete cascade,

  child_name    text not null,
  date_of_birth date,
  guardian_name text not null,
  contact       text not null,

  /** When they hope to start, and which days they want. */
  wanted_from   date,
  wanted_days   smallint[] not null default '{}',

  note          text,
  /** Set when they enrol or withdraw, with which. */
  resolved_at   timestamptz,
  resolution    text,

  created_at    timestamptz not null default now(),

  constraint waitlist_names_present check (
    length(trim(child_name)) > 0 and length(trim(guardian_name)) > 0
  ),
  constraint waitlist_days_valid check (wanted_days <@ array[1,2,3,4,5,6,7]::smallint[]),
  constraint waitlist_resolution_complete check ((resolved_at is null) = (resolution is null))
);

create index if not exists waitlist_centre_idx on public.waitlist (centre_id, created_at)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.bookings enable row level security;
alter table public.waitlist enable row level security;

-- Staff see the roll they are planning; a guardian sees their own child's booked days, which is what
-- makes "am I down for Thursday" answerable without a phone call.
drop policy if exists bookings_select on public.bookings;
create policy bookings_select on public.bookings
  for select using (public.caller_may_see_child(child_id));

-- Booking is office work. A parent asking for a Thursday is a message, not a self-serve write —
-- because a booking has a fee attached and the centre has a licence capacity to respect.
drop policy if exists bookings_write on public.bookings;
create policy bookings_write on public.bookings
  for all
  using      (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]))
  with check (
    public.caller_has_role(centre_id, array['owner','manager']::public.member_role[])
    -- The booking's centre must be the child's centre, or a two-site operator can book a child
    -- into the wrong roll.
    and exists (select 1 from public.children c where c.id = child_id and c.centre_id = bookings.centre_id)
  );

/**
 * The waitlist is owner and manager only, and not visible to any parent.
 *
 * It holds other families' names and contact details, and the order they are in. A parent seeing the
 * queue would be reading a list of who is ahead of them, which is not theirs — and is the kind of
 * thing that turns an ordinary wait into a complaint.
 */
drop policy if exists waitlist_all on public.waitlist;
create policy waitlist_all on public.waitlist
  for all
  using      (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]));

revoke all on public.bookings from anon, authenticated, service_role;
revoke all on public.waitlist from anon, authenticated, service_role;

grant select, insert, update, delete on public.bookings to authenticated, service_role;
grant select, insert, update on public.waitlist to authenticated, service_role;
-- No DELETE on the waitlist. "Were we ever offered a place" is a question families ask, and a
-- deleted enquiry cannot answer it. Resolving closes the entry.
