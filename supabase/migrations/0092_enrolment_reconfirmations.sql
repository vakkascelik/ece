-- ---------------------------------------------------------------------------
-- 0092 — the §6-7 reconfirmation
--
-- Phase 2E. §6-7 read from the Ministry's page on 2026-09-04, together with §6-8's worked
-- examples — and the examples turned out to say something §6-7's own prose does not. See the
-- register.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE RULE, IN ITS OWN WORDS
--
-- *"A child's attendance must match their enrolment agreement for at least half (i.e. 50 per
-- cent or more) of each calendar month."*
--
-- THREE TRIGGER SITUATIONS, and the third carries an exclusion this product can express:
--
--   1. absent on the same enrolled day(s) for more than half of those days in a calendar month
--   2. attends fewer days per week than enrolled, in more than half the weeks in a month
--   3. attends fewer hours than enrolled daily, on more than half of enrolled days in a month
--      — *"excludes sessional services"*, and `centres.service_model` (0083) is exactly that
--      distinction, so the exclusion is checkable rather than a footnote
--
-- THE TIMELINE: month 1 note it and claim; month 2 re-check, reconfirm if it continues, and
-- claim; month 3 *"must only be claimed if the child's enrolment agreement has been
-- reconfirmed"*; month 4 *"must not be claimed and the enrolment agreement must be changed to
-- match the child's attendance"*.
--
-- AND THE RULE MAY BE EXTENDED across *"periods of two or more weeks of non-operation
-- (holidays, renovations, etc.)"* — the same clause as §6-6, and `service_closures` (0088) is
-- what makes it answerable.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT A RECONFIRMATION IS: *"signed, dated confirmation from parents/guardians either
-- affirming the agreement remains valid or documenting revised attendance days/times"*
--
-- Two outcomes, and they are not degrees of the same thing. **Affirmed** says the agreement is
-- still right and the absences were incidental. **Revised** says the agreement was wrong and
-- here are the new days — which means `child_booking_schedule` should have a new block, and
-- month 4's *"the enrolment agreement must be changed"* is satisfied by that block rather than
-- by this row.
--
-- Nothing here enforces that a revision produced a block. A CHECK cannot see another table and
-- a trigger would refuse a service recording a signature it genuinely holds before entering
-- the new pattern. It belongs on the readiness surface, named.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- MIRRORS `attendance_verifications` (0061), WITH TWO DELIBERATE DIVERGENCES
--
-- The plan said mirror it, and it is the right template: a dated signature from a named
-- guardian, a `method` that keeps the paper path, attribution by policy rather than re-checked
-- in TypeScript, and status derived rather than stored.
--
--   REUSED: `public.verification_method` ('portal', 'kiosk', 'paper'). The same question —
--   how was the signature given — and the type already carries §6-3's reasoning about why
--   `paper` is a first-class path rather than a fallback. A second enum with the same three
--   values would be the duplication this schema keeps catching.
--
--   NOT REUSED: `verification_outcome` ('approved', 'disputed'). Wrong vocabulary. A
--   reconfirmation is affirmed or revised, and neither is a dispute. Text plus a CHECK rather
--   than a third enum, following 0083 and 0089 — an enum is painful to alter and this
--   vocabulary comes from prose that may be re-read.
--
--   NO PERIOD, WHICH IS THE DIVERGENCE WORTH EXPLAINING. `attendance_verifications` stores
--   `period_start` and `period_end` because it verifies a stretch of attendance that already
--   happened, and §6-3's cadence is weekly for some services and monthly for others. A
--   reconfirmation is not that: it is a forward-looking act on a single date, and what month 3
--   needs to know is whether one happened before it. Storing a period would invite somebody to
--   compute "the month this covers", which is derived from attendance and would then have two
--   sources.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- KEYED ON THE ENROLMENT, DIVERGING FROM 0061 ON PURPOSE
--
-- `attendance_verifications` keys on `child_id`, with a stated reason: the row reaches its
-- tenant through the child, so there is no denormalised centre to drift. That reason still
-- holds and this table still has no `centre_id`.
--
-- But §6-7 is about *"the child's enrolment agreement"*, and month 4 requires that agreement
-- to be **changed**. A child who leaves and comes back has two agreements, and a reconfirmation
-- of the first must not unlock a month-3 claim against the second — which a child-keyed table
-- would do silently. 0089 made the same call from §7-7's explicit *"exemptions apply only to
-- specific enrolment agreements"*; here the clause is implicit but the failure mode is the same.
--
-- `enrolment_id` is also audit-resolvable now, which it was not before 0090 — that migration
-- existed because 0089 keyed on it before the branch existed.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `on delete restrict` ON THE GUARDIAN, WHERE 0061 CASCADES
--
-- 0061 lets a guardian delete cascade its verifications away. This does not, because this row
-- is what makes a month-3 funding claim defensible: losing it silently to a hard delete would
-- leave a claim with no evidence behind it and nothing to say so.
--
-- Cheap in practice — guardians are archived (`archived_at`), not deleted, throughout this
-- product — so `restrict` almost never fires, and when it does the operator has to remove the
-- reconfirmation deliberately, which is the right amount of friction for evidence.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OWNER AND MANAGER, VIA A PREDICATE WHOSE NAME IS NARROWER THAN ITS BODY
--
-- `caller_may_exempt(enrolment)` from 0089 is reused. Its body is exactly the question — owner
-- or manager at the enrolment's centre — and its name says "exempt" because §7-7 was the first
-- caller. 0086 reused `caller_may_enrol` for addresses on the same grounds, and a second
-- predicate with an identical body would be the duplication both are avoiding.
--
-- A parent cannot read their own reconfirmation here, and that is a smaller loss than it looks:
-- they signed it, and §6-7 requires the SERVICE to hold it. A family-facing view of their own
-- signatures is a real feature and is not this one.
-- ---------------------------------------------------------------------------

