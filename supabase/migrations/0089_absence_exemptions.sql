-- ---------------------------------------------------------------------------
-- 0089 — absence-rule exemptions, §7-7
--
-- Phase 2D. Read from the Ministry's own page on 2026-09-04:
-- education.govt.nz/education-professionals/early-learning/funding-and-financials/
--   chapter-7-special-circumstances/7-7-absence-rule-exemptions
--
-- WHAT IT DOES TO THE ABSENCE RULES, which is why it comes before them
--
-- §6-5's Three Week Rule becomes a TWELVE week rule. §7-7's own words: *"Services may claim
-- funding for all the sessions/days a child was enrolled to attend, but was absent from,
-- within a 12-week period. The 12-week period begins on the first day of absence. No funding
-- may be claimed for any continuous absences from the 13th week onwards."*
--
-- Same anchor as §6-5 — the first day of the spell — and a different length. So 2F's window
-- is a parameter rather than a constant, and this table is what supplies it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SCOPED TO AN ENROLMENT, NOT TO A CHILD, AND THE HANDBOOK SAYS SO
--
-- *"Exemptions apply only to specific enrolment agreements."* So the foreign key is to
-- `enrolments`, not to `children`. It matters in a case that really happens: a child who
-- leaves and comes back has two enrolment rows, and an exemption granted against the first
-- does not carry to the second. A child-scoped table would have silently extended it.
--
-- The same clause is why §7-7 adds *"Children enrolled at two services cannot receive funding
-- for absences at both"* — the exemption travels with an agreement, and a child can hold two.
-- Unenforceable from here, like the other-service hours in 0087, and for the same reason: the
-- second service is invisible to this database.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- TWO BASES, FOUR EVIDENCE TYPES, AND THE PAIRING IS NOT FREE
--
-- Quoting the criteria, because the shape of the table is a transcription of them:
--
--   1. An ONGOING LEARNING SUPPORT NEED, supported by any ONE of three things:
--        - an Individual Development Plan from the Ministry's Learning Support team or an
--          accredited early childhood special education provider, *"issued within previous
--          6 months"*
--        - a completed EC13 form
--        - Child Disability Allowance documentation
--   2. A SHORT-TERM ILLNESS OR CONDITION, supported by *"an EC13 form specifying the
--      exemption period"*
--
-- Two constraints fall straight out of that and are enforced:
--
--   - A short-term illness can only be evidenced by an EC13. The other two are instruments
--     of an ongoing need; a Child Disability Allowance letter does not evidence a fortnight
--     of chickenpox.
--   - A short-term illness must carry an END DATE, because the form *specifies the exemption
--     period*. An ongoing need may be open-ended, and that is the difference between the two.
--
-- AND ONE THAT IS DELIBERATELY NOT ENFORCED: the IDP's six-month recency. `evidence_dated_on`
-- is required for an IDP so the condition is answerable, and no CHECK refuses an older one.
-- Two reasons. A time-relative CHECK is what 0078 had to undo — it makes a table
-- unrestorable, because a dump recreates constraints before it inserts rows. And "within
-- previous 6 months" does not say previous to WHAT: the application, the claim, or the
-- absence. Encoding a guess as a constraint would refuse a service recording something true.
-- So it is stored, and whether it satisfies §7-7 is a question the readiness surface asks.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NOT AN APPROVAL, AND THE TABLE MUST NOT READ LIKE ONE
--
-- §7-7 asks the service to complete an EC12 *"(and EC13 where applicable) with supporting
-- documentation, retained by the service and provided to the Ministry or Resourcing Auditors
-- upon request"*. There is no application to the Ministry and no decision coming back.
--
-- So there is no `approved_at`, no `approved_by`, no status column. Those would be four
-- different lies at once. `ec12_completed_on` is the date the service completed its own form,
-- which is the only dated act in the process, and the column comment says so. Contrast §7-5,
-- where an emergency closure DOES need ERO approval and a letter comes back — a distinction
-- worth keeping straight, because the two sections sit two pages apart.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHO MAY SEE IT: OWNER AND MANAGER ONLY, AND THAT IS THE NARROW CHOICE ON PURPOSE
--
-- Narrower than `health_conditions`, which an educator reads because they have to respond to
-- an allergy at the door. An absence-rule exemption is a purely financial instrument: an
-- educator gains nothing operationally from it, and the row discloses that a child has an
-- ongoing learning support need or a health problem. That is the most sensitive thing on this
-- table and the reason to keep the audience small.
--
-- A PARENT CANNOT READ THEIR OWN CHILD'S EITHER, which is a real trade-off rather than an
-- oversight. They supplied the EC13, so they know; but a self-service view of this is a
-- disclosure surface nobody has asked for, and the honest default when the balance is unclear
-- is the narrow one. Written down here so the next reader knows it was weighed.
-- ---------------------------------------------------------------------------

