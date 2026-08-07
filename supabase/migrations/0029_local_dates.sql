-- ---------------------------------------------------------------------------
-- 0029 — the fourth and fifth times this repo computed "today" as UTC
--
-- PostgREST connects as UTC and New Zealand is 12 or 13 hours ahead, so for the
-- whole New Zealand morning UTC is *yesterday*. 0006 is the record of the first
-- two: a CHECK constraint that rejected a baby born that morning as born in the
-- future, and a same-day enrolment missing from the roll until lunchtime.
--
-- 0006 fixed `children.date_of_birth` and did not sweep. Four column defaults and
-- one function body kept `current_date`, which is the same expression, evaluated in
-- the same UTC session, producing the same wrong day. Found on 2026-08-07 while
-- fixing the TypeScript twin of this bug in `recordPayment` — which had defaulted
-- `paid_on` to `new Date().toISOString().slice(0, 10)` for four phases.
--
-- WHY THESE ARE NOT BEING DROPPED INSTEAD
--
-- The strongest fix is no default at all: the column is NOT NULL, so a caller that
-- forgets fails loudly instead of silently recording yesterday, and every caller in
-- `packages/api` already passes the date explicitly (`startsOn` is a required field;
-- `recordPayment` now uses `todayInZone`; nothing writes `fee_schedules` at all).
--
-- Rejected because `rls_isolation.sql` itself inserts into `fee_schedules` and
-- `payments` without these columns, and so would every ad-hoc statement in the SQL
-- editor. Trading a wrong default for a foot-gun in the one tool used during an
-- incident is a bad trade.
--
-- WHY A HARD-CODED ZONE, IN A SCHEMA THAT HAS `centres.timezone`
--
-- Because a column default cannot see other columns of its own row, let alone join
-- to another table — so the per-centre-correct value is not expressible as a default
-- at any price. `Pacific/Auckland` is correct for every tenant while this is a
-- product for New Zealand early learning services, and AGENTS §4.3 names this exact
-- expression as the SQL form of the rule.
--
-- The default is a floor, not the answer. A caller holding a centre should still
-- pass `todayInZone(centre.timezone)`, and all of them do.
-- ---------------------------------------------------------------------------

-- An authority to administer a prescription medicine became valid a day early. Of
-- the three this is the one that mattered: the others misdate a record, this one
-- widens the window in which giving a child medicine is authorised.
alter table public.medication_authorities
  alter column starts_on set default (now() at time zone 'Pacific/Auckland')::date;

-- A fee schedule took effect a day early, which changes what an invoice charges.
alter table public.fee_schedules
  alter column active_from set default (now() at time zone 'Pacific/Auckland')::date;

-- A payment reconciled before ~1pm Auckland was dated the previous day — and on the
-- 1st, into the previous month, disagreeing with the bank statement it was keyed
-- from. `recordPayment` supplies this explicitly as of 2026-08-07; the default is
-- what a hand-written INSERT during a reconciliation would have used.
alter table public.payments
  alter column paid_on set default (now() at time zone 'Pacific/Auckland')::date;

-- ---------------------------------------------------------------------------
-- purge_child: `was_under_two` in the audit record
--
-- The only function body in the schema using `current_date`. It does not gate the
-- purge — it annotates the audit row that survives it — but an annotation that is
-- wrong for a child born within a day of the boundary is still wrong, and it is the
-- record that outlives the data it describes.
--
-- Uses the centre's own timezone rather than the hard-coded zone above, because here
-- it is expressible: the function already reads the child, so the centre is one join
-- away. `children.centre_id` is NOT NULL and references `centres`, so the join cannot
-- drop the row and the "no such child" branch below still means what it says.
--
-- Replaced whole rather than patched, because CREATE OR REPLACE FUNCTION is the only
-- way to change a body and a partial edit would leave two definitions to reconcile.
-- ---------------------------------------------------------------------------

create or replace function public.purge_child(p_child uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centre    uuid;
  v_archived  timestamptz;
  v_under_two boolean;
begin
  if p_reason is null or length(trim(p_reason)) < 10 then
    raise exception 'A reason of at least 10 characters is required to purge a child record.';
  end if;

  select c.centre_id, c.archived_at,
         (c.date_of_birth > ((now() at time zone ce.timezone)::date - interval '2 years'))
    into v_centre, v_archived, v_under_two
    from public.children c
    join public.centres ce on ce.id = c.centre_id
   where c.id = p_child;

  if v_centre is null then
    raise exception 'No such child, or it has already been purged.';
  end if;

  -- security definer bypasses RLS, so authorisation is checked explicitly. Without
  -- this the function would let any authenticated caller purge any child anywhere.
  if not public.caller_has_role(v_centre, array['owner']::public.member_role[]) then
    raise exception 'Only an owner of this centre may purge a child record.';
  end if;

  if v_archived is null then
    raise exception 'This child is still enrolled. Archive the record first — purging a current child is not a retention action.';
  end if;

  -- Written before the delete, so a failure part-way leaves the intention recorded.
  insert into public.audit_events (centre_id, actor_id, action, entity, entity_id, detail)
  values (
    v_centre,
    auth.uid(),
    'purge',
    'children',
    p_child::text,
    jsonb_build_object(
      'reason', left(p_reason, 500),
      'archived_at', v_archived,
      'was_under_two', v_under_two
    )
  );

  delete from public.children where id = p_child;
end $$;

comment on function public.purge_child(uuid, text) is
  'Irreversibly destroys one archived child record and everything hanging off it. Owner only, reason required and audited.';

-- The grants 0008 set are attached to the function, not its body, and CREATE OR
-- REPLACE preserves them. Restated anyway: a REPLACE that ever became a DROP and
-- CREATE would silently return this to the default of EXECUTE for PUBLIC.
revoke execute on function public.purge_child(uuid, text) from public, anon;
grant  execute on function public.purge_child(uuid, text) to authenticated, service_role;
