-- ---------------------------------------------------------------------------
-- 0063 — the absence the centre never heard about
--
-- 0051 let a guardian mark a booked day `absent` from their phone, and stopped there. The
-- row flipped and nothing told anybody: the educator doing the 8:30 roll saw a missing
-- child with no signal the family had already called it in, and rang them — which is the
-- exact phone call the feature exists to prevent. A self-service feature whose output
-- nobody reads is a form that files itself.
--
-- Three additions, all on the same write path:
--
--   1. `bookings.absence_reason` — "sick" and "holiday" are different mornings for the
--      room, and the office was hearing the reason by phone precisely because the button
--      had nowhere to put it.
--   2. The office is told, through the notifications queue 0017 built.
--   3. A range: a week of chickenpox is one submission, not five.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONE NOTIFICATION PER SUBMISSION, NOT PER DAY — WHY THE FUNCTION SPLIT
--
-- The obvious range implementation loops the existing `report_absence`, and it is wrong
-- in a way nobody sees until the first sick week: five days means five notifications to
-- every office member, and a queue that cries five times for one fact is a queue people
-- mute — which un-builds this feature and takes 0057's emergency channel down with it,
-- because the mute is per-app, not per-kind.
--
-- So the single-day logic moves into `report_absence_core` (no notification), and the
-- telling moves into `notify_absence` (one call, whatever the day count). Both are
-- EXECUTE-granted to NOBODY — callable only from inside the two public definer functions,
-- the `kiosk_pin_gate` arrangement from 0062, and for the same reason: `notify_absence`
-- writes into other people's notification inboxes, and as a public function it would let
-- any authenticated caller do that directly with arbitrary text.
--
-- The public surface stays what it was, plus a reason: `report_absence(child, date,
-- reason)` for the button, `report_absence_range(child, from, to, reason)` for the week.
-- The two-argument `report_absence` is dropped, not overloaded — with a defaulted third
-- argument, PostgREST could not choose between the old function and the new one, and
-- every existing caller resolves to the new signature unchanged.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE RANGE IS PER-DAY HONEST, NEVER ALL-OR-NOTHING
--
-- A Monday-to-Friday report where Wednesday has no booking must still record the other
-- four days. Refusing the lot would teach a parent to report day by day — the exact
-- behaviour the range exists to replace — and silently skipping Wednesday without saying
-- so would leave the family believing the centre knows something it half-knows. So the
-- range returns a status per date, and the caller's screen says which days landed and
-- which did not, in words.
--
-- Weekends ride along as `no_booking` rather than being special-cased: the function does
-- not know the centre's week, and a booking is the ground truth it checks anyway.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- QUIET HOURS ARE NOT COMPUTED HERE, STATED RATHER THAN FORGOTTEN
--
-- 0017's design sets `send_after` to the end of quiet hours at write time. This insert
-- leaves it at `now()`: push delivery has never run once (unverified-claims item on push),
-- the office roles this notifies read it in-app where quiet hours do not apply, and
-- computing per-recipient quiet windows in SQL would duplicate the logic the delivery
-- worker must own anyway. When the worker exists, it gates sends on preference and quiet
-- hours for every kind at once — the right single home for that rule.
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column if not exists absence_reason text;

comment on column public.bookings.absence_reason is
  'Why the family said the child is away — free text from the guardian, optional. Only '
  'meaningful on an absent booking, and the CHECK enforces that: a status change away '
  'from absent must clear it, because a reason describing a state the row is no longer '
  'in is misinformation with a timestamp.';

alter table public.bookings
  drop constraint if exists bookings_reason_only_when_absent;

alter table public.bookings
  add constraint bookings_reason_only_when_absent
  check (absence_reason is null or status = 'absent');

alter table public.bookings
  drop constraint if exists bookings_reason_length;

alter table public.bookings
  add constraint bookings_reason_length
  check (absence_reason is null or length(absence_reason) between 1 and 500);

-- ---------------------------------------------------------------------------
-- The core: one day, no telling
-- ---------------------------------------------------------------------------

/**
 * 0051's body, verbatim in its checks, minus the public grant and plus the reason.
 * Returns the same statuses, with one addition: `reason_too_long`, refused here in words
 * rather than left to the CHECK constraint — a constraint violation raises, and a raise
 * is an error screen on a parent's phone where a status is a sentence.
 */
