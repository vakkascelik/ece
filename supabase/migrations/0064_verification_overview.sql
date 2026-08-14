-- ---------------------------------------------------------------------------
-- 0064 — one read for both audiences of a verification
--
-- 0061 holds the signatures and @ece/core derives the states, and until now no screen
-- could ask the obvious question: for these children, over these weeks, what happened?
-- The office needs it to run the chase (superseded, overdue, in-review — the three states
-- that always need somebody), and a guardian needs it to see the weeks awaiting their
-- signature WITH the times they would be signing over — §6-3 criterion 6 applies to the
-- portal exactly as it applied to the kiosk.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY INVOKER, WHICH IS THE WHOLE DESIGN
--
-- The kiosk functions are definers because a kiosk session has no personal identity and
-- every condition must be restated. This is the opposite situation: every caller is a
-- person, and the tables' own policies already answer who sees which child —
-- `caller_may_see_child` on the events and on the verifications, the membership predicate
-- on children. So the function runs AS the caller and restates nothing:
--
--   an educator gets every child at their centre;
--   a guardian gets exactly their wards, through the same rows, with no branch saying so;
--   another centre gets nothing.
--
-- A definer version would have had to re-derive all three answers, and 0062's header is
-- one long warning about what restated conditions cost. The suite still asserts the three
-- scopings directly, because "the policies carry it" is a claim, and the arrears view
-- taught this repo what happens to boundary claims nothing is checking.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A FUNCTION AND NOT A VIEW
--
-- A view cannot take the week grid as input. The weeks are generated from arguments the
-- caller resolves in the CENTRE's calendar — `lastCompletedWeek()` walked backwards — and a
-- view would have to hard-code how many weeks matter, which is a UI decision. The class
-- assertion on `security_invoker` views does not reach functions, so the suite carries
-- explicit scoping assertions instead (above).
--
-- Row budget, stated because reading-every-row is a wiki page: weeks × children. Four
-- weeks of a 100-place centre is 400 rows, well under PostgREST's 1,000 cap; a caller
-- asking for a year of a big centre would truncate silently, so the API wrapper caps the
-- window it will request rather than trusting every future caller to know this.
-- ---------------------------------------------------------------------------

create or replace function public.verification_overview(
  p_centre uuid,
  p_from   date,   -- a Monday, resolved by the caller in the centre's calendar
  p_to     date    -- a later Monday; the last week generated starts here
)
returns table (
  child_id        uuid,
  period_start    date,
  period_end      date,
  /*
    max(attendance_events.created_at) inside the week — server receipt, not device time,
    because staleness is about what the record did AFTER the signature (see 0061 and the
    offline-outbox page: `at` and `created_at` legitimately differ by days).
  */
  last_changed_at timestamptz,
  verifications   jsonb,
  /*
    The week's times, for the portal to display before asking for a signature. The keys
    match @ece/core's VerificationEvent/KioskWeekEvent shapes, so no caller invents a
    third naming.
  */
  events          jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  with weeks as (
    -- generate_series over dates yields timestamptz; cast before the day arithmetic,
    -- because timestamptz + integer is not an operator and date + integer is.
    select w::date as period_start, w::date + 6 as period_end
      from generate_series(p_from, p_to, interval '7 days') w
     -- A caller passing a non-Monday gets an empty grid rather than a shifted one: every
     -- week this product talks about is an ISO week (funding.ts caps per ISO week), and a
     -- Tuesday-to-Monday "week" silently misfiling events is worse than no rows.
     where extract(isodow from p_from) = 1
  ),
  kids as (
    -- RLS on children scopes this per caller: all of a centre for staff, wards for a
    -- guardian, nothing across centres.
    select c.id, c.centre_id, cen.timezone
      from public.children c
      join public.centres cen on cen.id = c.centre_id
     where c.centre_id = p_centre
       and c.archived_at is null
  )
  select k.id,
         wk.period_start,
         wk.period_end,
         (select max(e.created_at)
            from public.attendance_events e
           where e.child_id = k.id
             and (e.at at time zone k.timezone)::date between wk.period_start and wk.period_end),
         coalesce((select jsonb_agg(jsonb_build_object(
                     'outcome',    v.outcome,
                     'method',     v.method,
                     'verifiedAt', v.verified_at,
                     'guardianId', v.guardian_id,
                     'comment',    v.comment
                   ) order by v.verified_at)
            from public.attendance_verifications v
           where v.child_id = k.id
             and v.period_start = wk.period_start), '[]'::jsonb),
         coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'kind', e.kind) order by e.at)
            from public.attendance_events e
           where e.child_id = k.id
             and (e.at at time zone k.timezone)::date between wk.period_start and wk.period_end),
           '[]'::jsonb)
    from kids k
   cross join weeks wk
$$;

comment on function public.verification_overview(uuid, date, date) is
  'Per child per ISO week: the signatures, the record''s last server-side change, and the '
  'times. SECURITY INVOKER on purpose — the tables'' own policies decide who sees which '
  'child, so staff get the centre, a guardian gets their wards, and nobody restates a '
  'boundary. Weeks must start on Mondays; a non-Monday start returns no rows.';

revoke all on function public.verification_overview(uuid, date, date) from public;
grant execute on function public.verification_overview(uuid, date, date) to authenticated, service_role;
