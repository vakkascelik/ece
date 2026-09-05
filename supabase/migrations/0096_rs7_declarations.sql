-- ---------------------------------------------------------------------------
-- 0096 — the RS7 declaration: six fields, every one of them RECORDED
--
-- The return's `Declaration` carries six fields and not one of them can be derived from
-- anything this product holds:
--
--   RegisteredTeachersSalariesAttestation      a legal statement about teacher salaries
--   RegisteredTeachersParityAttestation        a legal statement about pay parity
--   RegisteredTeachersParityAttestationCode    enumerated, the parity step
--   SubmitterName / ContactNumber / Designation   facts about a person
--
-- The first three are the service asserting something to the Crown about how it pays its
-- teachers. AGENTS §4's rule 5 — do not assert what you have not checked — lands squarely on
-- them: **nothing here may default, infer or carry forward an attestation.** The last three
-- are the opposite case and equally underivable: the person submitting is whoever submits.
--
-- Funding Handbook §14-4 asks for *"name, contact number, designation"*, which is independent
-- corroboration that the public XSD and the published Handbook describe the same return.
--
-- KEYED ON THE CENTRE AND THE PERIOD, because a declaration is made per return
--
-- Not on `centres`, which would make it a standing setting and let last period's attestation
-- ride along into this one. A funding period is four months and pay arrangements change; an
-- attestation that carried forward silently would be the product making the statement rather
-- than the service.
--
-- The period start is CONSTRAINED to February, June or October the first, because
-- `RS7PeriodStartDate` in the public schema is
-- `<xs:pattern value="[0-9]{4}-(02|06|10)-01"/>`, retrieved 2026-09-03 and corroborated by the
-- RS7 Return Specification 6.0. That is a sourced constraint, not a guessed one.
--
-- WHAT HAS NO CHECK, AND WHY THAT IS DELIBERATE
--
-- Nothing enforces a relationship between the parity attestation and the parity code. It is
-- tempting — surely a code without an attestation is incomplete? — but nothing read so far says
-- so, and a CHECK is a claim about the rule. `0084`'s paired CHECK exists because §6-1 states
-- the pairing; here no source states one, so the return REPORTS an incomplete declaration
-- rather than the database refusing it.
-- ---------------------------------------------------------------------------

create table if not exists public.rs7_declarations (
  id                    uuid primary key default gen_random_uuid(),
  centre_id             uuid not null references public.centres(id) on delete cascade,

  period_start_date     date not null,

  /*
    Three-state, all three of them. NULL is "not stated", which is what an unsigned declaration
    is, and it is NOT false — a service that has not answered has not answered "no".
  */
  salaries_attestation  boolean,
  parity_attestation    boolean,

  /*
    The six parity steps, verbatim from the public schema's enumeration. Text with a CHECK
    rather than a Postgres enum, matching how `0083` handles licence and service types: a new
    step arrives in a migration and an enum's value list is harder to extend under load.
  */
  parity_attestation_code text,

  submitter_name        text,
  contact_number        text,
  designation           text,

  recorded_at           timestamptz not null default now(),
  recorded_by           uuid references auth.users(id) on delete set null,

  -- One declaration per centre per period. A second would be an edit, not another statement.
  constraint rs7_declarations_one_per_period unique (centre_id, period_start_date),

  constraint rs7_declarations_period_is_a_return_period
    check (extract(month from period_start_date) in (2, 6, 10)
           and extract(day from period_start_date) = 1),

  constraint rs7_declarations_parity_code_known
    check (parity_attestation_code is null
           or parity_attestation_code in
              ('NOSTEP', 'STEP1', 'STEP1-6', 'STEP1-11', 'STP1-11P', 'STP1-11F')),

  -- Blank is not an answer. A submitter name of three spaces would satisfy `not null` and say
  -- nothing, so the emptiness is refused rather than stored and reported later.
  constraint rs7_declarations_names_not_blank
    check ((submitter_name is null or length(trim(submitter_name)) > 0)
           and (contact_number is null or length(trim(contact_number)) > 0)
           and (designation is null or length(trim(designation)) > 0))
);

create index if not exists rs7_declarations_centre_idx
  on public.rs7_declarations (centre_id, period_start_date desc);

