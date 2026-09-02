-- ---------------------------------------------------------------------------
-- 0081 — the staff facts the annual ECE Return asks for, and the weekday contract
--         it derives contact hours from
--
-- The Ministry's mandatory functionality list for an ELI-integrated SMS includes
-- "annual ECE census data (staff details and qualifications)". Measured on 2026-09-02,
-- **eleven of the fifteen fields it wants had no column anywhere in this schema** — no
-- staff gender, ethnicity, role code, paid/unpaid, permanent/temporary,
-- full-time/part-time, qualification, years of experience, hours per year or FTE. The
-- word "qualification" appeared in this repo only in prose comments and one test
-- fixture's job title.
--
-- This migration closes that, and the shape comes from the ELI schema rather than from
-- a guess: `EceReturn` carries a `StaffInformationList`, each `StaffInformation` has the
-- optional per-person fields, and its `StaffRoles` block splits into five role shapes
-- with `EducationalStaffRole` the richest. See llm-wiki/wiki/eli-integration.md.
--
-- WHY A SEPARATE TABLE RATHER THAN COLUMNS ON `staff_members`
--
-- Because `staff_members_select` (0038) is centre-staff-wide — everybody rostered may
-- read the roster, which is right for a roster. **It is not right for a colleague's
-- ethnicity, age band or qualification.** Adding these as columns would hand every
-- educator every colleague's census record, and a policy cannot help: a policy
-- restricts rows and only a GRANT restricts columns, and a column grant applies to
-- `authenticated` as a whole and so cannot tell an educator from a manager.
--
-- So it is its own table with its own policy, and the policy is the one 0011 already
-- reasoned out for `staff_records`: **owner or manager, or the person themselves.**
-- IPP 6 gives a person access to their own information and a design that hid it would
-- put this product in the way of a statutory right. They cannot edit it, which is a
-- different question — the write is owner/manager only, exactly as an educator reading
-- their own vetting result is not an educator editing it.
--
-- WHAT IS NOT STORED HERE, ON PURPOSE
--
--   `IsRegistered` and the Teaching Council number. Both already exist: a
--   `staff_records` row of kind `practising_certificate` carries `reference` (the
--   number) and `expires_on` (which decides currency, with a null expiry treated as
--   NOT current by `countCertificated`). Duplicating them would create two places
--   holding one fact — AGENTS.md rule 4 — and the two would disagree the first time
--   somebody renewed a certificate and updated only one. It also means **the census
--   and the licensing binder cannot contradict each other**, because they read the
--   same row.
--
--   `HoursWorked`. The schema wants hours worked in the return week, 0–100. That is a
--   sum of the weekday contract below, so it is derived. A stored total drifts from the
--   roster it came from, and `0009` already refused a stored `is_present` for the same
--   reason: drift in a figure that reports itself as authoritative is worse than a slow
--   query.
--
--   A date of birth. The schema wants `AgeBand`, one of twelve five-year bands, and
--   that is all it wants. Storing a birth date to derive a band collects more than the
--   purpose requires, which is the wrong side of IPP 1 — and this product already
--   refuses a date of birth on the job-application form on exactly that reasoning.
--   **The band is the minimum that answers the question, so the band is what is held.**
--
-- WHY THE CODE COLUMNS ARE TEXT AND NOT FOREIGN KEYS TO `codes`
--
-- 0080 gives every Ministry list an effective-dated home, and the obvious move is a
-- foreign key from each column here to `codes(id)`. Rejected, and the reason matters:
-- **0080 ships empty**, so an FK would refuse to store a qualification a centre knows
-- until somebody imports a Ministry list this repo has not yet obtained. Refusing to
-- record true information because a lookup table is missing is the wrong failure — the
-- centre loses the data and the gap becomes invisible.
--
-- Instead the columns hold the code as text bounded at the schema's 10 characters, and
-- **resolution against `codes` happens in the census readiness report**, which has to
-- enumerate gaps anyway. An unresolvable code becomes a named gap on a report rather
-- than a rejected write — which is the same treatment `funding.ts` gives a broken day:
-- exclude it, name it, never guess, and never silently accept it either.
--
-- The arrays settle it beyond argument: `EthnicGroupCodes` and `IwiCodes` take up to
-- three values each, and Postgres cannot put a foreign key on an array element. The
-- alternatives were two join tables for a first increment, or consistency with
-- `children.ethnicities` — which is `text[]` capped at three for the same reason and
-- which one day gets migrated to codes alongside this.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_census_details (
  /**
   * One row per person, so the primary key IS the person.
   *
   * No surrogate id and no `centre_id`: the tenant is resolved through
   * `staff_member_id`, which is what `shifts` and `staff_leave` do and what 0059
   * taught the audit trigger to follow. A denormalised `centre_id` here would be a
   * second copy of a fact that cannot legitimately differ, and `staff_members` already
   * pins one person record per account per centre.
   */
  staff_member_id uuid primary key references public.staff_members(id) on delete cascade,

  /**
   * Every column below is nullable, and that is the design rather than laxity.
   *
   * "Not recorded" has to be distinguishable from a recorded value, because the census
   * readiness report's whole job is naming what is missing. A `not null default false`
   * on `is_paid` would make an unanswered question indistinguishable from "unpaid" and
   * put a wrong figure in a return that reported itself complete. The `overdue: null`
   * contract, and this is its seventh outing.
   */

  /** `StaffInformation.GenderCode`. Domain `gender` in 0080; unenumerated by the schema. */
  gender_code text,

  /**
   * `StaffInformation.AgeBand`. The twelve values ARE enumerated by the ELI schema, so
   * this is a sourced CHECK rather than a reference set — a lookup table for a closed
   * published list is a table that can drift from it.
   */
  age_band text,

  /** `EthnicGroupCodes`, one to three. Required inside an educational role. */
  ethnic_group_codes text[] not null default '{}',

  /** `IwiCodes`, zero to three. */
  iwi_codes text[] not null default '{}',

  /**
   * Which of the five `StaffRoles` shapes this person is, because the schema asks for
   * different fields depending on the answer: an educational role needs a
   * qualification, ethnicity and contact hours, and a support role needs none of them.
   * Sourced — these are the schema's own element names.
   */
  role_kind text,

  /** `StaffRoleCode`. Domain `staff_role`; unenumerated. */
  role_code text,

  /** `HighestQualificationCode`. Domain `qualification`; unenumerated. */
  highest_qualification_code text,

  /**
   * `HighestPlaycentreQualificationCode`, optional in the schema and nillable.
   * Recorded because the field exists, not because this product knows when it applies.
   */
  playcentre_qualification_code text,

  is_paid      boolean,
  is_permanent boolean,
  is_full_time boolean,

  /**
   * `MinAgeTaught` / `MaxAgeTaught`, in months, 0–72 in the schema. Months rather than
   * years because the schema says months, and 72 rather than 60 because the schema says
   * 72 — a six-year-old is in range and this product would not have guessed that.
   */
  min_age_taught_months smallint,
  max_age_taught_months smallint,

  previously_worked_as_teacher  boolean,
  arrived_from_another_service  boolean,

  /**
   * `LeavingTeacherDestination`. Enumerated by the schema as D01–D04 plus UNK, so a
   * sourced CHECK — but **the schema does not say what the four destinations mean**, so
   * nothing in this product may render a label for them until the Data Collection
   * Specification is read. Storing a code whose meaning is unknown is fine; printing a
   * guess at it is not.
   */
  leaving_destination_code text,

  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),

  constraint scd_age_band_known check (age_band is null or age_band in (
    'UN_20', '20_25', '26_30', '31_35', '36_40', '41_45',
    '46_50', '51_55', '56_60', '61_65', '66_70', 'OV_70'
  )),

  constraint scd_role_kind_known check (role_kind is null or role_kind in (
    'educational', 'home_based_educator', 'management', 'support', 'specialist'
  )),

  constraint scd_leaving_destination_known check (
    leaving_destination_code is null
    or leaving_destination_code in ('D01', 'D02', 'D03', 'D04', 'UNK')
  ),

  -- Cardinality from the schema: three ethnic group slots, three iwi slots.
  constraint scd_ethnic_groups_max_three check (cardinality(ethnic_group_codes) <= 3),
  constraint scd_iwi_max_three           check (cardinality(iwi_codes) <= 3),

  /**
   * The `LookupCode` bound on the scalar codes, so a value too long for the interface
   * is refused at the point of entry rather than at the Ministry.
   *
   * **The two arrays are deliberately not bounded per element here, and it is a
   * limitation rather than an omission.** A CHECK constraint cannot contain a
   * subquery, so `not exists (select 1 from unnest(...) where length(c) > 10)` is
   * rejected outright by Postgres; the only in-database route is an `immutable`
   * helper function called from the CHECK, and a function in a CHECK is a weaker
   * guarantee than it appears — it can be redefined later and the constraint keeps
   * reporting itself as enforced.
   *
   * So per-element validation lives in `@ece/core` with the rest of the census
   * readiness logic, which is where an over-long code becomes a *named gap on a
   * report* rather than a rejected write. That is the same treatment the unresolvable
   * codes get, for the same reason, and it matches `children.ethnicities` (0004),
   * which is `text[]` capped at three with no element check either.
   */
  constraint scd_codes_within_lookup_bound check (
    coalesce(length(gender_code), 0) <= 10
    and coalesce(length(role_code), 0) <= 10
    and coalesce(length(highest_qualification_code), 0) <= 10
    and coalesce(length(playcentre_qualification_code), 0) <= 10
  ),

  constraint scd_ages_taught_in_range check (
    (min_age_taught_months is null or min_age_taught_months between 0 and 72)
    and (max_age_taught_months is null or max_age_taught_months between 0 and 72)
  ),
  constraint scd_ages_taught_ordered check (
    min_age_taught_months is null
    or max_age_taught_months is null
    or max_age_taught_months >= min_age_taught_months
  )
);

