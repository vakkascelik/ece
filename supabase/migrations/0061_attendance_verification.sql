-- ---------------------------------------------------------------------------
-- 0061 — the half of an attendance record that was never built: a parent's signature
--
-- This product has recorded attendance since 0009 and has never once recorded that a
-- family agreed with it. That is not a missing nicety. Chapter 6 of the ECE Funding
-- Handbook requires evidence that a parent or guardian "has regularly examined and
-- confirmed the attendance record" — once a week for all-day teacher-led centre-based
-- services — and it is the attendance record, verified, that underpins a claim on the
-- Crown. Without this table the product produces a funding preparation export from
-- figures nobody outside the centre has ever agreed to.
--
-- §6-3 sets twelve criteria for verifying attendance electronically. Before this
-- migration the repo met eight of them by accident of good design — PINs are per-guardian
-- and bcrypt (0044), nothing defaults to present (0009), every alteration is evident
-- (append-only plus the audit trigger), records are retained and extractable. It met none
-- of the four that are actually about verification.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- SOURCE, AND WHAT HAS NOT BEEN CHECKED ABOUT IT
--
-- The twelve criteria were retrieved on 2026-08-14 from
--   https://www.education.govt.nz/education-professionals/early-learning/funding-and-
--   financials/ece-funding-handbook/chapter-6-recording-enrolment-attendance-and-absence/
--   6-3-attendance-records
-- and the wording quoted in this file and in the wiki page came through an automated
-- extraction of that page rather than a person reading it. The substance is not in doubt
-- — weekly verification by an authorised signatory, with time, date and identity logged —
-- but the exact phrasing has NOT been read against the page by anybody.
--
-- Recorded in unverified-claims. Nothing in this migration depends on the precise wording;
-- the shape does not change if a clause reads slightly differently. Read it before the
-- feature is put in front of a centre.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE STATUS IS DERIVED AND NOT STORED, WHICH IS WHERE THE COMPETITION DIFFERS
--
-- The obvious design — the one an approved SMS in this market actually ships — is a status
-- column on a week: Awaiting approval, In Review, Approved, Failed. It is easy to read and
-- easy to query and it is a stored derivation of evidence that lives somewhere else, which
-- is the mistake 0009 refused to make with `children.is_present` and `ratioHistory` refused
-- to make by sampling.
--
-- A stored `approved` drifts the moment the attendance underneath it changes. It does not
-- report itself as drifted; it reports itself as approved. That is the same failure
-- direction as a ratio counter that has lost a sign-out, and it matters more here, because
-- the thing it is wrong about is a claim on public money.
--
-- So this table holds *events* — one row each time a signatory says yes or disputes — and
-- `summariseVerification()` in @ece/core derives the state from the rows plus the calendar.
-- The state nobody else models falls out of it for free: an approval that was true when it
-- was given and is no longer, because the record moved underneath it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THERE IS NO SNAPSHOT OF WHAT WAS APPROVED
--
-- Criterion 6 requires the signature "indicate the signatory's approval of the information
-- to which the signature relates", which reads like an instruction to copy the week's times
-- into the row so it is beyond argument what was agreed.
--
-- Refused, for 0055's reason and one better one.
--
-- 0055's reason: a snapshot is a second copy of a family's data under a different retention
-- rule from the first, on a table nobody can correct or purge.
--
-- The better one: it is not needed here, and it was not needed only because of a decision
-- made in Phase 3. `attendance_events` is append-only and a correction is a new row rather
-- than an edit, so the record as it stood at ANY past instant is exactly reconstructible by
-- ignoring rows with a later `created_at`. "What did this parent approve" is answerable
-- from the events and the timestamp alone. A snapshot would be a redundant second copy of a
-- reconstructible fact.
--
-- That is a property this repo paid for four phases ago and has never spent. It is spent
-- here, and the staleness rule below is what spends it.
--
-- What it costs, stated rather than discovered later: answering the question requires a
-- point-in-time replay rather than reading a column, so it is slower and it is code rather
-- than data. If that turns out to be too slow it is a materialised view over the events,
-- not a snapshot column on this table.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Who may sign
--
-- Criterion 4: "Only a parent or guardian who is an authorised signatory can verify
-- attendance records electronically."
--
-- On `child_guardians` rather than `guardians`, because the authority is per child. That
-- table already carries `can_collect` and `is_emergency_contact` for the same reason: a
-- grandmother who may collect on Tuesdays is not thereby the person who signs off the
-- funded hours, and a two-child family can name different signatories per child.
--
-- DEFAULT FALSE, AND THIS IS THE WHOLE POINT OF THE COLUMN.
--
-- Defaulting to true would make every contact on the record an authorised signatory the
-- moment they were added — which is criterion 7's "must not default to marking children as
-- present" wearing a different hat: a system that assumes the answer nobody gave. A centre
-- naming its signatories is a deliberate act, and if this column is boring to populate then
-- it is doing its job.
-- ---------------------------------------------------------------------------

