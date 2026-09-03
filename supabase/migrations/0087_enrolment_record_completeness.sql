-- ---------------------------------------------------------------------------
-- 0087 — the rest of what §6-1 requires an enrolment record to contain, and a
--        correction to 0084 three commits old
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT §6-1 ASKS FOR, AND WHERE THIS PRODUCT STOOD BEFORE THIS MIGRATION
--
-- ECE Funding Handbook §6-1, read from the Ministry's page 2026-09-04. Measured against
-- the schema rather than remembered:
--
--   official name, date of birth, residential address, preferred names   0004 + 0086
--   the date attendance commenced, and the finish date                   0004
--   the days and times expected, and later changes to the agreement      0085
--   National Student Number                                              0004
--   attestation of the hours enrolled AT ANOTHER SERVICE                 ABSENT -> here
--   a dated signature of at least one parent/guardian                    ABSENT -> here
--
-- The last two are the whole of what is left, and `unverified-claims` item 58 has held
-- them open since 2026-09-04.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE OTHER-SERVICE HOURS ARE NOT AN ADMINISTRATIVE FIELD
--
-- The 6-hour daily and 30-hour weekly caps (§9-2, §9-3) follow the CHILD, not the service.
-- A child enrolled at two services can exceed them between the two, and this product
-- currently applies both caps as though each service were the only one. §7-7 rests on the
-- same fact when it says a child with learning-support needs "enrolled at 2 services for the
-- same hours of attendance cannot be funded for absences at both".
--
-- AND IT IS UNENFORCEABLE FROM HERE, which has to be said plainly. `enrolments_no_overlap`
-- (0004) is scoped by `child_id` ACROSS centres, so this database already refuses a child
-- holding two overlapping enrolments *within it*. A second enrolment at another provider is
-- invisible. The attestation is the only instrument available, which is presumably why the
-- Handbook asks the parent for it rather than expecting the service to know.
--
-- NULL IS NOT ZERO, and the column exists to hold that distinction. §6-1 wants the hours
-- "including none if appropriate", so "the parent attested none" and "nobody has asked" are
-- different states and the funding surface must be able to tell them apart. Same three-state
-- contract as `enrolments.enrolment_type` and every other not-stated field here.
--
-- THE UNIT IS PER WEEK, AND THAT IS AN INTERPRETATION RATHER THAN A QUOTATION. §6-1 says
-- "the hours" without naming a period. Weekly is chosen because it matches
-- `funded_hours_per_week` on this same row and the weekly cap the figure feeds, and a
-- column whose unit had to be inferred from context would be worse than one whose name
-- states it. Recorded in the register rather than presented as the Handbook's own word.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONE SIGNATURE PER RECORD, NOT ONE PER FIELD
--
-- §6-1 item 5 asks for "a dated signature of at least one parent/guardian to attest to the
-- accuracy of the enrolment record" — the record, as a whole. So the other-service hours get
-- no signature pair of their own: they are part of the record the signature attests to.
-- Also an interpretation, also in the register.
--
-- The booking schedule gets its own pair, and that is NOT the same interpretation. §6-1 asks
-- separately for "details of any later changes to the agreement signed and dated by at least
-- one parent/guardian" — a change to the days and times is signed when it is made, which is
-- a different act on a different date from signing the enrolment record.
--
-- Both pairs use the both-or-neither CHECK shape 0084 took from
-- `immunisation_sighting_complete` (0036): a date with no signatory, or a signatory with no
-- date, is a half-recorded signature and worse than none.
--
-- NO TIME-RELATIVE CHECK ON EITHER DATE. 0078's lesson, restated in 0084 and still true: six
-- CHECK constraints reading `at > now() - interval '14 days'` made every table carrying one
-- unrestorable from any backup older than a fortnight, because a dump recreates constraints
-- before it inserts rows. A future signature date is a typo and belongs in a trigger if it
-- ever needs refusing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A CORRECTION TO 0084, WHICH IS MINE
--
-- `enrolments.twenty_hours_attested_by` references `auth.users`. The 20 Hours ECE attestation
-- is signed by a PARENT — 0004's own comment on `twenty_hours_ece` says "an attestation the
-- parent signs" — and a guardian may have no account at all: `guardians.user_id` is nullable
-- precisely so a grandparent on the collection list can exist without one. So that column
-- could only ever have held the staff member who ticked the box, recorded as though they were
-- the attesting party. On a funding record that is not a cosmetic mistake.
--
-- SAFE WITHOUT A DATA MIGRATION, AND MEASURED RATHER THAN ASSUMED. Both columns were counted
-- against the live database on 2026-09-04 before this was written:
--
--   select count(*) from public.enrolments where twenty_hours_attested_by is not null;  -- 0
--   select count(*) from public.enrolments where twenty_hours_attested_on is not null;  -- 0
--
-- Nothing writes them yet. Had either been non-zero this would have needed a mapping from
-- `auth.users` to `guardians` and a decision about rows with no mapping, which is a different
-- and much larger migration.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE FOREIGN KEY IS NOT ENOUGH, AND THE REASON IS TENANCY
--
-- `references public.guardians(id)` permits ANY guardian row in the database — including one
-- belonging to another centre. A foreign key has no idea what a tenant is. So an owner could
-- record another centre's parent as having signed this child's enrolment record, and nothing
-- in this schema would object: a cross-tenant reference stored on a compliance field, in a
-- product whose central rule is that Postgres is the boundary.
--
-- A CHECK cannot express it — it cannot query another table — so this is a trigger, and
-- `assert_signatories_are_guardians` below requires the signatory to be a CURRENT guardian OF
-- THAT CHILD. Being a guardian of the child implies the same centre, so the tenancy question
-- and the "is this even the right family" question have one answer.
--
-- Restore-safe, unlike the CHECK 0078 had to undo: `pg_dump` creates triggers in the
-- post-data section, AFTER the rows are loaded, so a restore does not re-validate history.
--
-- IT DOES NOT REQUIRE `child_guardians.is_authorised_signatory`, and that deserves saying
-- because the flag is sitting right there. That flag (0061) means "may verify the child's
-- ATTENDANCE record", which is §6-3 criterion 4 — a different authority under a different
-- rule. §6-1 asks for "at least one parent/guardian" with no qualifier, so requiring the flag
-- here would be this product inventing an entry condition the Handbook does not state.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO COLUMN GRANTS, CHECKED AGAINST THE LIVE DATABASE
--
-- Measured 2026-09-04, the same way 0084 and 0086 were:
--
--   enrolments              authenticated holds table-level SELECT/INSERT/UPDATE/DELETE, and
--                           its column-privilege counts are 13 = 13 = 13 against 13 columns
--   child_booking_schedule  table-level SELECT/INSERT/UPDATE/DELETE
--
-- Both are table-wide, so new columns are readable and writable the moment they exist. Only
-- `centres` is column-scoped (0047/0048, 0083). A grant line here would be harmless and
-- MISLEADING — it would imply these tables are column-scoped and send the next reader looking
-- for the rest of a list that does not exist.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The hours the child is enrolled at another service
-- ---------------------------------------------------------------------------