create table if not exists public.absence_exemptions (
  id                 uuid primary key default gen_random_uuid(),

  -- §7-7: "Exemptions apply only to specific enrolment agreements."
  enrolment_id       uuid not null references public.enrolments(id) on delete cascade,

  basis              text not null,
  evidence           text not null,

  /*
    The date the evidence itself carries — an IDP's issue date, for §7-7's "issued within
    previous 6 months". Required for an IDP, because without it the condition cannot be
    answered at all; optional for the others, which carry no recency condition.
  */
  evidence_dated_on  date,

  -- The date the SERVICE completed its EC12. Not an approval date: nobody approves this.
  ec12_completed_on  date not null,

  exempt_from        date not null,
  -- Null means open-ended, which only an ongoing learning support need may be.
  exempt_to          date,

  notes              text,

  recorded_at        timestamptz not null default now(),
  recorded_by        uuid references auth.users(id) on delete set null,

  constraint absence_exemptions_basis_known
    check (basis in ('ongoing_learning_support', 'short_term_illness')),

  constraint absence_exemptions_evidence_known
    check (evidence in ('idp', 'ec13', 'child_disability_allowance')),

  -- A short-term illness is evidenced by an EC13 and nothing else. A Child Disability
  -- Allowance letter does not evidence a fortnight of chickenpox.
  constraint absence_exemptions_short_term_needs_ec13
    check (basis <> 'short_term_illness' or evidence = 'ec13'),

  -- "an EC13 form specifying the exemption period" — so a short-term exemption has an end.
  constraint absence_exemptions_short_term_is_bounded
    check (basis <> 'short_term_illness' or exempt_to is not null),

  -- An IDP without its issue date makes the six-month condition unanswerable.
  constraint absence_exemptions_idp_needs_a_date
    check (evidence <> 'idp' or evidence_dated_on is not null),

  constraint absence_exemptions_dates_ordered
    check (exempt_to is null or exempt_to >= exempt_from),

  /*
    One exemption covering any given day of an agreement. Two overlapping ones are a
    data-entry mistake and the damage is arithmetic: 2F picks a window length from whichever
    exemption covers the first day of an absence spell, and two answers for one day is not a
    choice anything downstream can make.

    `[]` at both ends, matching `service_closures` (0088) and `coversDate` in `@ece/core`, so
    the database and the TypeScript cannot disagree about a boundary day. `btree_gist` comes
    from 0004.
  */
  constraint absence_exemptions_no_overlap exclude using gist (
    enrolment_id with =,
    daterange(exempt_from, coalesce(exempt_to, 'infinity'::date), '[]') with &&
  )
);

create index if not exists absence_exemptions_enrolment_idx
  on public.absence_exemptions (enrolment_id, exempt_from);

comment on table public.absence_exemptions is
  'Exemptions from the absence rules under ECE Funding Handbook 7-7, read 2026-09-04. Extends the Three Week Rule to a TWELVE week rule for the enrolment it covers: funding may be claimed for enrolled-but-absent sessions within a 12-week period beginning on the first day of absence, and nothing from the 13th week. Scoped to an enrolment agreement, not to a child, because 7-7 says exemptions apply only to specific enrolment agreements - so a child who leaves and returns does not carry one across. NOT an approval: the service completes an EC12 and retains the documentation, providing it to the Ministry or Resourcing Auditors on request.';