alter table public.child_guardians
  add column if not exists is_authorised_signatory boolean not null default false;

comment on column public.child_guardians.is_authorised_signatory is
  'May this guardian verify this child''s attendance record electronically? ECE Funding '
  'Handbook 6-3, criterion 4. Defaults false on purpose: an authorised signatory is named '
  'by the centre, never assumed from the fact that somebody is a contact.';

-- ---------------------------------------------------------------------------
-- The caller's wards that they may actually sign for.
--
-- `caller_ward_ids()` is guardianship and deliberately says nothing about authority. This
-- is the same query with criterion 4 applied, and it exists as a function rather than as an
-- inline predicate because the policy below is not its only caller: the kiosk verification
-- path needs exactly this set, and a second hand-written copy of these joins is how the
-- `revoked_at` and `archived_at` conditions come to disagree with each other.
--
-- The joins ARE duplicated from `caller_ward_ids()`, which is the lesser of two evils.
-- Restructuring that function to take a filter would touch a security predicate that eleven
-- policies depend on, to save six lines here.
-- ---------------------------------------------------------------------------

create or replace function public.caller_signatory_ward_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cg.child_id
    from public.child_guardians cg
    join public.guardians   g on g.id = cg.guardian_id
    join public.children    c on c.id = cg.child_id
    join public.memberships m on m.centre_id = c.centre_id
                             and m.user_id = auth.uid()
                             and m.revoked_at is null
   where g.user_id = auth.uid()
     and g.archived_at is null
     and cg.revoked_at is null
     and cg.is_authorised_signatory
$$;

comment on function public.caller_signatory_ward_ids() is
  'The caller''s wards for which they are a named authorised signatory. Guardianship '
  'narrowed by ECE Funding Handbook 6-3 criterion 4 — see caller_ward_ids() for the '
  'unnarrowed set.';

revoke all    on function public.caller_signatory_ward_ids() from public;
grant execute on function public.caller_signatory_ward_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The record itself
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.verification_outcome as enum ('approved', 'disputed');
exception when duplicate_object then null; end $$;

comment on type public.verification_outcome is
  'approved = the signatory agrees the record is correct. disputed = they do not, and the '
  'comment says why. A dispute is a first-class outcome rather than an absence of one: '
  '"they did not sign" and "they said the Tuesday is wrong" are different facts and only '
  'one of them needs the centre to do something.';

do $$ begin
  create type public.verification_method as enum ('portal', 'kiosk', 'paper');
exception when duplicate_object then null; end $$;

comment on type public.verification_method is
  'How the signature was given. `paper` is the degradation path 6-3 explicitly preserves: '
  'electronic verification is optional, and a service whose family will not or cannot use '
  'it still has to verify on paper. Recording which is how a centre answers "who is '
  'actually verifying electronically" without guessing.';

