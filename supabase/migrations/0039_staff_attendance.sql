-- ---------------------------------------------------------------------------
-- 0039 — who was actually here
--
-- `staff_count_events` (0010) records *a number a human typed*. The evidence binder
-- already says so out loud: "adult counts are figures entered by staff, not derived
-- from individual staff sign-in". That sentence is honest and it is the gap this
-- closes.
--
-- WHY THIS IS A SECOND TABLE AND NOT A COLUMN ON `attendance_events`
--
-- They look identical — in, out, a time, a client key — and merging them would be
-- the obvious tidy-up. Two reasons not to, and the first is enough:
--
--   1. The RLS is different in a way that does not compose. A guardian may sign
--      their OWN CHILD in, so `attendance_events` is readable and writable by
--      parents through `caller_may_see_child`. No guardian may see staff hours.
--      One table means one set of policies, and the merged predicate would be an
--      OR of two unrelated boundaries — which is how a parent ends up able to read
--      when the manager arrived.
--   2. `attendance_events` underpins a funding claim on the Crown. Staff hours are
--      a payroll and compliance record. Putting them in one table invites a future
--      query that sums the wrong rows into a claim.
--
-- So it is a near-copy, deliberately, with the same idempotency contract and the
-- same append-only discipline. The duplication is the cheaper mistake.
--
-- WHY IT KEYS ON `staff_member_id` AND NOT ON A USER
--
-- Because relievers exist and 0038 exists to hold them. A table keyed on
-- `auth.users` could not sign in the person who covers Tuesdays, which is precisely
-- the adult whose presence the ratio most needs to count. `recorded_by` is the
-- account that tapped the button; `staff_member_id` is who it was about, and they
-- are routinely different people.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_attendance_events (
  id              bigserial primary key,

  -- Cascade is unreachable in practice: nobody holds DELETE on `staff_members`, and
  -- departure is `finished_on`. Declared anyway so the rule is stated rather than
  -- implied by an absence.
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,

  -- Same enum as children's attendance. The vocabulary is genuinely shared even
  -- though the tables are not.
  kind            public.attendance_kind not null,

  /**
   * Supplied by the client, for the reason 0009 gives at length: a sign-in made in
   * the carpark with no signal and flushed forty minutes later happened at 8:05, not
   * at 8:45. The database sanity-checks it rather than trusting it.
   */
  at              timestamptz not null,

  /** The account that tapped. Often not the person being signed in. */
  recorded_by     uuid references auth.users(id) on delete set null,

  /** Fixed at enqueue, reused on every retry. Identical contract to 0009. */
  client_uuid     uuid not null unique,

  corrects        bigint references public.staff_attendance_events(id) on delete set null,
  note            text,
  created_at      timestamptz not null default now(),

  constraint staff_attendance_not_future check (at <= now() + interval '2 hours'),
  constraint staff_attendance_not_ancient check (at > now() - interval '14 days'),
  constraint staff_attendance_correction_has_note
    check (corrects is null or length(coalesce(note, '')) >= 3)
);

comment on table public.staff_attendance_events is
  'Per-person staff sign-in and sign-out. Append-only; a correction is a new row citing corrects. Deliberately separate from attendance_events: different boundary, and one of them underpins a funding claim.';

create index if not exists staff_attendance_member_idx
  on public.staff_attendance_events (staff_member_id, at desc);

-- ---------------------------------------------------------------------------
-- The predicate
--
-- A function rather than an `exists (select … from staff_members …)` inline in the
-- policy, and this is the direct application of the lesson `conventions.md` records
-- from 0036: **a policy expression that reads another table inherits that table's
-- RLS**. Inline, this would be silently narrowed by `staff_members_select` — which
-- happens to give the right answer today and would stop doing so the moment that
-- policy changed, in a direction nobody would notice.
--
-- `security definer` so it answers honestly, `search_path` pinned, and EXECUTE
-- revoked from PUBLIC exactly as 0022 did for every other boundary predicate.
-- ---------------------------------------------------------------------------

create or replace function public.caller_is_staff_for_member(p_member uuid)
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
       and m.centre_id in (select public.caller_staff_centre_ids())
  )
$$;

comment on function public.caller_is_staff_for_member(uuid) is
  'Is the caller staff at the centre this person works for? A definer function, not an inline exists(), so it is not silently narrowed by the policies on staff_members.';

revoke execute on function public.caller_is_staff_for_member(uuid) from public;
grant  execute on function public.caller_is_staff_for_member(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.staff_attendance_events enable row level security;

/*
 * Staff at the centre, and nobody else. No guardian branch at all — this is the
 * whole reason the table is separate, and the absence is the point.
 */
drop policy if exists staff_attendance_select on public.staff_attendance_events;
create policy staff_attendance_select on public.staff_attendance_events
  for select using (public.caller_is_staff_for_member(staff_member_id));

/*
 * Any staff member may record for any colleague at their centre.
 *
 * Not "only for yourself": a manager signs in the reliever who has no account, and
 * a door tablet held by one person signs in the team arriving together. Restricting
 * it to self would make the reliever unsignable, which is the adult the ratio most
 * needs.
 *
 * `recorded_by` is still pinned to the caller — an event is always attributable to
 * whoever tapped, even when it is about somebody else.
 */
drop policy if exists staff_attendance_write_insert on public.staff_attendance_events;
create policy staff_attendance_write_insert on public.staff_attendance_events
  for insert with check (
    public.caller_is_staff_for_member(staff_member_id)
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- No UPDATE and no DELETE policy. A correction is a new row citing `corrects`, and
-- the grants below withhold the verbs as well — enforced twice, the same shape as
-- `attendance_events`.

revoke all on public.staff_attendance_events from anon, authenticated, service_role;

grant select, insert on public.staff_attendance_events to authenticated;
grant usage on sequence public.staff_attendance_events_id_seq to authenticated;

-- `service_role` reads only. It bypasses RLS but not grants, which is what makes
-- "no staff hour was ever altered" true of the whole system rather than only of its
-- API callers — and staff hours become a payroll figure.
grant select on public.staff_attendance_events to service_role;

-- Append-only: the row is the record, so no audit trigger. Carried by name in the
-- exemption lists in `rls_isolation.sql` and `scripts/security-review.ts`.