alter table public.enrolments
  add column if not exists hours_at_other_service_per_week numeric(5, 2);

-- The same band as `enrolments_hours_sane` on `funded_hours_per_week`, deliberately rather
-- than a second invented bound: it is a sanity limit on a weekly hours figure, and this table
-- already decided what that looks like. Nothing regulatory is being asserted by the number.
alter table public.enrolments
  drop constraint if exists enrolments_other_service_hours_sane;
alter table public.enrolments
  add constraint enrolments_other_service_hours_sane
  check (hours_at_other_service_per_week is null
         or hours_at_other_service_per_week between 0 and 50);

-- ---------------------------------------------------------------------------
-- 2. The dated parent signature on the enrolment record — §6-1 item 5
-- ---------------------------------------------------------------------------

alter table public.enrolments
  add column if not exists signed_on date;

alter table public.enrolments
  add column if not exists signed_by uuid references public.guardians(id) on delete set null;

alter table public.enrolments
  drop constraint if exists enrolments_signature_complete;
alter table public.enrolments
  add constraint enrolments_signature_complete
  check ((signed_by is null) = (signed_on is null));

-- ---------------------------------------------------------------------------
-- 3. The same, on a change to the days and times — §6-1, the clause about changes
-- ---------------------------------------------------------------------------

alter table public.child_booking_schedule
  add column if not exists signed_on date;

alter table public.child_booking_schedule
  add column if not exists signed_by uuid references public.guardians(id) on delete set null;

alter table public.child_booking_schedule
  drop constraint if exists child_booking_schedule_signature_complete;
alter table public.child_booking_schedule
  add constraint child_booking_schedule_signature_complete
  check ((signed_by is null) = (signed_on is null));

-- ---------------------------------------------------------------------------
-- 4. The 0084 correction: the 20 Hours attestation is signed by a guardian
-- ---------------------------------------------------------------------------

alter table public.enrolments
  drop constraint if exists enrolments_twenty_hours_attested_by_fkey;