comment on column public.absence_exemptions.basis is
  'ongoing_learning_support or short_term_illness - the two criteria in 7-7. A child is NOT eligible on the basis of a parent or sibling having a learning support need or health problem; 7-7 says so explicitly.';

comment on column public.absence_exemptions.evidence is
  'What the service holds. An ongoing learning support need may be evidenced by an IDP issued within the previous 6 months, a completed EC13, or Child Disability Allowance documentation. A short-term illness may only be evidenced by an EC13, which specifies the exemption period - both of those are CHECK constraints.';

comment on column public.absence_exemptions.evidence_dated_on is
  'The date the evidence carries - an IDP issue date, for 7-7s "issued within previous 6 months". Required for an IDP so the condition is answerable. NO CHECK enforces the recency: a time-relative CHECK would make this table unrestorable (see 0078), and "previous 6 months" does not say previous to what - the application, the claim, or the absence. Stored, and assessed by the readiness surface rather than by a constraint encoding a guess.';

comment on column public.absence_exemptions.ec12_completed_on is
  'The date the SERVICE completed its EC12 form. NOT an approval date - 7-7 involves no application to the Ministry and no decision coming back, unlike 7-5 emergency closures, which do need ERO approval. There is deliberately no status column here.';

comment on column public.absence_exemptions.exempt_to is
  'Last day of the exemption, inclusive. NULL means open-ended, which only an ongoing learning support need may be - a short-term illness is bounded by its EC13 and a CHECK enforces that.';

alter table public.absence_exemptions enable row level security;

/*
  A definer predicate rather than a policy that reads `enrolments` directly.

  This is the trap `conventions.md` records: a policy body that selects from another table
  inherits THAT table's RLS, so a caller who cannot see the enrolment row would be refused by
  a policy that looks like it is asking about roles. `caller_may_enrol` (0085) exists for the
  same reason and takes a child; this takes an enrolment, because 7-7 scopes an exemption to
  an agreement rather than to a child.

  Owner and manager for every verb, read included. See the header for why an educator and a
  parent are both outside it.
*/
create or replace function public.caller_may_exempt(p_enrolment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.enrolments e
     where e.id = p_enrolment
       and public.caller_has_role(e.centre_id, array['owner', 'manager']::public.member_role[])
  )
$$;

revoke all    on function public.caller_may_exempt(uuid) from public;
revoke execute on function public.caller_may_exempt(uuid) from anon;
grant execute on function public.caller_may_exempt(uuid) to authenticated, service_role;

-- Verb-split, with the delete USING written character-identical to the insert WITH CHECK —
-- 0025's lesson, and the class assertion in `rls_isolation.sql` compares the two.

drop policy if exists absence_exemptions_select on public.absence_exemptions;
create policy absence_exemptions_select on public.absence_exemptions
  for select using (public.caller_may_exempt(enrolment_id));

drop policy if exists absence_exemptions_write_insert on public.absence_exemptions;
create policy absence_exemptions_write_insert on public.absence_exemptions
  for insert with check (public.caller_may_exempt(enrolment_id));

drop policy if exists absence_exemptions_write_update on public.absence_exemptions;
create policy absence_exemptions_write_update on public.absence_exemptions
  for update
  using (public.caller_may_exempt(enrolment_id))
  with check (public.caller_may_exempt(enrolment_id));

drop policy if exists absence_exemptions_write_delete on public.absence_exemptions;
create policy absence_exemptions_write_delete on public.absence_exemptions
  for delete using (public.caller_may_exempt(enrolment_id));

-- A new table, so its own table grant and no column grant. Only `centres` is column-scoped
-- in this schema; Postgres tests the table privilege before the policy.
revoke all on public.absence_exemptions from anon, authenticated, service_role;
grant select, insert, update, delete on public.absence_exemptions to authenticated, service_role;

drop trigger if exists absence_exemptions_audit on public.absence_exemptions;
create trigger absence_exemptions_audit
  after insert or update or delete on public.absence_exemptions
  for each row execute function public.audit_trigger();
