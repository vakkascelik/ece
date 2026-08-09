-- ---------------------------------------------------------------------------
-- 0051 — a parent tells the centre their child is not coming
--
-- The smallest and most asked-for piece of self-service: a guardian marks a booked day
-- as `absent` without ringing at 7am. Everything else about booking stays office work,
-- for the reason 0018 records — a booking has a fee attached and the centre has a licence
-- capacity to respect.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A DEFINER FUNCTION AND NOT AN RLS POLICY
--
-- The plan said "a guardian-scoped policy on `bookings`". That does not work, and the
-- reason is a property of RLS rather than a matter of taste:
--
--     A policy's WITH CHECK sees only the NEW row. It cannot say "and nothing else
--     changed."
--
-- So an UPDATE policy permissive enough to let a guardian set `status = 'absent'` also
-- lets them rewrite `note` — a staff-facing field — and shift `from_time`, `to_time` and
-- `on_date` on the same row. Pinning those would mean restating every column against its
-- old value, which a policy cannot reference. A trigger can see OLD, and so can this.
--
-- Same shape as `kiosk_sign_child` (0044) and `submit_job_application` (0024): one
-- narrow definer entry point, granted to the role that needs it, doing exactly one thing.
-- Unlike `submit_job_application` this is granted to `authenticated`, not `anon`, so it
-- does not touch `review:security` check 8 or its allowlist.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `absent`, NEVER `cancelled` — AND THAT IS THE WHOLE SAFETY ARGUMENT
--
-- From 0018's own comment on the enum: *"absent = booked and did not attend (usually
-- still charged). cancelled = withdrawn in time."* So this function cannot change what a
-- family owes. It is a **notification**, not a financial act, and that is precisely why a
-- guardian may perform it unsupervised. `cancelled` and `closed` stay office-only,
-- because those are the ones that move money.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TODAY IS ALLOWED. THE PLAN SAID FUTURE-ONLY AND THAT WOULD HAVE BEEN USELESS
--
-- A deliberate departure, recorded rather than done quietly. The dominant case is a
-- parent at 7am with a sick child, which is *today*, and a feature that refused today
-- would be a feature nobody uses. What is refused is the **past**, which is the case the
-- future-only instruction was really guarding: retroactively rewriting an attendance
-- record after the day it describes.
--
-- Note that even a retroactive change could not avoid a fee — `absent` still charges —
-- so the guard is about the integrity of the record, not about money.
--
-- "Today" is the centre's today, read from `centres.timezone`. Never `current_date`,
-- which is the session's, which is UTC in production and thirteen hours wrong.
-- ---------------------------------------------------------------------------

/**
 * Mark a booked day as absent, as the child's guardian.
 *
 * Returns a status rather than raising, the same contract as `kiosk_sign_child`: the
 * caller is a parent on a phone, and every outcome here is an ordinary thing that can
 * happen rather than an error anybody can act on.
 *
 *   recorded       — the booking is now `absent`
 *   already_absent — it already was; reported as success would hide a double-tap, and
 *                    reported as failure would alarm somebody who did the right thing
 *   no_booking     — that child is not booked that day, so there is nothing to mark
 *   past           — the day has been and gone
 *   not_bookable   — the booking is cancelled or the centre was closed; office work
 *   not_permitted  — not this caller's child
 */
create or replace function public.report_absence(p_child uuid, p_date date)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today  date;
  v_status public.booking_status;
begin
  -- Guardianship, not visibility. `caller_may_see_child` would also admit every educator
  -- at the centre, and staff have `bookings_write` for this — a second path for them is
  -- an untested duplicate of a tested one.
  if p_child not in (select public.caller_ward_ids()) then
    return 'not_permitted';
  end if;

  -- The centre's today, from the centre's own timezone. `current_date` is the session's,
  -- and the session is UTC in production.
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

  -- `cancelled` was withdrawn and `closed` means the centre was shut. Neither is a day a
  -- parent can mark absent, and both are somebody else's decision.
  if v_status <> 'booked' then
    return 'not_bookable';
  end if;

  -- Only the status. Every other column is left exactly as the office set it, which is
  -- the guarantee a policy could not have made.
  update public.bookings
     set status = 'absent'
   where child_id = p_child and on_date = p_date;

  return 'recorded';
end;
$$;

comment on function public.report_absence(uuid, date) is
  'A guardian marks their own child''s booked day as absent. Status only — never cancelled, which is the status that moves money. Today or later, in the centre''s timezone. Returns an outcome rather than raising.';

revoke all on function public.report_absence(uuid, date) from public;
grant execute on function public.report_absence(uuid, date) to authenticated;

-- No new policy and no new grant on `bookings`. The function is the entire write path for
-- a guardian, and `bookings_write` still refuses them directly — which the suite asserts,
-- because "the function works" and "the table is still closed" are two different claims.
