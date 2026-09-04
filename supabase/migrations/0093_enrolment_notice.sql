-- ---------------------------------------------------------------------------
-- 0093 — the date a family gave notice, which is the one over-claim in this product
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THIS IS DIFFERENT FROM EVERY OTHER GAP RECORDED HERE
--
-- Every other missing piece in this schema makes a funding figure too LOW. This one makes it
-- too HIGH, and it is the only one.
--
-- §6-5: the Three Week Rule stops the moment a parent gives notice that the child will not
-- return — *"even if the three week period has not ended"* — and the Ministry recovers
-- anything claimed after that point. `classifyAbsences` in `@ece/core` has taken a
-- `noticeGivenOn` argument since the day it was written, with an assertion proving that a
-- session inside the window is refused once notice is given. **Nothing could supply it.**
--
-- `readFundingPeriod` passes null, so the window runs its full length, and `exportDisclaimer`
-- tells the service to go and check any child who has stopped attending. That disclosure was
-- the honest thing to do and it is not a fix: it moves the work to a person and asks them to
-- remember. This column is the fix.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `enrolments.end_date` IS NOT THIS, AND THE DIFFERENCE IS THE WHOLE POINT
--
-- Notice comes FIRST. A family says in March that the child is leaving at Easter; the notice
-- date is in March and the end date is in April. Between those two dates the enrolment is
-- still current, the child may still be attending some days, and **no absence may be claimed**.
--
-- The end date can also be absent entirely while notice has been given — a family that says
-- "she is not coming back" without settling a last day is the ordinary case, and it is
-- precisely the case §6-5 is written for.
--
-- So deriving one from the other in either direction is wrong. They are two facts.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHO GAVE IT, AND WHY THAT IS A GUARDIAN REFERENCE RATHER THAN FREE TEXT
--
-- The same shape 0087 chose for §6-1's signatures, and for a weaker reason honestly stated:
-- there, a signature attributed to the wrong family is a false record supporting a claim.
-- Here, getting the person wrong stops a claim that could have been made — it errs LOW, which
-- is the safe direction.
--
-- It is a reference anyway, because "the family gave notice" with nobody's name against it is
-- weaker evidence than everything else on this row, and because the trigger that already
-- guards the other two columns costs three characters to extend to a third.
--
-- PAIRED, both-or-neither, the shape 0084 took from `immunisation_sighting_complete` (0036).
-- A notice date with nobody attached says a claim was stopped and does not say who asked for
-- it to be.
--
-- NO TIME-RELATIVE CHECK. 0078's lesson, for the fourth migration in a row: a CHECK reading
-- `notice_given_on <= current_date` would make this table unrestorable from any backup, because
-- a dump recreates constraints before it inserts rows. A future notice date is a typo and
-- belongs in a trigger if it ever needs refusing.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DOES NOT DO
--
-- It does not remove the over-claim on its own, and saying otherwise would be the same mistake
-- as claiming §9-2 was fixed when `child_booking_schedule` was still empty. A service that
-- never records notice still gets the full window. What changes is that recording it now WORKS
-- — the column exists, the API can read it, and `classifyAbsences` already knows what to do
-- with it. The disclaimer's caution stays until a service has something to record.
-- ---------------------------------------------------------------------------

alter table public.enrolments
  add column if not exists notice_given_on date;

alter table public.enrolments
  add column if not exists notice_given_by uuid references public.guardians(id) on delete set null;

alter table public.enrolments
  drop constraint if exists enrolments_notice_complete;
alter table public.enrolments
  add constraint enrolments_notice_complete
  check ((notice_given_by is null) = (notice_given_on is null));

/*
  Notice cannot predate the enrolment it ends. Unlike a time-relative CHECK this compares two
  stored dates, so a restore re-validates it against the same pair it was written with and
  cannot fail on rows that were merely old — which is exactly the distinction 0078 turned on.
*/
alter table public.enrolments
  drop constraint if exists enrolments_notice_after_start;
alter table public.enrolments
  add constraint enrolments_notice_after_start
  check (notice_given_on is null or notice_given_on >= start_date);

comment on column public.enrolments.notice_given_on is
  'The date a parent or guardian gave notice that the child will not be returning. Funding Handbook 6-5 stops absence funding from this date "even if the three week period has not ended", and the Ministry recovers anything claimed after it. NOT end_date: notice comes first, the end date may be later or absent entirely, and between the two the enrolment is still current while no absence may be claimed. This is the only column in this schema whose absence made a funding figure too HIGH rather than too low.';

comment on column public.enrolments.notice_given_by is
  'Which guardian gave notice. A guardians reference for the same reason as signed_by, though the risk runs the other way: getting the person wrong here stops a claim that could have been made, which errs low. Paired with notice_given_on by a CHECK, and the same trigger requires a current guardian of the child.';

/*
  The signatory trigger, extended to a third column.

  Recreated rather than altered, because a trigger's argument list is fixed at creation — there
  is no `alter trigger ... set arguments`. The function itself is untouched: it is already
  generic over the column via `TG_ARGV`, which is the decision from 0087 paying for itself a
  second time.
*/
drop trigger if exists enrolments_signatories_are_guardians on public.enrolments;
create trigger enrolments_signatories_are_guardians
  before insert or update on public.enrolments
  for each row
  execute function public.assert_signatories_are_guardians(
    'signed_by', 'twenty_hours_attested_by', 'notice_given_by'
  );

/*
  NO COLUMN GRANT, checked rather than assumed for the fourth time: `enrolments` carries
  table-level SELECT/INSERT/UPDATE/DELETE for `authenticated` and its column-privilege counts
  equal its column count in every verb. Only `centres` is column-scoped in this schema
  (0047/0048, 0083). A grant line here would be harmless and misleading.
*/