alter table public.enrolments
  add constraint enrolments_twenty_hours_attested_by_fkey
  foreign key (twenty_hours_attested_by) references public.guardians(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5. A signatory must be a current guardian of that child
-- ---------------------------------------------------------------------------

/*
 * Generic over the column, because three columns on two tables ask the same question and
 * three near-identical function bodies is the duplication this schema keeps catching. The
 * column names come from `TG_ARGV` and the value out of `to_jsonb(new)`, so adding a fourth
 * signature column later is a trigger argument rather than a fourth function.
 *
 * ONLY VALIDATES WHEN THE SIGNATORY IS SET OR CHANGED. Without that guard, revoking a
 * guardianship would make every later UPDATE of an unrelated column on that row fail — a row
 * that cannot be edited because of something true about a person who signed it last year.
 * `is not distinct from` rather than `<>`, so a null-to-null update is also a no-op.
 *
 * SECURITY DEFINER so it sees the true state of `child_guardians` rather than the caller's
 * RLS-filtered view. It returns nothing and leaks nothing: the only observable outcomes are
 * "the write succeeded" and "the write was refused", both of which the caller already knows.
 *
 * Raised as 23514 rather than a bespoke code. It IS a check violation — the fact that it is
 * enforced by a trigger instead of a CHECK is an implementation detail of what Postgres can
 * express, and callers that already handle 23514 should not need a second branch.
 */
create or replace function public.assert_signatories_are_guardians()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col text;
  v_new uuid;
  v_old uuid;
begin
  foreach v_col in array tg_argv loop
    v_new := (to_jsonb(new) ->> v_col)::uuid;
    if v_new is null then
      continue;
    end if;

    if tg_op = 'UPDATE' then
      v_old := (to_jsonb(old) ->> v_col)::uuid;
      if v_new is not distinct from v_old then
        continue;
      end if;
    end if;

    if not exists (
      select 1
        from public.child_guardians cg
       where cg.child_id = new.child_id
         and cg.guardian_id = v_new
         and cg.revoked_at is null
    ) then
      raise exception
        '% is not a current guardian of this child, so cannot be recorded in %', v_new, v_col
        using errcode = '23514';
    end if;
  end loop;

  return new;
end;
$$;

-- Granted to nobody, the 0062/0063 shape. A trigger function does not need EXECUTE to fire —
-- Postgres calls it as part of the statement, not as an RPC — so a grant would only widen the
-- surface. `rls_isolation.sql` asserts 42501 on a direct call, because "granted to nobody" is
-- one dropped revoke away from "granted to everyone signed in" and nothing else would notice.
revoke all on function public.assert_signatories_are_guardians()
  from public, anon, authenticated, service_role;

drop trigger if exists enrolments_signatories_are_guardians on public.enrolments;
create trigger enrolments_signatories_are_guardians
  before insert or update on public.enrolments
  for each row
  execute function public.assert_signatories_are_guardians('signed_by', 'twenty_hours_attested_by');

drop trigger if exists child_booking_schedule_signatory_is_guardian on public.child_booking_schedule;
create trigger child_booking_schedule_signatory_is_guardian
  before insert or update on public.child_booking_schedule
  for each row
  execute function public.assert_signatories_are_guardians('signed_by');

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

comment on column public.enrolments.hours_at_other_service_per_week is
  'Hours per week the child is enrolled at ANOTHER service, as attested by a parent or guardian. Funding Handbook 6-1 requires this "including none if appropriate", so NULL (nobody has asked) and 0 (attested as none) are different states and must stay that way. It matters because the 6-hour daily and 30-hour weekly caps follow the CHILD, so a child at two services can exceed them between the two - and this product applies both caps as though each service were the only one. Unenforceable from here: enrolments_no_overlap already refuses two overlapping enrolments within this database, and an enrolment at another provider is invisible. The weekly unit is an interpretation - 6-1 says "the hours" without naming a period - chosen to match funded_hours_per_week on the same row. See unverified-claims item 58.';

comment on column public.enrolments.signed_on is
  'The date a parent or guardian signed the enrolment record. Funding Handbook 6-1 item 5: "a dated signature of at least one parent/guardian to attest to the accuracy of the enrolment record". Covers the record as a whole, including the other-service hours, which is why those have no signature pair of their own - an interpretation, recorded in unverified-claims item 58. Paired with signed_by by a CHECK. No time-relative CHECK refuses a future date; see 0078 for why that would make the table unrestorable.';

comment on column public.enrolments.signed_by is
  'Which guardian signed the enrolment record. References guardians, NOT auth.users, because a parent may have no account at all - guardians.user_id is nullable so a grandparent on the collection list can exist without one. A trigger requires the signatory to be a current guardian of that child, which a foreign key cannot express: the FK alone would accept another centre s guardian.';

comment on column public.child_booking_schedule.signed_on is
  'The date a parent or guardian signed this change to the days and times. Funding Handbook 6-1 asks separately for "details of any later changes to the agreement signed and dated by at least one parent/guardian", so this is a different act on a different date from the signature on the enrolment record. Paired with signed_by by a CHECK.';

comment on column public.child_booking_schedule.signed_by is
  'Which guardian agreed this block of days and times. Same guardians reference and the same trigger as enrolments.signed_by.';

comment on column public.enrolments.twenty_hours_attested_by is
  'Which guardian made the 20 Hours ECE attestation. CORRECTED BY 0087: 0084 pointed this at auth.users, but the attestation is signed by a parent - 0004 s own comment on twenty_hours_ece says so - and a guardian may have no account. Both attestation columns were empty when the reference was changed, verified by count against the live database, so no data migration was needed. Paired with twenty_hours_attested_on by a CHECK, and the same trigger requires the signatory to be a current guardian of the child.';

comment on function public.assert_signatories_are_guardians() is
  'Refuses a signature attributed to somebody who is not a current guardian of that child. Generic over the column via TG_ARGV so one body serves enrolments.signed_by, enrolments.twenty_hours_attested_by and child_booking_schedule.signed_by. Only validates when the signatory is set or changed, so revoking a guardianship does not make a row uneditable afterwards. Raises 23514 because it is a check violation that a CHECK cannot express - a CHECK cannot query another table. Granted to nobody: a trigger function does not need EXECUTE to fire.';
