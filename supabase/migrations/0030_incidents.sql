-- ---------------------------------------------------------------------------
-- 0030 — the incident register
--
-- The most-used form in a centre and the first thing a reviewer asks for, and it
-- has not existed for eight phases. An injury, an illness sending a child home, a
-- near miss with the gate: all of it currently lives on paper in a folder, which is
-- also where the evidence that a parent was told about it lives.
--
-- WHY THIS IS NOT ONE `child_register_events` TABLE WITH A JSONB PAYLOAD
--
-- Incidents, medication administration and sleep checks are the same *shape* — a
-- child, a time, a person, a note — and the generic table was the obvious design.
-- Rejected for a reason specific to this schema: `audit_events.detail` holds column
-- names and never values, which is the only thing that lets a child's record be
-- purged while the evidence it existed survives (0005, and the assertion in the
-- suite that no name or medical detail reaches the audit trail). A jsonb payload
-- defeats that. The audit row would either name one column, `detail`, and record
-- nothing useful, or it would carry the text of a child's injury into a table that
-- deliberately outlives the child's record.
--
-- Per-kind CHECK constraints are the second reason and the RLS is the third: a
-- guardian must read their own child's incident report, which is not true of a
-- sleep check, and policies are per table.
--
-- WHY AN AMENDMENT SUPERSEDES RATHER THAN EDITS
--
-- `attendance_events` corrects a scalar by appending a new row; `custody_
-- arrangements` supersedes. An incident report is a paragraph written in a hurry and
-- finalised, so the attendance idiom does not fit and the custody one does. Once
-- final it freezes, and an amendment is a new row pointing at what it replaces.
-- Editing a report after a family has been shown it is not a correction, it is a
-- different document wearing the same name — the same argument 0021 makes about an
-- issued invoice.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.incident_kind as enum (
    'injury',
    'illness',
    'behaviour',
    'near_miss',
    'other'
  );
exception when duplicate_object then null; end $$;

comment on type public.incident_kind is
  'near_miss is deliberately present: a gate found open with nobody hurt is the record that prevents the next one, and a register that only holds injuries never captures it.';

do $$ begin
  create type public.incident_status as enum ('draft', 'final');
exception when duplicate_object then null; end $$;

create table if not exists public.incidents (
  id                 uuid primary key default gen_random_uuid(),
  centre_id          uuid not null references public.centres(id)  on delete cascade,
  -- `on delete cascade`, without which `purge_child` leaves an orphan holding the
  -- description of a child's injury. Every child-linked table in this schema
  -- cascades for that reason; the suite asserts the purge takes them all.
  child_id           uuid not null references public.children(id) on delete cascade,

  kind               public.incident_kind not null,
  occurred_at        timestamptz not null,
  location           text,
  description        text not null,

  first_aid_given    text,
  treated_by         uuid references auth.users(id) on delete set null,
  -- Free text, not a user reference: the witness is often a parent collecting
  -- another child, or a visiting relieving teacher with no account.
  witness_name       text,

  reported_by        uuid references auth.users(id) on delete set null,
  status             public.incident_status not null default 'draft',

  -- Two different facts, and a review cares about both: that the centre told the
  -- family, and that the family said they had been told.
  parent_notified_at timestamptz,
  notified_by        uuid references auth.users(id) on delete set null,
  acknowledged_at    timestamptz,
  acknowledged_by    uuid references public.guardians(id) on delete set null,

  supersedes         uuid references public.incidents(id) on delete set null,
  created_at         timestamptz not null default now(),

  constraint incidents_description_present check (length(trim(description)) > 0),
  -- Same tolerance as attendance: a couple of hours of clock skew is real, the
  -- future is not.
  constraint incidents_not_future check (occurred_at <= now() + interval '2 hours'),
  -- A timestamp with nobody attached is not evidence. Same rule as `sighted_by`
  -- on staff_records.
  constraint incidents_ack_complete check ((acknowledged_by is null) = (acknowledged_at is null)),
  constraint incidents_notified_complete check ((notified_by is null) = (parent_notified_at is null)),
  -- Nobody can acknowledge a report that is still being written.
  constraint incidents_ack_requires_final check (acknowledged_at is null or status = 'final'),
  constraint incidents_no_self_supersede check (supersedes is distinct from id)
);

comment on table public.incidents is
  'Injury, illness, behaviour and near-miss records. Draft while being written, frozen once final; an amendment is a new row carrying supersedes. No DELETE grant exists for anybody.';

create index if not exists incidents_child_idx  on public.incidents (child_id, occurred_at desc);
create index if not exists incidents_centre_idx on public.incidents (centre_id, occurred_at desc);
-- Partial: the open-drafts list is the one a manager checks at the end of a shift.
create index if not exists incidents_draft_idx  on public.incidents (centre_id) where status = 'draft';

