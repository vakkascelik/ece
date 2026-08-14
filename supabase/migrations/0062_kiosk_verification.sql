-- ---------------------------------------------------------------------------
-- 0062 — §6-3 verification at the door: the PIN becomes a signature
--
-- 0061 built the record and the portal path: a signatory with their own login approves or
-- disputes a week, and the RLS policy identifies them from `auth.uid()`. Most of the
-- families this product exists for will never hold that login. They already stand at the
-- kiosk twice a day, and 0044 already gave each of them an authentication factor.
--
-- This migration lets that factor sign. A kiosk session holds no personal JWT — `auth.uid()`
-- is the tablet, not the parent — so the 0061 policy can refuse it forever, correctly. The
-- only sound path is the 0042/0044 arrangement: SECURITY DEFINER functions that enforce, in
-- their own bodies, everything the policy enforces for the portal, with the PIN standing
-- where `auth.uid()` stood. That is not a workaround; it is §6-3 criterion 1 stated as
-- code — "the means of creating each individual electronic signature is linked only to its
-- authorised signatory".
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE SHAPE: SHOW, THEN SIGN — TWO FUNCTIONS, NOT ONE
--
-- Criterion 6 requires the signature "indicate the signatory's approval of the information
-- to which the signature relates". A kiosk that records approval without ever DISPLAYING
-- the week is a rubber stamp with a good audit trail, so the flow is forced to be:
--
--   1. `kiosk_week_attendance`  — PIN-gated. Returns the week's sign-in/out times.
--   2. `kiosk_verify_attendance` — PIN-gated. Records the outcome over what was shown.
--
-- The week view is NOT offered without the PIN, though the guardian names on the sign-in
-- screen are. A week of times is a pattern — who brings the child, who collects, which
-- days they are alone — and `custody_arrangements` is the reason that pattern is not
-- readable by whoever is standing at an unattended tablet. The sign-in screen shows one
-- name at one moment; this shows a week, and the week is gated.
--
-- WHAT THAT COSTS, STATED PLAINLY: the client holds the plaintext PIN in component state
-- between the two calls — entered once, used twice, never persisted. 0044's property that
-- the *hash* never leaves Postgres is intact; the plaintext already transits on every
-- sign-in tap. The alternatives were worse: demanding the PIN twice per verification would
-- make disputes rarer than they should be (the second entry is the one people abandon),
-- and one combined show-and-sign call is the rubber stamp criterion 6 forbids.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONE COUNTER, SHARED, AND A HELPER NOBODY MAY CALL
--
-- Both functions consume the same `guardian_pins` lockout state as `kiosk_sign_child` —
-- a wrong PIN at the review screen is the same brute-force attempt as a wrong PIN at the
-- sign-in screen, and a second counter would double the attacker's budget.
--
-- The check-and-count logic lives once, in `kiosk_pin_gate`, with EXECUTE revoked from
-- every role and granted to none. Only the owner can call it, which in practice means:
-- only from inside another SECURITY DEFINER body. That is deliberate — as a callable
-- function it would be a PIN oracle for any authenticated user, unscoped by
-- `caller_kiosk_centre_id()`, which is the check its callers make first.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO IDEMPOTENCY KEY, UNLIKE EVERY OTHER KIOSK WRITE, AND WHY THAT IS FINE
--
-- `kiosk_sign_child` carries `client_uuid` because a duplicated attendance event is a
-- wrong roll and a wrong claim. A duplicated verification is two rows saying the same
-- thing seconds apart, and `summariseVerification` takes the newest — the outcome is
-- identical. The failure a retry can produce here is benign, so the machinery to prevent
-- it would be dead weight with a security surface.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- kiosk_guardians grows a column: which of these people may sign
--
-- The screen needs to know where to draw the "Review last week" control, and offering it
-- to a non-signatory — to fail only at the end, after the PIN — is a dead end a queue
-- forms behind. DROP first: adding a column changes the return type, which CREATE OR
-- REPLACE refuses.
-- ---------------------------------------------------------------------------

drop function if exists public.kiosk_guardians(uuid);

create function public.kiosk_guardians(p_child uuid)
returns table (guardian_id uuid, full_name text, can_collect boolean, has_pin boolean, is_signatory boolean)
language sql
stable
security definer
set search_path = public
as $$
  select g.id,
         g.full_name,
         cg.can_collect,
         exists (select 1 from public.guardian_pins p where p.guardian_id = g.id),
         cg.is_authorised_signatory
    from public.child_guardians cg
    join public.guardians g on g.id = cg.guardian_id
    join public.children c on c.id = cg.child_id
   where cg.child_id = p_child
     and cg.revoked_at is null
     and c.centre_id = public.caller_kiosk_centre_id()
   order by cg.contact_priority nulls last, g.full_name