create table if not exists public.enrolment_reconfirmations (
  id            uuid primary key default gen_random_uuid(),

  -- §6-7 reconfirms an enrolment agreement. See the header for why not `child_id`.
  enrolment_id  uuid not null references public.enrolments(id)  on delete cascade,
  -- Required: §6-7 wants confirmation "from parents/guardians". `restrict`, not `cascade`.
  guardian_id   uuid not null references public.guardians(id)   on delete restrict,

  -- The dated signature. One date, not a period — see the header.
  confirmed_on  date not null,

  outcome       text not null,
  method        public.verification_method not null,

  /*
    What changed, in words, when the outcome is `revised`. Not the new pattern itself — that
    belongs in `child_booking_schedule`, and duplicating it here would give a funding claim two
    sources for the same fact. This is the note that says which conversation happened.
  */
  detail        text,

  -- Where the signed paper form is filed, when `method = 'paper'`. A pointer, not a store:
  -- 0061's reasoning, and exactly right for a form that lives in a drawer.
  evidence_id   uuid references public.evidence(id) on delete set null,

  recorded_at   timestamptz not null default now(),
  recorded_by   uuid references auth.users(id) on delete set null,

  constraint er_outcome_known
    check (outcome in ('affirmed', 'revised')),

  /*
    A revision has to say what it revised. "The agreement changed" with no note is not
    something a service could answer an audit with, and it is the same reasoning as 0061's
    `av_dispute_explained`: an outcome that needs a reason is not recordable without one.
  */
  constraint er_revision_explained
    check (outcome <> 'revised' or (detail is not null and length(trim(detail)) > 0)),

  /*
    ONE RECONFIRMATION PER AGREEMENT PER DAY, and no exclusion constraint beyond that.

    Deliberately unlike 0085, 0088 and 0089, which all refuse overlapping periods. There is no
    period here to overlap, and §6-7's timeline expects REPEATED reconfirmation — a pattern
    that persists across several months is reconfirmed more than once. Refusing a second one
    would refuse the thing the rule asks for.

    What is refused is the same agreement reconfirmed twice on one day, which is a double
    submission rather than a second conversation.
  */
  constraint er_one_per_day unique (enrolment_id, confirmed_on)
);

create index if not exists enrolment_reconfirmations_enrolment_idx
  on public.enrolment_reconfirmations (enrolment_id, confirmed_on desc);

comment on table public.enrolment_reconfirmations is
  'Signed, dated confirmations under ECE Funding Handbook 6-7, the Frequent Absence Rule, read 2026-09-04. A childs attendance must match their enrolment agreement for at least half of each calendar month; where it does not, funding for absences in the third month must only be claimed if the agreement has been reconfirmed, and in the fourth month must not be claimed at all with the agreement changed to match attendance. Keyed on the enrolment rather than the child because month 4 requires THAT agreement to change, and a reconfirmation of a previous enrolment must not unlock a claim against a later one. Status is never stored here - which month is claimable is derived from attendance, the agreement and these rows together.';

