-- ---------------------------------------------------------------------------
-- 0084 — whether an enrolment is permanent, and when 20 Hours was attested
--
-- Two additions to `enrolments`, both of which the ECE Funding Handbook asks for and
-- neither of which this schema could express.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. `enrolment_type` — THE AXIS ABSENCE FUNDING TURNS ON
--
-- `packages/core/src/funding.ts` has said since 2026-08-18 that the blocker on absence
-- funding is the schema and not the arithmetic, and named exactly this column. Handbook
-- §6-4, read from source on 2026-09-03:
--
--   "Funding for conditional or casual children is based on attendance only. Services
--    must not claim for conditional or casual children who book for a session or day and
--    do not attend."
--
-- So the product's current behaviour — funded hours derived only from attendance events —
-- is **exactly correct** for a casual or conditional child and **under-claims** for a
-- permanently enrolled one, who may be claimed for absences under §6-5, §6-6 and §6-7.
-- Without this column there is no way to ask which of the two a child is, so there is no
-- way to be right for both.
--
-- THE THREE VALUES ARE FROM THE HANDBOOK, NOT FROM THE ELI SCHEMA. Worth stating plainly
-- because it would be natural to look for them in the XSD and they are not there:
-- `ChildEnrolment` carries `ChildEnrolmentEntityId`, `ChildEntityId`,
-- `PrimaryResidentialAddress`, `SecondaryResidentialAddress`, `EnrolmentStartDate` and
-- `EnrolmentEndDate` — and **no enrolment type element at all** (checked against
-- https://eli.minedu.govt.nz/eli.xsd, 2026-09-03). This is a funding concept needed to
-- compute the counts correctly; it is never serialised to ELI.
--
-- The Handbook's own words are "permanently enrolled child", "casual" and "conditional",
-- with "conditional or casual child" used as a combined term. Stored as the three short
-- forms.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- 2. `twenty_hours_attested_on` / `_by` — A TICK IS NOT AN ATTESTATION
--
-- `twenty_hours_ece boolean` (0004) records that a service is claiming 20 Hours ECE for a
-- child. An attestation is a statement somebody made on a date, and the ELI schema asks
-- for it: `TwentyHoursSchedule` carries an `AttestationDate`. A bare boolean cannot answer
-- "who said so, and when", which is the question an audit asks.
--
-- Paired completeness rather than two independent columns, the same constraint shape as
-- `immunisation_sighting_complete` (0036): a date with no signatory, or a signatory with
-- no date, is a half-recorded attestation and worse than none.
--
-- WHAT THIS DELIBERATELY IS NOT: a history. It records the CURRENT attestation, not every
-- attestation ever made. If a service needs to show a chain — re-attested each year, say —
-- that is its own append-only table with a supersede pointer, the shape
-- `immunisation_records` uses, and it is a bigger change than this. Recording one
-- attestation properly is strictly better than recording none; building a history nobody
-- has asked for is the speculation this repo's guidelines forbid.
--
-- And the two columns are NOT coupled to `twenty_hours_ece`. A service that stops claiming
-- 20 Hours does not thereby un-attest what it attested last March, and a constraint
-- forcing the fields to null when the flag goes false would erase evidence to keep the row
-- looking tidy.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO TIME-RELATIVE CHECK ON THE DATE, AND THIS IS NOT AN OVERSIGHT
--
-- A future attestation date is a typo, and refusing it with
-- `check (twenty_hours_attested_on <= current_date)` is the obvious guard. It is also the
-- defect `0078` existed to undo: six CHECK constraints reading `at > now() - interval '14
-- days'` refused the restore of rows that were merely old, which meant **no backup of the
-- roll, sleep, medication or staff attendance older than a fortnight could be loaded** —
-- not here and not by `pg_restore`. A dump recreates constraints before it inserts data.
--
-- So a time-relative CHECK is not available on this table either. If a future date needs
-- refusing it belongs in a trigger, which a dump creates after the rows, exactly as 0078
-- moved the other six. It is not added here because nothing yet writes this column and a
-- guard for a screen that does not exist is speculation.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO COLUMN GRANT, AND THAT IS CHECKED RATHER THAN ASSUMED
--
-- 0083 needed `grant update (...)` because `centres` carries COLUMN-scoped grants.
-- `enrolments` does not: measured before writing this, `authenticated` holds table-level
-- SELECT, INSERT, UPDATE and DELETE, and its column-privilege counts equal its column
-- count in every verb. So these columns are readable and writable the moment they exist.
--
-- Recorded because the opposite mistake is now as likely as the original one: after
-- 0047/0048 and 0066/0082, the reflex is to add a grant line everywhere. A grant line here
-- would be harmless and misleading — it would imply `enrolments` is column-scoped, and the
-- next person would go looking for the rest of the list. Check, then write what is true.
-- ---------------------------------------------------------------------------

alter table public.enrolments
  add column if not exists enrolment_type text;

alter table public.enrolments
  add column if not exists twenty_hours_attested_on date;

alter table public.enrolments
  add column if not exists twenty_hours_attested_by uuid references auth.users(id) on delete set null;

alter table public.enrolments
  drop constraint if exists enrolments_type_known;
alter table public.enrolments
  add constraint enrolments_type_known
  check (enrolment_type is null or enrolment_type in ('permanent', 'casual', 'conditional'));

alter table public.enrolments
  drop constraint if exists enrolments_attestation_complete;
alter table public.enrolments
  add constraint enrolments_attestation_complete
  check ((twenty_hours_attested_by is null) = (twenty_hours_attested_on is null));

comment on column public.enrolments.enrolment_type is
  'permanent, casual or conditional. NULL means not stated, and absence funding cannot be computed for a child whose type is unknown - it is not assumed permanent, because assuming permanent over-claims. Source: ECE Funding Handbook 6-4, read 2026-09-03: funding for conditional or casual children is based on attendance only. This is a funding concept and is never sent to ELI - ChildEnrolment has no enrolment type element.';

comment on column public.enrolments.twenty_hours_attested_on is
  'The date the 20 Hours ECE attestation was made. NULL means no attestation is recorded, which is not the same as the boolean being false. Paired with twenty_hours_attested_by by a CHECK. Records the current attestation only, not a history; a chain of re-attestations would need its own append-only table. No time-relative CHECK refuses a future date - see 0078 for why that would make the table unrestorable.';

comment on column public.enrolments.twenty_hours_attested_by is
  'Who made the 20 Hours ECE attestation. References auth.users, set null on delete, so the date survives an account being removed - and a half-recorded attestation is refused by enrolments_attestation_complete rather than stored.';
