-- ---------------------------------------------------------------------------
-- 0088 — when the service was closed
--
-- ═══════════════════════════════════════════════════════════════════════════
-- FOUR CONSUMERS, WHICH IS WHY THIS COMES BEFORE THE ABSENCE RULES
--
-- Most tables here serve one screen. This one is a prerequisite for four separate things,
-- and three of them are already written and wrong without it:
--
--   1. §6-6, the extension for extended non-operation. A closure of two weeks or more
--      SUSPENDS the Three Week Rule rather than extending it, so absence funding cannot be
--      computed correctly without knowing which days the service was shut. The rule was
--      never transcribed, while the funding disclaimer claimed to cover "§6-4 to 6-7".
--   2. RS7's `AdvanceMonthCounts` — forward operating days by service model. A count of
--      operating days in a month ahead is arithmetic over a calendar nobody kept.
--   3. ELI's `EceServiceClosure` event: `ClosureStartDate`, `ClosureEndDate`,
--      `ClosureReasonCode`. It maps to nothing today. `eli-integration.md` has said so
--      since 2026-09-02.
--   4. `averageOverOpenDays` (`packages/core/src/occupancy.ts`) decides a day was open by
--      `d.children > 0`. THAT PROXY CANNOT TELL A CLOSED DAY FROM AN OPEN DAY NOBODY
--      ATTENDED, and the two are different facts about a service. It is used by the
--      occupancy figure and by both of `attendanceTrend.ts`'s summaries.
--
-- Point 4 is worth being precise about, because it is a live defect rather than a missing
-- feature: a centre that opened on a snow day and had nobody turn up is averaged as though
-- it had been shut, which flatters the occupancy figure. This migration makes the fix
-- possible; it does not make it, because changing an average is a change to a number
-- somebody may have quoted and belongs in its own commit with its own assertions.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- A PERIOD, NOT A DAY, AND NOT `booking_status`
--
-- The shape is pre-specified by the XSD: a start date, an end date and a reason. A row per
-- closed day would be a different table that happened to answer the same question, and
-- would have to be collapsed back into periods to serialise.
--
-- `bookings.booking_status = 'closed'` (0063) STAYS AS IT IS and is not the same statement.
-- That value says "this child had no place on this day"; this table says "the service did
-- not operate". A service can be open while one child's booking is closed, and the reverse
-- is not a booking fact at all. Deriving one from the other in either direction would make
-- a child-level record answer a service-level question.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `ends_on` IS NULLABLE, AND THAT IS A CLOSURE WITH NO STATED END
--
-- A flood closes a centre on Tuesday and nobody knows for how long. Recording that as a
-- one-day closure would be false, and refusing to record it until the end is known loses
-- the fact entirely. So null is "not yet known", the same three-state treatment
-- `enrolments.end_date` and `child_booking_schedule.effective_to` already get.
--
-- IT HAS A COST AND THE COST IS NAMED: `EceServiceClosure` carries `ClosureEndDate`, and an
-- open closure cannot be serialised without inventing one. That is a gap for the sender to
-- report rather than a value for this table to guess, and it is the same posture every
-- other unresolvable field in this schema takes.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE REASON CODE SHIPS UNRESOLVABLE, ON PURPOSE
--
-- `ClosureReasonCode` is a `LookupCode` the schema leaves unenumerated, and the Ministry has
-- not told us where the code lists are published — the first enquiry asked and the answer
-- has not come. `0080` reserved a `closure_reason` domain in `code_sets` and left it EMPTY.
--
-- So this column is `text` with the `LookupCode` length bound and NO foreign key to `codes`,
-- which is exactly what `0081` did for the census's code columns and for the same reason:
-- a foreign key would make the column unwritable until a list exists, and the honest
-- behaviour is to accept what the service tells us and report an unresolvable code as a
-- named gap on a readiness report. AGENTS.md §7 forbids seeding a code list nobody has read.
--
-- `reason_note` sits beside it because that is the only field a service can actually fill in
-- today. It is free text and it is not going on the wire.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OVERLAP IS REFUSED
--
-- Two overlapping closures are a data-entry mistake, and the damage is arithmetic: §6-6
-- counts consecutive closed days, and a period counted twice extends a suspension that
-- should have ended. Same GiST exclusion shape as `enrolments_no_overlap` (0004) and
-- `child_booking_schedule_no_overlap` (0085), `btree_gist` already being enabled by 0004.
--
-- `[]` rather than `[)` on the range, because both endpoints are inclusive here: a closure
-- from Monday to Friday includes Friday. That differs from the enrolment ranges deliberately
-- — an enrolment's end date is the last day and a new enrolment may start the day after,
-- whereas two closures cannot share a day at all.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHO MAY SEE IT: EVERY MEMBER, PARENTS INCLUDED
--
-- Wider than most tables here, and deliberately. A family needs to know the centre is shut
-- next Thursday; that is the single most operationally useful thing on this table and
-- hiding it behind a staff role would be perverse. Writing stays owner-or-manager, because
-- a closure changes funded days.
-- ---------------------------------------------------------------------------

