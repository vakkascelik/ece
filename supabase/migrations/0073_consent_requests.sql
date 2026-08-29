-- ---------------------------------------------------------------------------
-- 0073 — asking the family, and the third state the product could not express
--
-- WHAT WAS ALREADY TRUE, AND IS NOT CHANGED HERE
--
-- A parent has been able to record their own consent since 0004. `recordConsent` lists
-- 'parent' in `CAPABILITIES`; `consent_insert` permits `given_by in (select
-- caller_guardian_ids())` with the comment "a parent may record only their OWN consent — the
-- alternative is one parent granting photo permission on the other's behalf"; the grant is
-- there; and `ConsentPanel` already renders a parent branch that says "these are your
-- decisions to make, and you can change any of them at any time".
--
-- None of that needed changing and none of it is touched. The mechanism was complete.
--
-- WHAT DID NOT EXIST IS ANYTHING THAT ASKS
--
-- `missingConsents()` is rendered on the children list, the child record header and the
-- mobile roll — three staff surfaces — and `showConsentGap={!isParent}` deliberately keeps it
-- from a parent. So a family's only route to an unanswered consent was to open their child's
-- record, find the Documents tab, and notice.
--
-- THE THIRD STATE, WHICH IS THE POINT OF THIS TABLE
--
-- `consentFor()` returns undefined for "never asked", and the comment above it is emphatic:
--
--   "'refused' and 'never asked' look the same to a boolean and are completely different
--    facts. One is a decision to respect, the other is an enrolment that is not finished."
--
-- That distinction is right, and it stops one level too early. **"Never asked" and "asked,
-- and they have not answered yet" are also completely different facts**, and this schema
-- could not tell them apart either. A reviewer asking "have you sought photo consent for
-- this child" got identical silence from a centre that had asked three times and from one
-- that had never opened the page.
--
-- This table is that missing state and nothing else. It is not a second copy of the answer —
-- `consent_events` remains the only place a decision lives.
--
-- WHY PER GUARDIAN AND NOT PER CHILD
--
-- Because `consent_insert` scopes a parent to their own decision. If the ask were recorded
-- per child, "have we asked?" would still be unanswerable for the person who actually has to
-- answer: a child with two guardians would show as asked when only one of them had been.
-- One row per (child, guardian, kind) is the grain the question is asked at.
--
-- APPEND-ONLY, THE SAME TREATMENT AS `consent_events` AND `detail_confirmations`
--
-- UPDATE and DELETE are withheld from everybody including `service_role`. A request that can
-- be edited afterwards answers nothing — "we asked on the 4th" is only worth saying if
-- nobody could have written it on the 20th. 0055's rule, applied to 0055's neighbour.
--
-- No audit trigger, per 0021's reasoning for every append-only table, and named in BOTH
-- exemption lists in this same commit — `supabase/tests/rls_isolation.sql` and
-- `scripts/security-review.ts` — because 0055's header records that `ai_requests` once went
-- into one and not the other, and the second list is the only reason anybody noticed.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It does not chase. There is no scheduler here, exactly as there is none for checklists:
-- nothing materialises a reminder in advance, and "who has been asked and has not answered"
-- is computed from this table and `consent_events` at read time. 0065 built a chase ledger
-- for attendance verification because a statutory deadline made the send decision automatic;
-- a consent decision has no deadline and a family that has not answered is a conversation,
-- not a queue.
-- ---------------------------------------------------------------------------

create table if not exists public.consent_requests (
  id           uuid primary key default gen_random_uuid(),

  child_id     uuid not null references public.children(id)  on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,
  kind         public.consent_kind not null,

  requested_at timestamptz not null default now(),

  /*
    Who asked. Nullable and `on delete set null` like every other actor column here: an
    educator leaving the centre must not take the fact that the family was asked with them.
  */
  requested_by uuid references auth.users(id) on delete set null,

  /*
    Optional context from the office — "we need this before the trip on the 12th". Reaches
    the family in the notification body, so it is written to be read by them.
  */
  note         text,

  /*
    No `centre_id`. The row reaches its tenant through the child, which is the arrangement
    `child_guardians`, `consent_events` and `detail_confirmations` all use, and the reason is
    the same: a denormalised tenant key on a row that already has one unambiguous parent is a
    second thing that can disagree with the first.
  */
  constraint consent_requests_note_meaningful check (note is null or length(trim(note)) > 0)
);

