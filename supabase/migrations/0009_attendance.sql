-- 0009 — attendance
--
-- The table that makes the app open every morning, and the one Phase 2's offline
-- design exists for.
--
-- APPEND-ONLY, AND FOR A DIFFERENT REASON THAN THE AUDIT LOG
--
-- `audit_events` is append-only so it cannot be doctored. This is append-only
-- because it makes offline sync tractable. A sign-in is an event that happened at a
-- moment; it never needs editing, so two tablets in the same room cannot produce a
-- conflict. There is nothing to merge — only to order and to de-duplicate.
--
-- That is the whole reason a full bidirectional sync engine (PowerSync,
-- ElectricSQL, WatermelonDB) is not in this project. Conflict resolution is the
-- expensive part of offline, and append-only data has no conflicts.
--
-- A correction is a new event pointing at the one it corrects. "Signed in at 8:05,
-- actually it was 7:50" is two rows, not an edited row, and after an incident the
-- question is always what was recorded at the time.
--
-- WHY `at` IS SUPPLIED BY THE CLIENT
--
-- Because it has to be. A sign-in made in the carpark with no signal and flushed
-- forty minutes later happened at 8:05, not at 8:45 — and attendance times decide
-- funded hours. So the client states the time and the database sanity-checks it: a
-- couple of hours of clock skew is tolerated, the future is not.
--
-- WHO MAY RECORD IT
--
-- Staff **and** the child's own guardians. Not a simplification: in New Zealand the
-- attendance record underpinning a funding claim is signed by a parent or guardian,
-- so a product where only staff can sign a child in produces a record the centre
-- cannot claim against.

do $$ begin
  create type public.attendance_kind as enum ('in', 'out');
exception when duplicate_object then null; end $$;

create table if not exists public.attendance_events (
  id           bigserial primary key,
  child_id     uuid not null references public.children(id) on delete cascade,
  kind         public.attendance_kind not null,

  -- When it happened, per the device. See the note above.
  at           timestamptz not null default now(),

  recorded_by  uuid references auth.users(id) on delete set null,

  /**
   * The idempotency key, generated on the device before the write is attempted.
   *
   * This is what makes a retry safe. An outbox flush that half-succeeds — request
   * sent, response lost — retries the same `client_uuid`, and the unique constraint
   * turns the second attempt into a no-op instead of a second sign-in. Without it,
   * the failure mode of a flaky connection is a child signed in three times and a
   * ratio that reads wrong.
   */
  client_uuid  uuid not null unique,

  -- A correction points at what it corrects. Null for an ordinary event.
  corrects     bigint references public.attendance_events(id) on delete set null,
  -- Required when correcting, by the policy below. "Why" is the useful part.
  note         text,

  -- When the server received it, as distinct from when it happened. The gap between
  -- the two is how long the device was offline, which is worth being able to see.
  created_at   timestamptz not null default now(),

  -- Tolerates device clock skew; refuses a sign-in dated into the future, which
  -- would otherwise let somebody pre-record attendance.
  constraint attendance_not_future check (at <= now() + interval '2 hours'),
  -- A flush after a long outage is normal; a fortnight is not, and backdating
  -- attendance is how a funding claim becomes fraud.
  constraint attendance_not_ancient check (at > now() - interval '14 days'),
  constraint attendance_correction_has_note check (corrects is null or length(coalesce(note, '')) >= 3)
);

comment on table public.attendance_events is
  'Append-only sign-in/sign-out events. Never updated, never deleted; a correction is a new row pointing at the one it corrects.';
comment on column public.attendance_events.client_uuid is
  'Device-generated idempotency key. A retried outbox flush is a no-op, not a duplicate sign-in.';
comment on column public.attendance_events.at is
  'When it happened per the device, not when it arrived. An offline sign-in keeps its real time, which decides funded hours.';

create index if not exists attendance_child_at_idx  on public.attendance_events (child_id, at desc);
create index if not exists attendance_recent_idx    on public.attendance_events (at desc);

