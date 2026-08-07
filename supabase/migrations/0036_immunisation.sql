-- ---------------------------------------------------------------------------
-- 0036 — immunisation status, and the schedule this product refuses to hold
--
-- An enrolment record is expected to carry a child's immunisation status. Nothing in
-- this schema has ever recorded one, so the only place it lived was a photocopy in a
-- folder.
--
-- WHAT THIS DELIBERATELY DOES NOT MODEL: THE SCHEDULE
--
-- No vaccine list, no ages, no "due" arithmetic, no next-dose calculation. The
-- National Immunisation Schedule is a published clinical document that this repo has
-- not read, it changes, and encoding a remembered version of it would produce a
-- screen telling a centre that a child is overdue for something — against a table
-- nobody here checked, about a matter where being wrong is a conversation with a
-- family about their child's health.
--
-- This is the `criteria` argument applied to medicine rather than to regulation, and
-- it is stricter here for the obvious reason. So the table records **what the centre
-- was shown and when**, and computes nothing.
--
-- `next_due_on` exists and is a date somebody TYPED off the document in front of
-- them. It is not derived and nothing derives from it beyond showing it back.
--
-- WHY `declined` AND `not_provided` ARE DIFFERENT STATUSES
--
-- A family who decline to immunise and a family who simply have not brought the
-- certificate in are in different situations, and collapsing them would make the
-- register say something about a family's decision that they never said. Neither
-- status carries any consequence in this product: nothing is blocked, nothing is
-- flagged as non-compliant, because what follows from either is a regulatory
-- question this repo has not answered.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.immunisation_status as enum (
    'up_to_date',
    'not_up_to_date',
    'declined',
    'not_provided'
  );
exception when duplicate_object then null; end $$;

comment on type public.immunisation_status is
  'What the centre was shown. `declined` is a family decision; `not_provided` is an absence of information. Neither carries a consequence in this product.';

create table if not exists public.immunisation_records (
  id            uuid primary key default gen_random_uuid(),
  -- `on delete cascade`, and asserted: a child-linked table that does not cascade
  -- either survives `purge_child` as an orphan or blocks it outright.
  child_id      uuid not null references public.children(id) on delete cascade,

  status        public.immunisation_status not null,

  /**
   * Sighting, as its own pair of columns, exactly as on `staff_records`.
   *
   * "The family told us she is up to date" and "somebody looked at the certificate"
   * are different claims and only the second survives a review. A status with no
   * sighting is a report; a status with one is a record.
   */
  sighted_by    uuid references auth.users(id) on delete set null,
  sighted_at    timestamptz,
  /** Which document was seen — a Well Child book, an AIR printout, a GP letter. */
  reference     text,

  /**
   * Typed off the document, never computed. See the header: this product holds no
   * schedule and does no due-date arithmetic.
   */
  next_due_on   date,

  note          text,
  recorded_at   timestamptz not null default now(),
  recorded_by   uuid references auth.users(id) on delete set null,

  /**
   * Superseded rather than edited, following `custody_arrangements`.
   *
   * A child's status changes — they get their four-year-old immunisations — and
   * "were they up to date when they enrolled" is a different question from "are they
   * now". An update in place answers only the second and destroys the first.
   */
  superseded_at timestamptz,

  constraint immunisation_sighting_complete check ((sighted_by is null) = (sighted_at is null))
);

comment on table public.immunisation_records is
  'What the centre was shown about a child''s immunisation, and when. Superseded rather than edited. No schedule is stored and no due date is computed — next_due_on is typed off the document.';

-- Partial: the current record per child is what every screen wants.
create index if not exists immunisation_child_current_idx
  on public.immunisation_records (child_id) where superseded_at is null;
create index if not exists immunisation_child_idx
  on public.immunisation_records (child_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Read: staff and the child's own guardians. A family is entitled to see what the
-- centre has recorded about their child's health — the same call as
-- `medication_administrations`, and the opposite of an incident draft, because there
-- is no half-written state here to withhold.
--
-- Write: staff only. A guardian supplies the certificate; the centre records what it
-- saw. Letting a parent write this would make `sighted_by` meaningless.
-- ---------------------------------------------------------------------------

alter table public.immunisation_records enable row level security;

drop policy if exists immunisation_select on public.immunisation_records;
create policy immunisation_select on public.immunisation_records
  for select using (public.caller_may_see_child(child_id));

drop policy if exists immunisation_write_insert on public.immunisation_records;
create policy immunisation_write_insert on public.immunisation_records
  for insert with check (
    public.caller_is_staff_for_child(child_id)
    and (recorded_by is null or recorded_by = auth.uid())
    -- Attribution again: a sighting cannot be recorded against somebody else.
    and (sighted_by is null or sighted_by = auth.uid())
  );

drop policy if exists immunisation_write_update on public.immunisation_records;
create policy immunisation_write_update on public.immunisation_records
  for update using (public.caller_is_staff_for_child(child_id))
          with check (public.caller_is_staff_for_child(child_id));

-- No DELETE policy and no DELETE grant. A record is superseded, not removed; the
-- purge cascade still reaches it, because a referential action runs as the table
-- owner and does not consult grants.

revoke all on public.immunisation_records from anon, authenticated, service_role;
grant select, insert, update on public.immunisation_records to authenticated, service_role;

drop trigger if exists immunisation_records_audit on public.immunisation_records;
create trigger immunisation_records_audit
  after insert or update or delete on public.immunisation_records
  for each row execute function public.audit_trigger();
