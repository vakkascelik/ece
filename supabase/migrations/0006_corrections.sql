-- 0006 — corrections to 0004
--
-- Three fixes found reviewing Phase 1 before starting Phase 2.

-- ---------------------------------------------------------------------------
-- 1. The date-of-birth check was in the wrong timezone
-- ---------------------------------------------------------------------------
--
-- `date_of_birth <= current_date` looks obviously right and is wrong here.
-- `current_date` uses the session timezone, and PostgREST connects as UTC. New
-- Zealand is 12 or 13 hours ahead, so for the whole New Zealand morning
-- `current_date` is *yesterday* — and a baby born that morning failed the
-- constraint. The enrolment form rejected them as being born in the future, every
-- morning, which is precisely when a centre does its admin.
--
-- Postgres permits a non-immutable expression here (it is not re-validated on
-- existing rows, which is fine for a typo guard), so the fix is to ask for the
-- date at the centre rather than the date at the server.
--
-- Hard-coding Pacific/Auckland rather than reading `centres.timezone`: a CHECK
-- constraint cannot reference another table. Every service licensed in New Zealand
-- is in this zone, including the Chathams for the purposes of a birth date. The
-- application uses `centres.timezone` where it matters.

alter table public.children drop constraint if exists children_dob_plausible;
alter table public.children add constraint children_dob_plausible check (
  date_of_birth <= (now() at time zone 'Pacific/Auckland')::date
  and date_of_birth > (now() at time zone 'Pacific/Auckland')::date - interval '20 years'
);

-- ---------------------------------------------------------------------------
-- 2. `current_consents` could not be filtered by centre
-- ---------------------------------------------------------------------------
--
-- Reading a whole centre's consent state meant first fetching every child id and
-- then passing them back as an `in.(…)` list. Two round trips, a URL that grows
-- with the roll, and a hidden dependency on PostgREST's default 1000-row cap on
-- the id query.
--
-- A view cannot be embedded through a foreign key, so the centre has to be a
-- column on it. Joining `children` here also keeps the guardianship rule intact:
-- with `security_invoker = on` the caller's own policy on `children` applies to
-- the join, so a parent still sees only their own child's consents.

-- Dropped and recreated rather than `create or replace`, which refuses to change
-- the column list: adding centre_id in the middle reads as renaming `kind`, and
-- Postgres says so ("cannot change name of view column").
drop view if exists public.current_consents;

create view public.current_consents
with (security_invoker = on) as
  select distinct on (ce.child_id, ce.kind)
    ce.child_id,
    c.centre_id,
    ce.kind,
    ce.granted,
    ce.given_by,
    ce.at
  from public.consent_events ce
  join public.children c on c.id = ce.child_id
  order by ce.child_id, ce.kind, ce.at desc, ce.id desc;

comment on view public.current_consents is
  'Latest consent decision per child and kind. centre_id is carried so a whole roll can be read in one query; security_invoker=on so both consent_events and children policies apply to the caller.';

grant select on public.current_consents to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. A medication authority should not be deletable
-- ---------------------------------------------------------------------------
--
-- 0004 granted DELETE on `medication_authorities`, which was inconsistent with its
-- own reasoning. An authority is a permission record, exactly like a consent:
-- administering medicine without one is a licensing breach, so the evidence that
-- one existed must outlive somebody's tidying up. Withdrawal is `expires_on`,
-- which is already how a lapsed authority is modelled.
--
-- Health conditions keep DELETE. They are descriptive rather than permissive, and
-- a duplicate "Peanuts" typed twice is noise that should be removable — the real
-- case of a condition ending is `resolved_at`.

revoke delete on public.medication_authorities from authenticated, service_role;