$$;

comment on function public.kiosk_guardians(uuid) is
  'Guardians a door tablet may list for one child: name, whether they may collect, whether '
  'they have set a PIN, whether they are an authorised signatory (0061). No contact details, '
  'no address, no relationship notes.';

revoke execute on function public.kiosk_guardians(uuid) from public;
grant  execute on function public.kiosk_guardians(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The gate: one PIN check, one counter, callable by nobody
-- ---------------------------------------------------------------------------

create or replace function public.kiosk_pin_gate(p_guardian uuid, p_pin text)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_pin public.guardian_pins%rowtype;
begin
  select * into v_pin from public.guardian_pins where guardian_id = p_guardian;
  if not found then
    return 'no_pin';
  end if;

  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return 'locked';
  end if;

  if extensions.crypt(p_pin, v_pin.pin_hash) <> v_pin.pin_hash then
    -- Five attempts, then fifteen minutes — 0044's judgement, shared rather than copied,
    -- so the two doors cannot drift apart and hand an attacker a second budget.
    update public.guardian_pins
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '15 minutes' else null end
     where guardian_id = p_guardian;
    return 'wrong_pin';
  end if;

  update public.guardian_pins
     set failed_attempts = 0, locked_until = null
   where guardian_id = p_guardian;
  return 'ok';
end;
$$;

comment on function public.kiosk_pin_gate(uuid, text) is
  'The 0044 PIN check and lockout counter, shared by every kiosk verb. EXECUTE is granted '
  'to no role at all: callable only from inside another definer body, because as a public '
  'function it would be a PIN oracle unscoped by caller_kiosk_centre_id().';

revoke all on function public.kiosk_pin_gate(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Step one: show the week
-- ---------------------------------------------------------------------------

/**
 * The week's attendance for one child, to the signatory about to sign for it.
 *
 * jsonb rather than a table, because the answer is a status OR rows and a status column
 * repeated per row is a shape callers get wrong. `timezone` rides along so the client can
 * render the times in the centre's day — the times are stored as instants, and a tablet's
 * own locale is nobody's source of truth.
 *
 * Refusals mirror `kiosk_verify_attendance` exactly: a week this function will show is a
 * week that function will sign, so a mismatch between their checks would show a family a
 * week and then refuse their signature over it.
 */
create or replace function public.kiosk_week_attendance(
  p_child    uuid,
  p_guardian uuid,
  p_from     date,
  p_to       date,
  p_pin      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_centre uuid := public.caller_kiosk_centre_id();
  v_tz     text;
  v_today  date;
  v_gate   text;
  v_events jsonb;
begin
  if v_centre is null then
    return jsonb_build_object('status', 'not_permitted');
  end if;

  /*
    The signatory conditions, identical to 0061's policy with the PIN standing in for
    auth.uid(): live guardianship, named signatory, unarchived guardian, child at this
    kiosk's centre. `caller_signatory_ward_ids()` answers for the PERSON logged in and a
    kiosk is not a person, so the conditions are restated here — and asserted in the
    suite against the same counter-example, Quinn.
  */
  if not exists (
    select 1
      from public.child_guardians cg
      join public.guardians g on g.id = cg.guardian_id
      join public.children  c on c.id = cg.child_id
     where cg.child_id = p_child
       and cg.guardian_id = p_guardian
       and cg.revoked_at is null
       and cg.is_authorised_signatory
       and g.archived_at is null
       and c.centre_id = v_centre
       and c.archived_at is null
  ) then
    return jsonb_build_object('status', 'not_permitted');
  end if;

  if p_from > p_to or p_to - p_from > 31 then
    -- A malformed or over-long range. 31 days covers the monthly cadence sessional
    -- services need with headroom; a year would make this a history-trawling tool.
    return jsonb_build_object('status', 'bad_period');
  end if;

  select c.timezone, (now() at time zone c.timezone)::date
    into v_tz, v_today
    from public.children ch join public.centres c on c.id = ch.centre_id
   where ch.id = p_child;

  if p_to >= v_today then
    -- A week still running cannot be signed, so it is not shown for signing either —
    -- `summariseVerification` calls this `not-yet-due` and the door agrees with it.
    return jsonb_build_object('status', 'not_ended');
  end if;

  v_gate := public.kiosk_pin_gate(p_guardian, p_pin);
  if v_gate <> 'ok' then
    return jsonb_build_object('status', v_gate);
  end if;

  /*
    The window is [p_from, p_to] in the CENTRE's day, not the UTC day — the whole reason
    `v_tz` exists. An 07:55 Monday sign-in is Sunday 19:55 UTC, and a UTC window would
    file it into the wrong week for every morning event in New Zealand.

    Corrections ride along unresolved: this is the record as held, and if a correction
    changed the week the family should see both rows, not a tidied version the office
    composed. What they are signing is what the Ministry would read.
  */
  select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind) order by e.at), '[]'::jsonb)
    into v_events
    from public.attendance_events e
   where e.child_id = p_child
     and (e.at at time zone v_tz)::date between p_from and p_to;

  return jsonb_build_object('status', 'ok', 'timezone', v_tz, 'events', v_events);