create or replace function public.report_absence_core(
  p_child  uuid,
  p_date   date,
  p_reason text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today  date;
  v_status public.booking_status;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_child not in (select public.caller_ward_ids()) then
    return 'not_permitted';
  end if;

  if v_reason is not null and length(v_reason) > 500 then
    return 'reason_too_long';
  end if;

  select (now() at time zone c.timezone)::date
    into v_today
    from public.children ch
    join public.centres c on c.id = ch.centre_id
   where ch.id = p_child;

  if p_date < v_today then
    return 'past';
  end if;

  select b.status into v_status
    from public.bookings b
   where b.child_id = p_child and b.on_date = p_date;

  if not found then
    return 'no_booking';
  end if;

  if v_status = 'absent' then
    return 'already_absent';
  end if;

  if v_status <> 'booked' then
    return 'not_bookable';
  end if;

  update public.bookings
     set status = 'absent',
         absence_reason = v_reason
   where child_id = p_child and on_date = p_date;

  return 'recorded';
end;
$$;

comment on function public.report_absence_core(uuid, date, text) is
  '0051''s single-day logic without the notification. EXECUTE granted to nobody: the '
  'public entry points are report_absence and report_absence_range, which add the telling.';

revoke all on function public.report_absence_core(uuid, date, text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The telling: once per submission
-- ---------------------------------------------------------------------------

/**
 * One notification to each office member — owner and manager, not educators, who meet the
 * absence on the attendance screen's own strip, and not the kiosk, which is a device.
 *
 * `kind = 'attendance'`: the enum has carried that value since 0017 and nothing had ever
 * written it. The route lands the reader on the screen that shows the strip.
 */
create or replace function public.notify_absence(
  p_child  uuid,
  p_dates  date[],
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_centre     uuid;
  v_child_name text;
  v_reporter   text;
  v_dates_text text;
begin
  select c.centre_id,
         coalesce(nullif(trim(c.preferred_name), ''), c.first_name) || ' ' || c.last_name
    into v_centre, v_child_name
    from public.children c
   where c.id = p_child;

  -- The guardian's own name, resolvable because guardians are unique per (centre, user).
  select g.full_name into v_reporter
    from public.guardians g
   where g.centre_id = v_centre
     and g.user_id = auth.uid()
     and g.archived_at is null;

  v_dates_text := case
    when array_length(p_dates, 1) = 1 then to_char(p_dates[1], 'FMDay DD Mon')
    else to_char(p_dates[1], 'FMDay DD Mon') || ' to ' ||
         to_char(p_dates[array_upper(p_dates, 1)], 'FMDay DD Mon') ||
         ' (' || array_length(p_dates, 1) || ' days)'
  end;

  insert into public.notifications (centre_id, user_id, kind, title, body, route)
  select v_centre,
         m.user_id,
         'attendance',
         v_child_name || ' will be away',
         coalesce(v_reporter, 'A guardian') || ' says ' || v_child_name ||
           ' will be away ' || v_dates_text ||
           coalesce('. Reason: ' || p_reason, '.'),
         '/attendance'
    from public.memberships m
   where m.centre_id = v_centre
     and m.revoked_at is null
     and m.role in ('owner', 'manager');
end;
$$;

comment on function public.notify_absence(uuid, date[], text) is
  'One notification to the office per absence submission, however many days it covers — '
  'five rows for one sick week is a queue people mute. EXECUTE granted to nobody; called '
  'only from inside report_absence and report_absence_range.';

revoke all on function public.notify_absence(uuid, date[], text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The public surface
-- ---------------------------------------------------------------------------

-- Dropped, not overloaded: with the new function defaulting its third argument, the old
-- two-argument version would make every existing PostgREST call ambiguous.
drop function if exists public.report_absence(uuid, date);

create function public.report_absence(
  p_child  uuid,
  p_date   date,
  p_reason text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_outcome text := public.report_absence_core(p_child, p_date, p_reason);
begin
  if v_outcome = 'recorded' then
    perform public.notify_absence(p_child, array[p_date], nullif(trim(coalesce(p_reason, '')), ''));
  end if;
  return v_outcome;
end;
$$;

comment on function public.report_absence(uuid, date, text) is
  'Mark a booked day absent, as the child''s guardian, and tell the office once. Statuses '
  'as 0051, plus reason_too_long. Cannot change what a family owes: absent still charges, '
  'and cancelled stays office-only.';

revoke all on function public.report_absence(uuid, date, text) from public;
grant execute on function public.report_absence(uuid, date, text) to authenticated, service_role;

/**
 * A run of days in one submission, each answered on its own merits.
 *
 * Returns jsonb of date → status, e.g. {"2026-08-17":"recorded","2026-08-19":"no_booking"}.
 * The office is told once, listing only the dates that recorded. All-or-nothing was
 * rejected in the header; 31 days is the same cap the kiosk window uses, and for the same
 * reason — beyond a month this is a different conversation, had with a person.
 */
create function public.report_absence_range(
  p_child  uuid,
  p_from   date,
  p_to     date,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_day      date;
  v_outcome  text;
  v_results  jsonb := '{}'::jsonb;
  v_recorded date[] := '{}';
  v_reason   text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if p_from > p_to or p_to - p_from > 31 then
    return jsonb_build_object('status', 'bad_period');
  end if;

  v_day := p_from;
  while v_day <= p_to loop
    v_outcome := public.report_absence_core(p_child, v_day, p_reason);
    v_results := v_results || jsonb_build_object(v_day::text, v_outcome);
    if v_outcome = 'recorded' then
      v_recorded := v_recorded || v_day;
    end if;
    v_day := v_day + 1;
  end loop;

  if array_length(v_recorded, 1) > 0 then
    perform public.notify_absence(p_child, v_recorded, v_reason);
  end if;

  return jsonb_build_object('status', 'ok', 'days', v_results);
end;
$$;

comment on function public.report_absence_range(uuid, date, date, text) is
  'report_absence over a run of days: per-day statuses, one office notification listing '
  'the days that recorded. Never all-or-nothing — a no-booking Wednesday must not stop '
  'Thursday from being recorded.';

revoke all on function public.report_absence_range(uuid, date, date, text) from public;
grant execute on function public.report_absence_range(uuid, date, date, text) to authenticated, service_role;