comment on table public.staff_census_details is
  'The per-person facts the annual ECE Return asks for, shaped by the ELI EceReturn StaffInformation type. Every column nullable so "not recorded" stays visible to the readiness report. Registration and the Teaching Council number are NOT here — they live in staff_records, one source of truth.';

comment on column public.staff_census_details.age_band is
  'One of the twelve bands the ELI schema enumerates. A band rather than a date of birth: the band is the minimum that answers the question, and this product does not collect a staff birth date.';

comment on column public.staff_census_details.leaving_destination_code is
  'D01-D04 or UNK, sourced from the ELI schema. The schema does not define what they mean, so no label may be rendered for them until the Data Collection Specification is read.';

-- ---------------------------------------------------------------------------
-- The weekday contract that contact hours come from
--
-- `EducationalStaffRole.ContactHoursDetailList` is a list of weekday/start/end triples
-- — a *contract*, not a diary. `shifts` (0041) is one row per calendar date, which is
-- what a roster needs and cannot answer "what are this person's contracted contact
-- hours on a Tuesday". Deriving a contract by inferring a pattern from dated shifts
-- would be exactly the estimating this repo refuses on the funding path: it produces a
-- plausible number nobody agreed to.
--
-- So this is the contract, effective-dated, and `shifts` stays the record of what
-- actually happened. Two rows per weekday are legal and intended — a split shift is
-- ordinary in this sector, and the schema's list is unbounded.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_contact_hours (
  id              uuid primary key default gen_random_uuid(),
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,

  /**
   * ISO weekday, 1 = Monday through 7 = Sunday.
   *
   * The same convention as `enrolments.days`, deliberately, rather than the schema's
   * `Mo`/`Tu`/`We` strings. Two reasons: the mapping to the wire format belongs at the
   * boundary where every other ELI field is mapped, and an integer sorts and compares
   * where a two-letter code needs a lookup to do either.
   */
  weekday         smallint not null,

  from_time       time not null,
  to_time         time not null,

  /**
   * When this contract applies. Effective-dated because a previously submitted ECE
   * Return must not change when somebody's hours change — `AST49` states that
   * expectation directly. A return is assembled as at its own date, so last year's
   * return keeps last year's contract.
   */
  effective_from  date not null,
  effective_to    date,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint sch_weekday_valid check (weekday between 1 and 7),
  constraint sch_times_ordered check (to_time > from_time),
  constraint sch_dates_ordered check (effective_to is null or effective_to >= effective_from),

  /**
   * One person cannot be contracted to two overlapping blocks on the same weekday in
   * the same period.
   *
   * The `2000-01-01` anchor is `shifts_no_overlap`'s idiom, reused rather than
   * reinvented: Postgres has no `timerange`, `weekday with =` already confines the
   * comparison to one day of the week, and both bounds get the same anchor so it
   * cancels. The fourth dimension is the effective window, so superseding a contract
   * by ending the old one and starting a new one is legal while double-booking a
   * Tuesday is not.
   */
  constraint staff_contact_hours_no_overlap exclude using gist (
    staff_member_id with =,
    weekday with =,
    tsrange(
      ('2000-01-01'::date + from_time),
      ('2000-01-01'::date + to_time),
      '[)'
    ) with &&,
    daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[)') with &&
  )
);