end;
$$;

comment on function public.kiosk_week_attendance(uuid, uuid, date, date, text) is
  'A completed week''s attendance, shown to a named signatory who has just entered their '
  'PIN, so that what is approved was first displayed — §6-3 criterion 6. Empty weeks '
  'return ok with no events: a week the child stayed home is still a week to confirm.';

revoke execute on function public.kiosk_week_attendance(uuid, uuid, date, date, text) from public;
grant  execute on function public.kiosk_week_attendance(uuid, uuid, date, date, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Step two: sign it
-- ---------------------------------------------------------------------------

/**
 * Record the signatory's outcome over the week they were just shown.
 *
 * Returns a status, never raises for a refused attempt — 0044's rule, same reason: an
 * exception rolls back the counter `kiosk_pin_gate` just moved.
 *
 * `p_outcome` is the enum, not text, exactly as `kiosk_sign_child` types `p_kind`: a
 * misspelled outcome is a programming error and fails at the boundary, not a state this
 * function needs a status for.
 */
create or replace function public.kiosk_verify_attendance(
  p_child    uuid,
  p_guardian uuid,
  p_from     date,
  p_to       date,
  p_outcome  public.verification_outcome,
  p_comment  text,
  p_pin      text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_centre uuid := public.caller_kiosk_centre_id();
  v_today  date;
  v_gate   text;
begin
  if v_centre is null then
    return 'not_permitted';
  end if;

  if not exists (
    select 1
      from public.child_guardians cg
      join public.guardians g on g.id = cg.guardian_id
      join public.children  c on c.id = cg.child_id
     where cg.child_id = p_child
       and cg.guardian_id = p_guardian
       and cg.revoked_at is null
       and cg.is_authorised_signatory
       and g.archived_at is null
       and c.centre_id = v_centre
       and c.archived_at is null
  ) then
    return 'not_permitted';
  end if;

  if p_from > p_to or p_to - p_from > 31 then
    return 'bad_period';
  end if;

  select (now() at time zone c.timezone)::date
    into v_today
    from public.children ch join public.centres c on c.id = ch.centre_id
   where ch.id = p_child;

  if p_to >= v_today then
    return 'not_ended';
  end if;

  if p_outcome = 'disputed' and length(trim(coalesce(p_comment, ''))) = 0 then
    /*
      Checked here although av_dispute_explained would refuse it anyway, because the
      constraint refuses by RAISING — which would roll back the counter reset the gate
      below has just committed to this transaction, and a family disputing a week would
      burn a failed attempt for it. The constraint stays as the backstop; this is the
      front door saying the same thing politely.
    */
    return 'comment_required';
  end if;

  v_gate := public.kiosk_pin_gate(p_guardian, p_pin);
  if v_gate <> 'ok' then
    return v_gate;
  end if;

  insert into public.attendance_verifications
    (child_id, guardian_id, period_start, period_end, outcome, method, comment)
  values
    (p_child, p_guardian, p_from, p_to, p_outcome, 'kiosk',
     nullif(trim(coalesce(p_comment, '')), ''));

  return 'recorded';
end;
$$;

comment on function public.kiosk_verify_attendance(uuid, uuid, date, date, public.verification_outcome, text, text) is
  'The kiosk half of §6-3: a named signatory approves or disputes a completed week with '
  'the PIN 0044 gave them. Enforces in its body everything the 0061 policy enforces for '
  'the portal, because a kiosk session''s auth.uid() is the tablet, not the parent.';

revoke execute on function public.kiosk_verify_attendance(uuid, uuid, date, date, public.verification_outcome, text, text) from public;
grant  execute on function public.kiosk_verify_attendance(uuid, uuid, date, date, public.verification_outcome, text, text) to authenticated, service_role;