create table if not exists public.service_closures (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres(id) on delete cascade,

  starts_on    date not null,
  -- Null means the service is closed with no stated end. See the header.
  ends_on      date,

  -- `ClosureReasonCode`, a LookupCode. Ships unresolvable; no FK to `codes` on purpose.
  reason_code  text,
  -- What the service can actually say today. Never serialised.
  reason_note  text,

  recorded_at  timestamptz not null default now(),
  recorded_by  uuid references auth.users(id) on delete set null,

  constraint service_closures_dates_ordered
    check (ends_on is null or ends_on >= starts_on),

  -- The LookupCode bound from the XSD, the same one `codes_code_within_lookup_bound` applies
  -- to the published lists. Refused here so a value too long for the interface is a sentence
  -- on a form rather than a truncation in a serialiser.
  constraint service_closures_reason_within_lookup_bound
    check (reason_code is null or length(reason_code) <= 10),

  -- A code that is present but blank serialises to an empty required attribute.
  constraint service_closures_reason_not_blank
    check (reason_code is null or length(trim(reason_code)) > 0),

  constraint service_closures_no_overlap exclude using gist (
    centre_id with =,
    daterange(starts_on, coalesce(ends_on, 'infinity'::date), '[]') with &&
  )
);

create index if not exists service_closures_centre_idx
  on public.service_closures (centre_id, starts_on);

comment on table public.service_closures is
  'Periods when the service did not operate. Four consumers: Funding Handbook 6-6 suspends the Three Week Rule while a service is closed for two weeks or more; RS7 AdvanceMonthCounts needs forward operating days; the ELI EceServiceClosure event maps here; and averageOverOpenDays currently infers a closed day from nobody attending, which cannot tell a closed day from an open day nobody came to. Distinct from bookings.booking_status = closed, which is a per-child-day statement.';

comment on column public.service_closures.ends_on is
  'The last closed day, inclusive. NULL means closed with no stated end - a flood on Tuesday with no known reopening. Not the same as a one-day closure. EceServiceClosure requires a ClosureEndDate, so an open closure cannot be serialised; that is a gap for the sender to report rather than a date for this table to invent.';

comment on column public.service_closures.reason_code is
  'ClosureReasonCode from the ELI schema, a LookupCode with no published list. Text with the LookupCode length bound and NO foreign key to codes - the same treatment 0081 gives the census code columns. code_sets reserves a closure_reason domain and it ships EMPTY, so a value here is unresolvable until the Ministry publishes the list. An unresolvable code belongs on a readiness report, not in a rejected write.';

comment on column public.service_closures.reason_note is
  'What the service can say today, in words. Free text, never serialised, and not a substitute for the code.';

alter table public.service_closures enable row level security;

-- Verb-split, with the delete USING character-identical to the insert WITH CHECK — 0025's
-- lesson, and the class assertion in `rls_isolation.sql` compares the two.

drop policy if exists service_closures_select on public.service_closures;
create policy service_closures_select on public.service_closures
  for select using (centre_id in (select public.caller_centre_ids()));

drop policy if exists service_closures_write_insert on public.service_closures;
create policy service_closures_write_insert on public.service_closures
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists service_closures_write_update on public.service_closures;
create policy service_closures_write_update on public.service_closures
  for update
  using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

drop policy if exists service_closures_write_delete on public.service_closures;
create policy service_closures_write_delete on public.service_closures
  for delete using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

/*
  A NEW TABLE, SO IT NEEDS ITS OWN TABLE GRANT AND NO COLUMN GRANT.

  Checked rather than assumed, as 0084 and 0086 both were: only `centres` is column-scoped in
  this schema (0047/0048, 0083). Postgres tests the table privilege BEFORE the policy, so
  without this line every caller is refused with 42501 and no policy ever runs — which is the
  failure `rls_isolation.sql` asserts for `anon` deliberately and would otherwise hit
  `authenticated` by accident.
*/
revoke all on public.service_closures from anon, authenticated, service_role;
grant select, insert, update, delete on public.service_closures to authenticated, service_role;

drop trigger if exists service_closures_audit on public.service_closures;
create trigger service_closures_audit
  after insert or update or delete on public.service_closures
  for each row execute function public.audit_trigger();