comment on table public.consent_requests is
  'When the centre asked a named guardian for a named consent decision. Append-only. Records the ask, never the answer — the answer is consent_events, which remains the only place a decision lives.';

-- "Has this family been asked, and how long ago" — the query every surface makes.
create index if not exists consent_requests_child_idx
  on public.consent_requests (child_id, kind, requested_at desc);

create index if not exists consent_requests_guardian_idx
  on public.consent_requests (guardian_id, requested_at desc);

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.consent_requests enable row level security;

/*
  Readable by anybody who may see the child — staff, and the child's own guardians.

  The parent reading it is the point rather than a side effect: "the centre asked you on
  the 4th" is a fact about them, and a request they cannot see is a request that has not
  been made. This is the same predicate `consent_events` itself uses.
*/
drop policy if exists consent_requests_select on public.consent_requests;
create policy consent_requests_select on public.consent_requests
  for select using (public.caller_may_see_child(child_id));

/*
  Only staff may write one, and asking is the centre's act rather than the family's.

  A parent inserting a row here would be recording that they were asked, which is not a
  claim they are in a position to make and would corrupt the only thing this table is for.
  In practice `request_consent` below is the sole writer; the policy is what makes that
  true rather than conventional.
*/
drop policy if exists consent_requests_insert on public.consent_requests;
create policy consent_requests_insert on public.consent_requests
  for insert with check (
    public.caller_is_staff_for_child(child_id)
    and (requested_by is null or requested_by = auth.uid())
  );

-- No UPDATE and no DELETE policy, and — more to the point — no grant for either below.

-- ---------------------------------------------------------------------------
-- Privileges
--
-- Postgres checks these before it evaluates a single policy. AGENTS.md §4.4: append-only
-- means no grant, not just no policy, and that includes service_role.
-- ---------------------------------------------------------------------------

revoke all on public.consent_requests from anon, authenticated;

grant select, insert on public.consent_requests to authenticated;
grant select, insert on public.consent_requests to service_role;

-- ---------------------------------------------------------------------------
-- The ask
-- ---------------------------------------------------------------------------

/**
 * Ask a child's guardians for the consent decisions nobody has answered.
 *
 * SECURITY DEFINER for one reason: `notifications` is `grant select` only for
 * `authenticated`, because writing into somebody else's inbox is not a thing a session
 * should be able to do directly. The same shape as `notify_absence` (0063) and
 * `broadcast_emergency` (0057).
 *
 * Which means the staff check below is load-bearing rather than belt-and-braces — it is the
 * only thing between `authenticated` and an arbitrary write to another family's inbox, since
 * the definer context skips the policy that would otherwise decide it.
 *
 * IT WILL NOT ASK FOR A KIND THAT HAS AN ANSWER
 *
 * Any kind with an existing `consent_events` row is dropped, granted or refused. Re-asking
 * for something a family has already granted is noise; re-asking for something they have
 * refused is pressure, and a product should not automate that. A centre that wants to
 * revisit a refusal has a conversation, which is what the refusal was.
 *
 * ONE NOTIFICATION PER GUARDIAN, NOT ONE PER KIND
 *
 * 0063's lesson, and it applies harder here: four required consents times two guardians is
 * eight letters for one enrolment, which is a muted inbox — and a muted inbox takes 0057's
 * emergency channel down with it.
 *
 * QUIET HOURS ARE NOT COMPUTED HERE, AND THIS DIFFERS FROM 0063
 *
 * `send_after` is left at `now()`. 0063 left it there too, but its recipients were the
 * office reading in-app; these are families, for whom quiet hours genuinely matter. The
 * reason is still sound and is stated rather than inherited: push delivery has never run
 * once, so nothing is delivered outside the app today, and when the worker exists it gates
 * every kind on preference and quiet hours in one place. Computing a per-recipient window
 * here would duplicate the rule the worker must own.
 *
 * Returns the number of (guardian, kind) asks recorded — 0 when everything is already
 * answered, which the caller renders rather than treating as a failure.
 */