create index if not exists staff_contact_hours_member_idx
  on public.staff_contact_hours (staff_member_id, weekday);

comment on table public.staff_contact_hours is
  'Contracted contact hours per weekday, effective-dated. The source for the ELI ContactHoursDetailList and for the return-week hours total. Distinct from shifts, which record what actually happened on a date.';

-- ---------------------------------------------------------------------------
-- The read predicate: owner or manager, or the person themselves
--
-- `caller_may_roster` (0041) is already the write predicate this wants. There is no
-- existing read predicate that means "or it is me", because until now nothing hanging
-- off a staff member was private from colleagues — a roster is not.
--
-- Definer, like every other predicate here, so it is not narrowed by the policies on
-- `staff_members`; and `stable` so the planner can hoist it.
-- ---------------------------------------------------------------------------

create or replace function public.caller_may_read_staff_census(p_member uuid)
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
       and (
         public.caller_has_role(m.centre_id, array['owner', 'manager']::public.member_role[])
         -- IPP 6. A person may read their own census record. Relievers with no account
         -- have a null user_id, which cannot match auth.uid() — so for them the answer
         -- is owner/manager only, which is correct rather than a gap: there is nobody
         -- to grant access to.
         or m.user_id = auth.uid()
       )
  )
$$;

comment on function public.caller_may_read_staff_census(uuid) is
  'Owner or manager at this person''s centre, or the person themselves. The IPP 6 half is why this exists rather than reusing caller_is_staff_for_member: a colleague may read a roster and may not read an ethnicity.';