comment on table public.rs7_declarations is
  'The RS7 return Declaration - six fields, all RECORDED from the service and none derived. The two attestations and the parity code are legal statements about teacher salaries; the three contact fields are facts about whoever submits. Keyed on centre AND period because a declaration is made per return: on centres it would become a standing setting and last period''s attestation would ride into this one, which would be the product making the statement rather than the service. Period start is constrained to Feb/Jun/Oct 1 from the public schema''s RS7PeriodStartDate pattern.';

comment on column public.rs7_declarations.parity_attestation_code is
  'One of NOSTEP, STEP1, STEP1-6, STEP1-11, STP1-11P, STP1-11F - verbatim from the public ELI schema''s enumeration, retrieved 2026-09-03. Nothing in this product knows what the steps MEAN and nothing may guess: it is a statement by the service about how it pays its teachers. NULL is not stated.';

comment on column public.rs7_declarations.salaries_attestation is
  'Three-state. NULL is not stated, which is what an unsigned declaration is, and is NOT false - a service that has not answered has not answered no.';

alter table public.rs7_declarations enable row level security;

/*
  OWNER OR MANAGER FOR EVERY VERB, INCLUDING SELECT.

  Wider than most tables here, deliberately narrowed: this is a legal attestation about staff
  pay, it sits behind the `manageCentre` funding surface, and an educator has no reason to read
  their employer's salary declaration. `absence_exemptions` (0089) has the same shape for a
  related reason — both are management statements rather than operational records.

  Verb-split, delete USING character-identical to the insert WITH CHECK. 0025's lesson, and
  there is a class assertion in rls_isolation.sql comparing the two.
*/

drop policy if exists rs7_declarations_select on public.rs7_declarations;
create policy rs7_declarations_select on public.rs7_declarations
  for select using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists rs7_declarations_write_insert on public.rs7_declarations;
create policy rs7_declarations_write_insert on public.rs7_declarations
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists rs7_declarations_write_update on public.rs7_declarations;
create policy rs7_declarations_write_update on public.rs7_declarations
  for update
  using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

drop policy if exists rs7_declarations_write_delete on public.rs7_declarations;
create policy rs7_declarations_write_delete on public.rs7_declarations
  for delete using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

revoke all on public.rs7_declarations from anon, authenticated, service_role;
grant select, insert, update, delete on public.rs7_declarations to authenticated, service_role;

/*
  Audited. A declaration is a statement to the Crown that somebody made on a date, and who
  changed it afterwards is exactly the question an audit asks. `centre_id` is on the row, so
  `audit_trigger()` resolves the tenant directly.
*/
drop trigger if exists rs7_declarations_audit on public.rs7_declarations;
create trigger rs7_declarations_audit
  after insert or update or delete on public.rs7_declarations
  for each row execute function public.audit_trigger();

/*
  ASSERTED, and it creates what it needs so it cannot skip — 0094's inline check quietly took an
  early return on a database with no staff members, and that looked like coverage in a diff.
*/
do $$
declare
  v_centre uuid;
  v_id     uuid;
  v_rows   integer;
  v_ok     boolean := false;
begin
  select id into v_centre from public.centres limit 1;
  if v_centre is null then
    raise exception '0096: no centres, so the constraints could not be exercised';
  end if;

  -- A period the schema does not allow.
  begin
    insert into public.rs7_declarations (centre_id, period_start_date)
    values (v_centre, date '2026-03-01');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '0096: a March period start was accepted, and the XSD allows only Feb/Jun/Oct';
  end if;

  -- A parity step that is not one of the six.
  v_ok := false;
  begin
    insert into public.rs7_declarations (centre_id, period_start_date, parity_attestation_code)
    values (v_centre, date '2026-06-01', 'STEP99');
  exception when check_violation then v_ok := true;
  end;
  if not v_ok then
    raise exception '0096: an unlisted parity step was accepted';
  end if;

  insert into public.rs7_declarations (centre_id, period_start_date, parity_attestation_code)
  values (v_centre, date '2026-06-01', 'STEP1-11')
  returning id into v_id;

  select count(*) into v_rows
    from public.audit_events
   where entity = 'rs7_declarations' and entity_id = v_id::text;

  delete from public.rs7_declarations where id = v_id;

  if v_rows = 0 then
    raise exception '0096: the audit trigger did not record an insert';
  end if;
end $$;