create or replace function public.request_consent(
  p_child uuid,
  p_kinds public.consent_kind[],
  p_note  text default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_centre     uuid;
  v_child_name text;
  v_note       text := nullif(trim(coalesce(p_note, '')), '');
  v_asked      integer := 0;
  /*
    The guardians this call actually created a row for, carried out of the INSERT itself.

    The first version found them with `requested_at >= now() - interval '1 second'`, which is
    wrong in a way that only shows up under test: `now()` is the TRANSACTION timestamp, so
    inside one transaction every row this child has ever been asked for matches the window.
    In production each call is its own transaction and it would have behaved; the RLS suite
    runs the whole file in one, and a second ask would have re-notified the first ask's rows.

    A returning clause is exact and has no window to be wrong about. Worth the note because
    "find the rows I just wrote by timestamp" is a tempting shape that is almost never right.
  */
  v_guardians  uuid[];
begin
  if p_kinds is null or array_length(p_kinds, 1) is null then
    raise exception 'request_consent: no consent kinds given';
  end if;

  select c.centre_id,
         coalesce(nullif(trim(c.preferred_name), ''), c.first_name) || ' ' || c.last_name
    into v_centre, v_child_name
    from public.children c
   where c.id = p_child;

  if v_centre is null then
    raise exception 'request_consent: no such child';
  end if;

  if not public.caller_is_staff_for_child(p_child) then
    raise exception 'request_consent: not staff for this child';
  end if;

  with unanswered as (
    select k
      from unnest(p_kinds) as k
     where not exists (
       select 1 from public.consent_events ce
        where ce.child_id = p_child
          and ce.kind = k
     )
  ),
  live_guardians as (
    select g.id
      from public.child_guardians cg
      join public.guardians g on g.id = cg.guardian_id
     where cg.child_id = p_child
       and cg.revoked_at is null
       and g.archived_at is null
  ),
  inserted as (
    insert into public.consent_requests (child_id, guardian_id, kind, requested_by, note)
    select p_child, lg.id, u.k, auth.uid(), v_note
      from live_guardians lg
     cross join unanswered u
    returning guardian_id
  )
  select count(*), coalesce(array_agg(distinct guardian_id), '{}')
    into v_asked, v_guardians
    from inserted;

  if v_asked = 0 then
    return 0;
  end if;

  /*
    Only guardians with a login are notified, and a guardian without one still gets a row
    above. That asymmetry is deliberate: the centre has asked them — on paper, at the door —
    and the record of the ask should not depend on whether they ever accepted an invitation.
    The office sees "asked, no account" and picks up the phone.
  */
  insert into public.notifications (centre_id, user_id, kind, title, body, route)
  select v_centre,
         g.user_id,
         'reminder',
         'Some decisions are needed for ' || v_child_name,
         'The centre needs your answer on a few things for ' || v_child_name ||
           ', including whether photographs may be taken. You can answer them, and change '
           'any of them later, from ' || v_child_name || '''s record.' ||
           coalesce(' ' || v_note, ''),
         '/children/' || p_child::text || '/documents'
    from public.guardians g
   where g.id = any(v_guardians)
     and g.user_id is not null;

  return v_asked;
end;
$$;

comment on function public.request_consent(uuid, public.consent_kind[], text) is
  'Records that the centre asked a child''s guardians for the consent decisions nobody has answered, and notifies those with a login — one notification per guardian, never one per kind. Skips any kind that already has an answer: re-asking a granted consent is noise and re-asking a refused one is pressure.';

/*
  EXECUTE granted to `authenticated` and to nobody else, and revoked from PUBLIC first.

  0031 and 0072 are the same omission twice, eleven days apart, both found by
  `review:security` check 6 rather than by review. `create function` grants EXECUTE to PUBLIC
  when you say nothing, and saying nothing is the default a definer function cannot afford.
*/
revoke all on function public.request_consent(uuid, public.consent_kind[], text) from public, anon;
grant execute on function public.request_consent(uuid, public.consent_kind[], text)
  to authenticated, service_role;
