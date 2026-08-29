-- ---------------------------------------------------------------------------
-- 0074 — incident investigations
--
-- 1Place's incident form has a second tab this product never saw until the
-- 2026-08-29 screenshots: Investigation Is Required, Date Investigated, Worksafe
-- Need To Be Advised, Hazard Register Updated, the staff:child ratio in the room
-- at the time, and what came of it all. docs/replacing-1place.md §7.3 records the
-- discovery; this migration closes the gap.
--
-- WHY A SEPARATE TABLE AND NOT COLUMNS ON `incidents`
--
-- A finalised incident freezes — `enforce_incident_transition` refuses every staff
-- edit once status is final, and that freeze is the register's whole claim to being
-- evidence. An investigation *happens after* the report is finished: WorkSafe is
-- advised days later, the hazard register is updated the following week. Columns on
-- `incidents` would force a choice between breaking the freeze for some columns
-- (and the trigger's what-changed logic becomes a column allowlist that grows) or
-- freezing the investigation half-written. A sibling table has neither problem.
--
-- The audiences differ too. A family reads the final report; the investigation is
-- the centre's own follow-up work — WorkSafe correspondence, hazard links, internal
-- notes. Staff-only, the 0034 boundary, and the RLS suite asserts a guardian cannot
-- read the investigation of an incident they CAN read.
--
-- A ROW IS A DECISION, NOT A FORM
--
-- `required` is NOT NULL and there is no default. A row with `required = false`
-- records that somebody considered investigating and decided not to; no row records
-- that nobody has considered it. Those are different facts and 0073 already made
-- the argument: "never asked" and "asked, and waiting" must not render the same.
--
-- THE RATIO IS DELIBERATELY NOT A COLUMN
--
-- 1Place asks staff to *type* the staff:child ratio at the time of the incident.
-- This product can compute it — `replayDay` over the attendance register already
-- reconstructs the ratio at any instant, and a computed figure is a measurement
-- where a remembered one is an assertion. Storing a typed copy beside a computable
-- truth is the two-sources-of-truth mistake the design tokens made before
-- `tokens:check` existed. The screen computes it at read and says what it computed
-- from. (Centre-wide, honestly labelled: attendance does not know rooms, so a
-- room-level figure is not computable and is not pretended to.)
--
-- WORKSAFE IS A YES/NO AND A DATE, NEVER A RULE
--
-- No trigger, no CHECK, no default decides *when* WorkSafe must be advised. Any
-- rule of the form "severity X requires notification" is a regulatory claim, and
-- nobody here has sourced one — the 0069 risk-band refusal, again. The columns
-- record what the centre did; whether it was required is the centre's judgement.
--
-- HAZARD REGISTER UPDATED IS A POINTER, NOT A BOOLEAN
--
-- 1Place asks "Hazard Register Updated: yes/no". This schema has the hazard
-- register three tables away, so the honest answer is the link itself: `hazard_id`
-- names the entry this investigation produced or updated, and its presence is the
-- yes. A boolean beside a nullable pointer would be two answers to one question.
-- ---------------------------------------------------------------------------

create table if not exists public.incident_investigations (
  id          uuid primary key default gen_random_uuid(),
  /**
   * Denormalised from the incident, like `checklist_runs.centre_id`: the policies
   * read it without a join and `audit_trigger()` attributes by it. The insert
   * policy refuses a row whose centre disagrees with its incident's, and the
   * UPDATE grant below withholds both ids so the pair cannot drift afterwards.
   */
  centre_id   uuid not null references public.centres(id) on delete cascade,
  incident_id uuid not null unique references public.incidents(id) on delete cascade,

  /** The decision itself. A row with `false` is "considered, not required". */
  required    boolean not null,

  /**
   * A local date typed by a person, like `tasks.due_on` — no default, and no
   * future CHECK, because `current_date` is UTC and refuses a New Zealand morning.
   */
  investigated_on date,
  investigated_by uuid references auth.users(id) on delete set null,

  /**
   * What the centre did about WorkSafe. Null means not stated — the three-state
   * convention every register here uses. No rule computes what it should be.
   */
  worksafe_advised    boolean,
  worksafe_advised_on date,

  /** The hazard-register entry this investigation produced or updated, if any. */
  hazard_id   uuid references public.hazards(id) on delete set null,

  /** Hospital, doctor, agency involvement — what 1Place spreads over six fields. */
  medical_followup text,
  agency_contacted text,

  outcome     text,
  notes       text,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  /** A date of advising WorkSafe asserts WorkSafe was advised. */
  constraint incident_investigations_worksafe_dated
    check (worksafe_advised_on is null or worksafe_advised is true)
);

comment on table public.incident_investigations is
  'The centre''s follow-up on an incident: whether investigation was required, what was done, WorkSafe advisement, the hazard-register link. One row per incident; the row is the record that somebody decided. Staff-only — a family reads the report, never this. The ratio at the time is computed from attendance at read and deliberately not stored here.';

comment on column public.incident_investigations.worksafe_advised is
  'What the centre did, not what was required. No rule in this schema decides when WorkSafe must be advised — that is a regulatory claim nobody has sourced. See unverified-claims.';

comment on column public.incident_investigations.hazard_id is
  'Replaces 1Place''s "Hazard Register Updated: yes/no" with the entry itself. Presence is the yes.';

create index if not exists incident_investigations_centre_idx
  on public.incident_investigations (centre_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Staff at the centre, nobody else — the 0034 boundary. The incident itself is
-- readable by the child's guardian once final; its investigation never is. The
-- suite asserts the difference on the same incident row.
-- ---------------------------------------------------------------------------

alter table public.incident_investigations enable row level security;

drop policy if exists incident_investigations_select on public.incident_investigations;
create policy incident_investigations_select on public.incident_investigations
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists incident_investigations_insert on public.incident_investigations;
create policy incident_investigations_insert on public.incident_investigations
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (created_by is null or created_by = auth.uid())
    /*
      The denormalised centre must be the incident's own. The subquery runs under
      the caller's RLS on `incidents`, which staff-for-child already satisfies for
      every incident at their centre — so this refuses exactly the mismatch and
      nothing else. Cheaper than a SECURITY DEFINER guard and with no EXECUTE
      grant to forget (the 0031/0072 omission, twice was enough).
    */
    and exists (
      select 1 from public.incidents i
      where i.id = incident_id
        and i.centre_id = incident_investigations.centre_id
    )
  );

drop policy if exists incident_investigations_update on public.incident_investigations;
create policy incident_investigations_update on public.incident_investigations
  for update using (centre_id in (select public.caller_staff_centre_ids()))
          with check (centre_id in (select public.caller_staff_centre_ids()));

-- No DELETE. An investigation is part of the incident's record; a centre that can
-- make one disappear cannot use the register to prove it followed anything up.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.incident_investigations from anon, authenticated, service_role;
grant select, insert on public.incident_investigations to authenticated, service_role;

-- `id`, `centre_id`, `incident_id`, `created_by`, `created_at` are absent, so an
-- investigation cannot be repointed at a different incident — refused by Postgres
-- on the privilege check, before any policy is consulted. The 0030 pattern.
grant update (required, investigated_on, investigated_by, worksafe_advised,
              worksafe_advised_on, hazard_id, medical_followup, agency_contacted,
              outcome, notes)
  on public.incident_investigations to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

drop trigger if exists incident_investigations_audit on public.incident_investigations;
create trigger incident_investigations_audit
  after insert or update or delete on public.incident_investigations
  for each row execute function public.audit_trigger();