create table if not exists public.attendance_verifications (
  id           uuid primary key default gen_random_uuid(),

  /*
   * No `centre_id`. The row reaches its tenant through the child, as
   * `detail_confirmations`, `attendance_events` and `invoice_lines` all do — so there is no
   * denormalised centre to drift from the child's, and no `.eq('centre_id', …)` for a
   * reader to forget, because there is no such column.
   */
  child_id     uuid not null references public.children(id)  on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,

  /*
   * The period verified, as a closed date range in the CENTRE's timezone.
   *
   * Both ends are stored rather than deriving the end from a week length, because the
   * cadence is not one length: 6-3 requires weekly verification for all-day teacher-led
   * services and monthly for sessional and parent/whānau-led ones. A schema that assumed
   * seven days would be wrong for half the services this product is required to support
   * before it may apply for ELI integration.
   */
  period_start date not null,
  period_end   date not null,

  outcome      public.verification_outcome not null,
  method       public.verification_method  not null,

  /* Required when disputing. "I disagree" without a reason is not actionable, and the
   * centre has to know which day to look at. */
  comment      text,

  /* Where the signed paper form is filed. `evidence` is a pointer rather than a file
   * store, which is exactly right for a form that lives in a drawer. */
  evidence_id  uuid references public.evidence(id) on delete set null,

  verified_at  timestamptz not null default now(),

  constraint av_period_ordered check (period_end >= period_start),

  constraint av_dispute_explained
    check (outcome <> 'disputed' or length(trim(coalesce(comment, ''))) > 0),

  constraint av_paper_evidenced
    check (method <> 'paper' or evidence_id is not null),

  /* Same tolerance as `detail_confirmations`. A signature dated into the future is a clock
   * problem or a lie, and neither should be stored. */
  constraint av_not_future check (verified_at <= now() + interval '1 minute')
);

comment on table public.attendance_verifications is
  'One row each time an authorised signatory approves or disputes a child''s attendance '
  'record for a period. ECE Funding Handbook 6-3. Append-only, and the current state of a '
  'period is DERIVED from these rows plus the attendance underneath them — see the header '
  'of 0061 for why a status column would be wrong.';

comment on constraint av_dispute_explained on public.attendance_verifications is
  'A dispute must say what is wrong. The centre has to know which day to correct, and a '
  'reason-less dispute produces a week that can never be resolved because nobody knows '
  'what resolving it would mean.';

comment on constraint av_paper_evidenced on public.attendance_verifications is
  'A paper verification without a pointer to the paper is a claim that a signature exists '
  'somewhere. That is the assertion this whole table is built to stop the product making.';

/*
 * NO UNIQUE CONSTRAINT ON (child_id, period_start), DELIBERATELY.
 *
 * A period can legitimately hold several rows: disputed on Monday, corrected by the centre,
 * approved on Thursday. The newest row wins, transitively, which is the rule `funding.ts`
 * already applies to attendance corrections. A unique constraint would make the dispute
 * path unrepresentable and force the resolution to be an UPDATE — on an append-only table,
 * which is the contradiction that would have quietly turned this into a status column.
 */
create index if not exists attendance_verifications_period_idx
  on public.attendance_verifications (child_id, period_start, verified_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- The two boundaries, and the inner one is the one that bites. Centre against centre is
-- carried by the child. Inside a centre, a signatory may verify their OWN ward and only as
-- THEMSELVES — a verification filed on a family's behalf is a record of an assurance they
-- never gave, which is precisely the thing a funding auditor is looking for.
--
-- Staff can read. "Has this family signed off last week" is the question the office asks
-- before preparing a claim, and an educator planning a trip has the same question in a
-- different form.
-- ---------------------------------------------------------------------------

alter table public.attendance_verifications enable row level security;

drop policy if exists attendance_verifications_select on public.attendance_verifications;
create policy attendance_verifications_select on public.attendance_verifications
  for select using (public.caller_may_see_child(child_id));

drop policy if exists attendance_verifications_insert on public.attendance_verifications;
create policy attendance_verifications_insert on public.attendance_verifications
  for insert with check (
    -- Criterion 4: a ward they are a NAMED SIGNATORY for. `caller_ward_ids()` would be the
    -- obvious function to reach for here and it is the wrong one — it is guardianship, and
    -- guardianship is not authority to sign.
    child_id in (select public.caller_signatory_ward_ids())
    -- Criterion 1 and 6: attributed to themselves, checked here rather than trusted from
    -- the client. `guardians.user_id` is the link, as in 0055.
    and exists (
      select 1 from public.guardians g
       where g.id = guardian_id
         and g.user_id = auth.uid()
    )
  );

-- No UPDATE and no DELETE policy, and the grants withhold the verbs as well, so append-only
-- is enforced twice — the arrangement 0009, 0055 and `payments` all use.
--
-- `service_role` is included in the revoke, and that is the branch that matters: the web
-- app's server actions hold that key, so a policy alone would leave the record editable by
-- the application that renders it. Criterion 5 requires every alteration be evident; the
-- cheapest way to make alterations evident is to make them impossible.
revoke all on public.attendance_verifications from anon, authenticated, service_role;
grant select, insert on public.attendance_verifications to authenticated, service_role;