revoke execute on function public.caller_may_read_staff_census(uuid) from public;
grant  execute on function public.caller_may_read_staff_census(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Policies and grants
--
-- Both halves of every policy, and insert/update/delete split rather than FOR ALL —
-- 0025's lesson: a narrowing condition placed only in WITH CHECK is not enforced on
-- DELETE, because PostgreSQL checks USING for it. The class assertion in
-- rls_isolation.sql requires the delete USING to match the insert WITH CHECK, so these
-- are written identically on purpose.
-- ---------------------------------------------------------------------------

alter table public.staff_census_details enable row level security;
alter table public.staff_contact_hours  enable row level security;

drop policy if exists staff_census_details_select on public.staff_census_details;
create policy staff_census_details_select on public.staff_census_details
  for select using (public.caller_may_read_staff_census(staff_member_id));

drop policy if exists staff_census_details_write_insert on public.staff_census_details;
create policy staff_census_details_write_insert on public.staff_census_details
  for insert with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_census_details_write_update on public.staff_census_details;
create policy staff_census_details_write_update on public.staff_census_details
  for update using      (public.caller_may_roster(staff_member_id))
          with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_census_details_write_delete on public.staff_census_details;
create policy staff_census_details_write_delete on public.staff_census_details
  for delete using (public.caller_may_roster(staff_member_id));

-- The roster is not private from colleagues, so contact hours follow `shifts`: any
-- staff member at the centre may read them, owners and managers maintain them.
drop policy if exists staff_contact_hours_select on public.staff_contact_hours;
create policy staff_contact_hours_select on public.staff_contact_hours
  for select using (public.caller_is_staff_for_member(staff_member_id));

drop policy if exists staff_contact_hours_write_insert on public.staff_contact_hours;
create policy staff_contact_hours_write_insert on public.staff_contact_hours
  for insert with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_contact_hours_write_update on public.staff_contact_hours;
create policy staff_contact_hours_write_update on public.staff_contact_hours
  for update using      (public.caller_may_roster(staff_member_id))
          with check (public.caller_may_roster(staff_member_id));

drop policy if exists staff_contact_hours_write_delete on public.staff_contact_hours;
create policy staff_contact_hours_write_delete on public.staff_contact_hours
  for delete using (public.caller_may_roster(staff_member_id));

/*
 * DELETE is granted on both, unlike `staff_records` and `staff_members`.
 *
 * Neither table is evidence of anything. A census detail is a current statement of
 * fact about a person's employment, and a contact-hours row is a contract that may be
 * entered wrongly and has to be removable — leaving a mistaken Tuesday block in place
 * would corrupt the derived hours total for every return that reads it. What must not
 * be deletable is the *record of what happened*, and that is `staff_attendance_events`
 * and `staff_records`, both of which keep their refusal.
 */
revoke all on public.staff_census_details from anon, authenticated, service_role;
revoke all on public.staff_contact_hours  from anon, authenticated, service_role;

grant select, insert, update, delete on public.staff_census_details to authenticated, service_role;
grant select, insert, update, delete on public.staff_contact_hours  to authenticated, service_role;

-- Audit triggers. Both tables hang off `staff_member_id`, which 0059 made the audit
-- trigger able to resolve to a centre — the defect that migration exists for was
-- `shifts` and `staff_leave` firing their triggers and writing nothing for months.
drop trigger if exists staff_census_details_audit on public.staff_census_details;
create trigger staff_census_details_audit
  after insert or update or delete on public.staff_census_details
  for each row execute function public.audit_trigger();

drop trigger if exists staff_contact_hours_audit on public.staff_contact_hours;
create trigger staff_contact_hours_audit
  after insert or update or delete on public.staff_contact_hours
  for each row execute function public.audit_trigger();