-- ---------------------------------------------------------------------------
-- The transition rule
--
-- RLS decides *who* may update a row. It cannot say "and only these two columns",
-- which is the whole difficulty here: one table has two audiences with completely
-- different rights over it, and a column-level GRANT is per role, not per policy.
-- So the grant below opens the columns either audience might touch, and this
-- decides which of them the caller was.
--
-- IT DECIDES BY WHAT CHANGED, NOT BY WHO CALLED
--
-- The obvious version branches on `caller_is_staff_for_child`. It is wrong for a
-- real and not-rare person: an educator whose own child attends the same centre.
-- They are staff by that predicate, so the guardian branch would never run for
-- them and they could never acknowledge a report about their own child. Keying on
-- the changed columns instead means the same statement is judged the same way
-- whoever sends it.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_incident_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ack_only boolean;
begin
  v_ack_only := (
        new.kind               is not distinct from old.kind
    and new.occurred_at        is not distinct from old.occurred_at
    and new.location           is not distinct from old.location
    and new.description        is not distinct from old.description
    and new.first_aid_given    is not distinct from old.first_aid_given
    and new.treated_by         is not distinct from old.treated_by
    and new.witness_name       is not distinct from old.witness_name
    and new.reported_by        is not distinct from old.reported_by
    and new.status             is not distinct from old.status
    and new.parent_notified_at is not distinct from old.parent_notified_at
    and new.notified_by        is not distinct from old.notified_by
    and new.supersedes         is not distinct from old.supersedes
    and new.centre_id          is not distinct from old.centre_id
    and new.child_id           is not distinct from old.child_id
    and (   new.acknowledged_at is distinct from old.acknowledged_at
         or new.acknowledged_by is distinct from old.acknowledged_by)
  );

  if v_ack_only then
    if old.status <> 'final' then
      raise exception 'A draft incident cannot be acknowledged; it has not been finalised.'
        using errcode = '23514';
    end if;
    if old.acknowledged_at is not null then
      raise exception 'This incident has already been acknowledged. That record does not change.'
        using errcode = '23514';
    end if;
    if new.acknowledged_by is null or new.acknowledged_at is null then
      raise exception 'An acknowledgement needs both a guardian and a time.'
        using errcode = '23514';
    end if;
    -- Attribution, not decoration. "The family was told" is the claim a review
    -- tests, and it is worthless if anyone can record it against anyone.
    if new.acknowledged_by not in (select public.caller_guardian_ids()) then
      raise exception 'An acknowledgement must be attributed to the guardian making it.'
        using errcode = '42501';
    end if;
    if new.child_id not in (select public.caller_ward_ids()) then
      raise exception 'Only a guardian of this child may acknowledge this incident.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- Everything else is a staff edit.
  if not public.caller_is_staff_for_child(old.child_id) then
    raise exception 'Only staff at this centre may edit an incident report.'
      using errcode = '42501';
  end if;

  if old.status = 'final' then
    raise exception
      'A finalised incident cannot be edited. Record an amendment that supersedes it.'
      using errcode = '23514';
  end if;

  -- Staff finalise, notify, and correct their own drafts. They do not acknowledge
  -- on a family's behalf — that is the one fact in this table the centre is not the
  -- author of.
  if new.acknowledged_at is distinct from old.acknowledged_at
  or new.acknowledged_by is distinct from old.acknowledged_by then
    raise exception 'Staff cannot record a family''s acknowledgement for them.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists incidents_transition on public.incidents;
create trigger incidents_transition
  before update on public.incidents
  for each row execute function public.enforce_incident_transition();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.incidents enable row level security;

/*
 * The assertion this table exists to get right.
 *
 * `caller_may_see_child` is true for staff AND guardians, which is what makes it
 * the wrong predicate here and the easy mistake: using it would show a family a
 * half-written injury report about their child, live, as a teacher typed it. A
 * draft is working material. A parent's copy is the final one.
 */
drop policy if exists incidents_select on public.incidents;
create policy incidents_select on public.incidents
  for select using (
    public.caller_is_staff_for_child(child_id)
    or (status = 'final' and child_id in (select public.caller_ward_ids()))
  );

drop policy if exists incidents_write_insert on public.incidents;
create policy incidents_write_insert on public.incidents
  for insert with check (
    public.caller_is_staff_for_child(child_id)
    -- The row's centre must be the child's centre, or a report about a Mt Albert
    -- child files itself into the Mt Roskill binder. Same shape as `bookings`.
    and centre_id = (select c.centre_id from public.children c where c.id = child_id)
    and (reported_by is null or reported_by = auth.uid())
  );

/*
 * USING reads the old row, WITH CHECK the new one. Staff may open a draft and may
 * finalise it (draft -> final, so the new row's status is not constrained to
 * draft); a guardian may act only on a row that was already final and stays final.
 * The trigger above is what stops either of them doing the other's half.
 */
drop policy if exists incidents_write_update on public.incidents;
create policy incidents_write_update on public.incidents
  for update using (
    (public.caller_is_staff_for_child(child_id) and status = 'draft')
    or (status = 'final' and child_id in (select public.caller_ward_ids()))
  ) with check (
    public.caller_is_staff_for_child(child_id)
    or (status = 'final' and child_id in (select public.caller_ward_ids()))
  );

-- No DELETE policy, and no DELETE grant below. An incident report is licensing
-- evidence: the centre that can make one disappear cannot use the register to
-- prove anything. `purge_child` still reaches these rows, because a cascade runs
-- as the table owner and does not consult grants — the same mechanism that lets a
-- child be purged out of `attendance_events`.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.incidents from anon, authenticated, service_role;

grant select, insert on public.incidents to authenticated, service_role;

/*
 * Column-limited UPDATE, which is doing real work rather than being tidy.
 *
 * `id`, `centre_id`, `child_id`, `reported_by` and `created_at` are absent, so
 * moving a report to a different child is refused by Postgres before any policy or
 * trigger runs — the cheapest possible place to refuse it. The trigger still
 * compares those columns, because a privilege can be widened by a later migration
 * and the trigger is what would notice.
 */
grant update (
  kind, occurred_at, location, description,
  first_aid_given, treated_by, witness_name,
  status, parent_notified_at, notified_by, supersedes,
  acknowledged_at, acknowledged_by
) on public.incidents to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit
--
-- Not optional and not remembered: the suite derives which tables must carry this
-- from the catalogue, so omitting it fails `test:rls` rather than going unnoticed.
-- `incidents` is mutable while draft, so it is not in the append-only exemption.
-- ---------------------------------------------------------------------------

drop trigger if exists incidents_audit on public.incidents;
create trigger incidents_audit
  after insert or update or delete on public.incidents
  for each row execute function public.audit_trigger();