-- ---------------------------------------------------------------------------
-- Derived state, never stored
-- ---------------------------------------------------------------------------
--
-- There is no `children.is_present` column and there will not be one. A stored
-- counter drifts — a missed sign-out, a failed write, a race between two tablets —
-- and drift in a ratio is not a display bug, it is a compliance failure that
-- reports itself as compliant. The present roll is computed from the events every
-- time it is asked for.

/**
 * Start of today, in the centre's own timezone, as a timestamptz.
 *
 * Not `current_date`: the session is UTC, which is yesterday for the whole New
 * Zealand morning — so a sign-in at 8am would be compared against a day boundary
 * that has not happened yet, and the roll would be empty until lunchtime. This is
 * the same bug 0006 fixed on `children.date_of_birth`.
 */
create or replace function public.centre_day_start(p_centre uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select ((now() at time zone ce.timezone)::date)::timestamp at time zone ce.timezone
    from public.centres ce
   where ce.id = p_centre
$$;

/**
 * The most recent event today for every child, with the centre carried so a whole
 * roll can be read in one query.
 *
 * `security_invoker = on`, so the caller's own policies on `attendance_events` and
 * `children` both apply — a parent sees their own child's state and an educator sees
 * the room, from the same view.
 *
 * Scoped to today on purpose. A child never signed out yesterday should not appear
 * as present this morning; that is a forgotten sign-out, which is a real and common
 * thing, and treating it as attendance would inflate both the roll and the ratio.
 */
drop view if exists public.attendance_today;
create view public.attendance_today
with (security_invoker = on) as
  select distinct on (ae.child_id)
    ae.child_id,
    c.centre_id,
    ae.id            as event_id,
    ae.kind,
    ae.at,
    ae.recorded_by
  from public.attendance_events ae
  join public.children c on c.id = ae.child_id
  where ae.at >= public.centre_day_start(c.centre_id)
  order by ae.child_id, ae.at desc, ae.id desc;

comment on view public.attendance_today is
  'Latest attendance event per child since the start of today in the centre timezone. kind = in means present.';

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.attendance_events enable row level security;

-- Staff at the centre, or the child's own guardian. Same shape as health and
-- consent: `caller_may_see_child` covers both.
drop policy if exists attendance_select on public.attendance_events;
create policy attendance_select on public.attendance_events
  for select using (public.caller_may_see_child(child_id));

drop policy if exists attendance_insert on public.attendance_events;
create policy attendance_insert on public.attendance_events
  for insert with check (
    public.caller_may_see_child(child_id)
    -- Attributed to whoever recorded it. An attendance record is what a funding
    -- claim rests on, so "who signed this child in" has to be answerable.
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- No UPDATE and no DELETE policy. A correction is a new row; the grants below
-- withhold the verbs as well, so this is enforced twice for the same reason the
-- audit log is.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.attendance_events from anon, authenticated, service_role;

grant select, insert on public.attendance_events to authenticated;
grant usage on sequence public.attendance_events_id_seq to authenticated;

-- service_role gets the same two verbs and no more. Attendance underpins a funding
-- claim; the credential the app runs scheduled jobs with has no business rewriting
-- it, exactly as with the audit log and consent.
grant select, insert on public.attendance_events to service_role;
grant usage on sequence public.attendance_events_id_seq to service_role;

grant select on public.attendance_today to authenticated, service_role;

revoke execute on function public.centre_day_start(uuid) from public, anon;
grant  execute on function public.centre_day_start(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
--
-- So the office web view and every tablet in the building agree within a second.
-- Two educators looking at different numbers is worse than one of them having to
-- refresh, because both will believe what is in front of them.
--
-- Realtime respects RLS on the subscriber's own connection, so this publishes the
-- table without widening who can read it.
do $$ begin
  alter publication supabase_realtime add table public.attendance_events;
exception
  when duplicate_object then null;
  when undefined_object then
    -- No such publication on a bare Postgres. The app degrades to polling; it is
    -- not worth failing a migration over.
    raise notice 'supabase_realtime publication not found — skipping realtime setup';
end $$;

-- Deliberately no audit trigger on this table. It is already append-only and
-- attributed, so an audit row per sign-in would double the write volume of the
-- busiest table in the product to record what the row itself records. See the note
-- in 0005.