comment on column public.enrolment_reconfirmations.outcome is
  'affirmed or revised - 6-7s two outcomes: "either affirming the agreement remains valid or documenting revised attendance days/times". A revision means child_booking_schedule should carry a new block; nothing here enforces that, because a CHECK cannot see another table and refusing the signature would be refusing a fact the service holds. The readiness surface names it instead.';

comment on column public.enrolment_reconfirmations.confirmed_on is
  'The date the parent or guardian signed. One date rather than a period: a reconfirmation is a forward-looking act, unlike attendance_verifications which verifies a stretch of attendance that already happened. What month 3 needs to know is whether one happened before it.';

comment on column public.enrolment_reconfirmations.detail is
  'What changed, in words, when the outcome is revised - required by a CHECK in that case. NOT the new pattern itself, which belongs in child_booking_schedule; duplicating it would give a funding claim two sources for one fact.';

alter table public.enrolment_reconfirmations enable row level security;

-- Verb-split, with the delete USING character-identical to the insert WITH CHECK — 0025's
-- lesson, and the class assertion in `rls_isolation.sql` compares the two.

drop policy if exists enrolment_reconfirmations_select on public.enrolment_reconfirmations;
create policy enrolment_reconfirmations_select on public.enrolment_reconfirmations
  for select using (public.caller_may_exempt(enrolment_id));

drop policy if exists enrolment_reconfirmations_write_insert on public.enrolment_reconfirmations;
create policy enrolment_reconfirmations_write_insert on public.enrolment_reconfirmations
  for insert with check (public.caller_may_exempt(enrolment_id));

drop policy if exists enrolment_reconfirmations_write_update on public.enrolment_reconfirmations;
create policy enrolment_reconfirmations_write_update on public.enrolment_reconfirmations
  for update
  using (public.caller_may_exempt(enrolment_id))
  with check (public.caller_may_exempt(enrolment_id));

drop policy if exists enrolment_reconfirmations_write_delete on public.enrolment_reconfirmations;
create policy enrolment_reconfirmations_write_delete on public.enrolment_reconfirmations
  for delete using (public.caller_may_exempt(enrolment_id));

revoke all on public.enrolment_reconfirmations from anon, authenticated, service_role;
grant select, insert, update, delete on public.enrolment_reconfirmations to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The signatory trigger, extended to resolve a child through an enrolment
-- ---------------------------------------------------------------------------

create or replace function public.assert_signatories_are_guardians()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_col   text;
  v_new   uuid;
  v_old   uuid;
  v_child uuid;
begin
  /*
    WHICH CHILD IS THIS ROW ABOUT? Extended by 0092.

    0087 read `new.child_id` directly, which was right for `enrolments` and
    `child_booking_schedule`. `enrolment_reconfirmations` (0092) carries `enrolment_id`
    and no `child_id`, because §6-7 reconfirms an enrolment agreement — so the child is
    resolved through the enrolment rather than denormalised onto the row, which would be a
    second copy of a fact that can drift.

    Same shape as the resolution chain in `audit_trigger()`, and for the same reason:
    one function serving several tables beats a near-identical function per table.
  */
  if to_jsonb(new) ? 'child_id' then
    v_child := (to_jsonb(new) ->> 'child_id')::uuid;
  elsif to_jsonb(new) ? 'enrolment_id' then
    select e.child_id into v_child from public.enrolments e
     where e.id = (to_jsonb(new) ->> 'enrolment_id')::uuid;
  end if;

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
       where cg.child_id = v_child
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

/*
  0087's trigger required a signatory to be a current guardian OF THAT CHILD, because a foreign
  key to `guardians` accepts any guardian in the database including another centre's. The same
  protection is wanted here, and §6-7 makes it sharper: this signature is what makes a month-3
  claim defensible, so a signature attributed to the wrong family is a false funding record.

  The function is 0087's body copied verbatim with the child resolution inserted, and the diff
  against 0087 checked to be exactly that — the convention 0090 established after its own first
  draft silently changed the audit format for every table in the product.
*/
drop trigger if exists enrolment_reconfirmations_signatory on public.enrolment_reconfirmations;
create trigger enrolment_reconfirmations_signatory
  before insert or update on public.enrolment_reconfirmations
  for each row
  execute function public.assert_signatories_are_guardians('guardian_id');

drop trigger if exists enrolment_reconfirmations_audit on public.enrolment_reconfirmations;
create trigger enrolment_reconfirmations_audit
  after insert or update or delete on public.enrolment_reconfirmations
  for each row execute function public.audit_trigger();
