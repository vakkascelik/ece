-- ---------------------------------------------------------------------------
-- 0068 — checklists
--
-- The reason Little Pearls opens 1Place. Twelve templates' worth of the walk round
-- the playground before the gate opens, the kitchen check, the monthly audit — and
-- this schema had nothing for it. `safety_checks` (0034) is a fixed eight-value enum
-- with one boolean, which is a register of *whether* an area was looked at, not a
-- form somebody filled in.
--
-- THE ONE THING THAT MAKES THIS HARD: A RUN POINTS AT A VERSION, NEVER AT A TEMPLATE
--
-- A completed checklist has to render as the form that was actually in front of the
-- person who signed it. Point a run at its template and the first wording change
-- rewrites last year's evidence — every past run silently acquires a question nobody
-- was asked, and the binder becomes a document that says what the centre believes
-- today rather than what it did then.
--
-- 1Place's own offline store is keyed `++localId, versionId, checklistId, …`. They
-- hit this and solved it the same way, which is the closest thing to a second opinion
-- available here.
--
-- WHAT IS DELIBERATELY NOT IN THIS MIGRATION
--
-- 1. **Photos.** 1Place attaches them and this does not, yet. The reason is
--    `0015_consent_gate_restrictive`: `media` is gated on consent because a photo may
--    contain a child. A photo of a broken latch is not child media; a photo of a
--    broken latch with a toddler in the background is, and neither the person taking
--    it nor a column default can tell the difference. Routing checklist photos into
--    `media` would open a path into the gated table from a staff-only screen, and
--    doing that carelessly in the same migration that introduces five tables is how
--    a disclosure happens. It gets its own migration and its own thinking. Recorded
--    in llm-wiki/wiki/checklists.md.
--
-- 2. **A scheduler.** No cron, no pre-created rows. `recur_days` on the template plus
--    the date of the last completed run is enough to answer "what is due today", and
--    it is the shape `drill_interval_days` already uses in 0034: null means the centre
--    has not stated an interval, and the product then shows elapsed time without
--    calling anything late. Materialising future runs would put rows in the database
--    for work nobody has done, which every screen would then have to filter out.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.checklist_response as enum (
    'yes_no',
    'yes_no_na',
    'text',
    'number'
  );
exception when duplicate_object then null; end $$;

comment on type public.checklist_response is
  'How one item is answered. `yes_no_na` exists separately because "not applicable" and "no" are different findings — a sandpit check on the day the sandpit is being replaced is not a failure.';

-- ---------------------------------------------------------------------------
-- Templates — the identity of a form, not its contents
-- ---------------------------------------------------------------------------

create table if not exists public.checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,

  name        text not null,
  /** 1Place groups templates in folders and twelve of them needs it. Free text. */
  folder      text,

  /**
   * How often this is meant to be done, in days, as stated by the centre.
   *
   * Null means nobody has said, and the product then shows how long it has been
   * without calling it overdue — the fourth outing of the `drill_interval_days`
   * argument. A default here would read to a centre as the rule, and if the real
   * rule is stricter the product has talked them into a breach behind a green tick.
   *
   * There is no scheduler. "Due" is computed from this and the last completed run.
   */
  recur_days  smallint,

  archived_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint checklist_templates_name_present check (length(trim(name)) > 0),
  constraint checklist_templates_recur_sane check (recur_days is null or recur_days between 1 and 730)
);

comment on table public.checklist_templates is
  'A form the centre uses — "Daily playground check". Holds no questions: those belong to a version. Archived, never deleted.';

create index if not exists checklist_templates_centre_idx
  on public.checklist_templates (centre_id, folder, name)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- Versions — the contents, frozen at publication
-- ---------------------------------------------------------------------------

create table if not exists public.checklist_template_versions (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.checklist_templates(id) on delete cascade,

  version      smallint not null,
  /**
   * Null while being edited, set once and never again.
   *
   * Publication is the moment the version stops being editable — enforced by the
   * UPDATE policies below, which refuse any row whose `published_at` is already set.
   * Before that a manager can move items around freely; after it the only way to
   * change the form is a new version, which leaves every completed run pointing at
   * what it actually asked.
   */
  published_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint checklist_versions_publish_complete check (
    (published_at is null) = (published_by is null)
  ),
  constraint checklist_versions_unique unique (template_id, version)
);

comment on table public.checklist_template_versions is
  'One published state of a form. Runs reference a version, never a template, so a wording change cannot rewrite completed evidence.';

create index if not exists checklist_versions_template_idx
  on public.checklist_template_versions (template_id, version desc);

-- ---------------------------------------------------------------------------
-- Items — the questions
-- ---------------------------------------------------------------------------

create table if not exists public.checklist_items (
  id            uuid primary key default gen_random_uuid(),
  version_id    uuid not null references public.checklist_template_versions(id) on delete cascade,

  sort          smallint not null default 0,
  prompt        text not null,
  response_type public.checklist_response not null default 'yes_no',
  /**
   * Whether a run can be completed without answering this.
   *
   * The completion trigger below enforces it. Without that, "complete" means "the
   * person pressed the button", and a signed form with blank required lines is the
   * confidently-wrong artefact this whole product is written to avoid.
   */
  required      boolean not null default true,
  /** Shown under the prompt. Where "check the latch AND the hinge" lives. */
  guidance      text,

  created_at    timestamptz not null default now(),

  constraint checklist_items_prompt_present check (length(trim(prompt)) > 0)
);

create index if not exists checklist_items_version_idx
  on public.checklist_items (version_id, sort, created_at);

-- ---------------------------------------------------------------------------
-- Runs — one filling-in of one version
-- ---------------------------------------------------------------------------

create table if not exists public.checklist_runs (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.checklist_template_versions(id) on delete restrict,
  /**
   * Denormalised from version → template → centre, and it has to be.
   *
   * Every policy in this schema is keyed on a centre id the row itself carries;
   * reaching two joins up inside a policy would run that join for every row scanned
   * and would make the boundary depend on two other tables' policies. The trigger
   * below refuses any run whose centre disagrees with its template's, so the
   * duplication cannot drift — which is the only thing that makes denormalising a
   * tenant key acceptable.
   */
  centre_id    uuid not null references public.centres(id) on delete cascade,
  room_id      uuid references public.rooms(id) on delete set null,

  /** In the centre's calendar. No `default current_date` — AGENTS.md §4.3. */
  due_on       date,
  assigned_to  uuid references auth.users(id) on delete set null,

  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  /**
   * Who signed it off. Paired with `completed_at` by the CHECK below.
   *
   * A completed form with nobody attached is the same empty claim as a sighting with
   * no sighter — the argument `staff_records.sighted_by` and `incidents` both make.
   */
  signed_by    uuid references auth.users(id) on delete set null,
  note         text,

  /** Same idempotency contract as attendance. This is the offline path. */
  client_uuid  uuid not null unique,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint checklist_runs_sign_complete check ((completed_at is null) = (signed_by is null)),
  constraint checklist_runs_not_future check (started_at <= now() + interval '2 hours'),
  constraint checklist_runs_completed_after_start check (
    completed_at is null or completed_at >= started_at
  )
);

comment on table public.checklist_runs is
  'One filling-in of one template version. Frozen once completed_at is set: the UPDATE policy refuses a completed run, and there is no DELETE grant. An amendment is a new run.';

create index if not exists checklist_runs_centre_idx
  on public.checklist_runs (centre_id, started_at desc);
create index if not exists checklist_runs_open_idx
  on public.checklist_runs (centre_id, due_on nulls last)
  where completed_at is null;
create index if not exists checklist_runs_version_idx
  on public.checklist_runs (version_id, completed_at desc);

-- ---------------------------------------------------------------------------
-- Answers
-- ---------------------------------------------------------------------------

create table if not exists public.checklist_answers (
  id      uuid primary key default gen_random_uuid(),
  run_id  uuid not null references public.checklist_runs(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete restrict,

  /**
   * Stored as text for every response type.
   *
   * A column per type, or a jsonb blob, both looked better on paper. Text loses
   * nothing this product reads back — nothing aggregates a checklist number — and it
   * keeps the CHECK below expressible, which a jsonb value would not. The shape of a
   * value for each type is validated in `@ece/core` and by the form; what the
   * database enforces is the one rule that matters, immediately below.
   */
  value   text not null,
  note    text,

  created_at timestamptz not null default now(),

  constraint checklist_answers_one_per_item unique (run_id, item_id),

  /**
   * A "no" must say what was wrong.
   *
   * The direct descendant of `safety_checks_failure_has_note`, which 0034 called the
   * single most useful constraint in that file, and it is more useful here. Without
   * it a run reads "gate latch: no" and the next person learns nothing — and the
   * whole value of a checklist is that somebody later can act on what was found.
   * "na" is exempt: not applicable is not a finding.
   */
  constraint checklist_answers_no_needs_note check (
    value <> 'no' or length(trim(coalesce(note, ''))) >= 3
  )
);

create index if not exists checklist_answers_run_idx on public.checklist_answers (run_id);

-- ---------------------------------------------------------------------------
-- The two rules a policy cannot express
-- ---------------------------------------------------------------------------

create or replace function public.checklist_run_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_centre uuid;
  v_published       timestamptz;
  v_missing         integer;
begin
  select t.centre_id, v.published_at
    into v_template_centre, v_published
    from public.checklist_template_versions v
    join public.checklist_templates t on t.id = v.template_id
   where v.id = new.version_id;

  if v_template_centre is null then
    raise exception 'checklist run references a version that does not exist';
  end if;

  -- The denormalised tenant key cannot be allowed to disagree with the real one.
  -- Without this, a run could claim centre A while rendering centre B's questions,
  -- and the policies — which read `centre_id` — would happily serve it.
  if v_template_centre <> new.centre_id then
    raise exception 'checklist run centre_id does not match its template''s centre';
  end if;

  -- A draft version is a form somebody is still writing. Filling one in produces
  -- evidence against questions that were never agreed.
  if v_published is null then
    raise exception 'checklist run references an unpublished template version';
  end if;

  /*
    Completion means every required item has an answer.

    This is the trigger's reason for existing. "Complete" has to mean the form was
    filled in, not that somebody pressed the button — a signed checklist with blank
    required lines is precisely the confidently-wrong artefact that makes a manager
    stop counting.

    Checked only on the transition into completed, so an already-completed run being
    read or re-saved does not re-run the count.
  */
  if new.completed_at is not null and (tg_op = 'INSERT' or old.completed_at is null) then
    select count(*)
      into v_missing
      from public.checklist_items i
     where i.version_id = new.version_id
       and i.required
       and not exists (
         select 1 from public.checklist_answers a
          where a.run_id = new.id and a.item_id = i.id
       );

    if v_missing > 0 then
      raise exception 'cannot complete: % required item(s) have no answer', v_missing;
    end if;
  end if;

  return new;
end;
$$;

comment on function public.checklist_run_guard() is
  'Three refusals a CHECK cannot express: the denormalised centre must match the template''s, the version must be published, and completing requires an answer to every required item.';

drop trigger if exists checklist_runs_guard on public.checklist_runs;
create trigger checklist_runs_guard
  before insert or update on public.checklist_runs
  for each row execute function public.checklist_run_guard();

-- ---------------------------------------------------------------------------
-- Policies
--
-- Staff at the centre for everything. A checklist is the centre's account of its own
-- practice; `caller_staff_centre_ids()` excludes the parent role by construction, and
-- that is the whole boundary for this phase.
--
-- What the policies add beyond that is *time*: a published version stops being
-- editable, and a completed run stops being editable. Both are expressed in the
-- USING clause rather than by revoking UPDATE, because the row has to stay updatable
-- right up until the moment it does not.
-- ---------------------------------------------------------------------------

alter table public.checklist_templates         enable row level security;
alter table public.checklist_template_versions enable row level security;
alter table public.checklist_items             enable row level security;
alter table public.checklist_runs              enable row level security;
alter table public.checklist_answers           enable row level security;

-- Templates -----------------------------------------------------------------

drop policy if exists checklist_templates_select on public.checklist_templates;
create policy checklist_templates_select on public.checklist_templates
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists checklist_templates_insert on public.checklist_templates;
create policy checklist_templates_insert on public.checklist_templates
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists checklist_templates_update on public.checklist_templates;
create policy checklist_templates_update on public.checklist_templates
  for update using (
            public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
          )
          with check (
            public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
          );

-- Versions ------------------------------------------------------------------

drop policy if exists checklist_versions_select on public.checklist_template_versions;
create policy checklist_versions_select on public.checklist_template_versions
  for select using (
    exists (
      select 1 from public.checklist_templates t
       where t.id = template_id
         and t.centre_id in (select public.caller_staff_centre_ids())
    )
  );

drop policy if exists checklist_versions_insert on public.checklist_template_versions;
create policy checklist_versions_insert on public.checklist_template_versions
  for insert with check (
    exists (
      select 1 from public.checklist_templates t
       where t.id = template_id
         and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
    )
  );

/*
  A published version is immutable, and this is the clause that makes it so.

  `using (published_at is null)` means the row disappears from the update's view the
  instant it is published — the update matches nothing and PostgREST reports zero rows
  rather than an error, which every writer in `@ece/api` already treats as a refusal.

  The `with check` half repeats the centre test and does NOT repeat `published_at is
  null`, because the one legal update to a draft is the one that publishes it.
*/
drop policy if exists checklist_versions_update on public.checklist_template_versions;
create policy checklist_versions_update on public.checklist_template_versions
  for update using (
            published_at is null
            and exists (
              select 1 from public.checklist_templates t
               where t.id = template_id
                 and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
            )
          )
          with check (
            exists (
              select 1 from public.checklist_templates t
               where t.id = template_id
                 and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
            )
          );

-- Items ---------------------------------------------------------------------

drop policy if exists checklist_items_select on public.checklist_items;
create policy checklist_items_select on public.checklist_items
  for select using (
    exists (
      select 1
        from public.checklist_template_versions v
        join public.checklist_templates t on t.id = v.template_id
       where v.id = version_id
         and t.centre_id in (select public.caller_staff_centre_ids())
    )
  );

/*
  Items may only be written while their version is a draft. Same reasoning as the
  version's own update policy, and it is on INSERT as well as UPDATE — adding a
  question to a published form retroactively makes every completed run against it
  incomplete.
*/
drop policy if exists checklist_items_insert on public.checklist_items;
create policy checklist_items_insert on public.checklist_items
  for insert with check (
    exists (
      select 1
        from public.checklist_template_versions v
        join public.checklist_templates t on t.id = v.template_id
       where v.id = version_id
         and v.published_at is null
         and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
    )
  );

drop policy if exists checklist_items_update on public.checklist_items;
create policy checklist_items_update on public.checklist_items
  for update using (
            exists (
              select 1
                from public.checklist_template_versions v
                join public.checklist_templates t on t.id = v.template_id
               where v.id = version_id
                 and v.published_at is null
                 and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
            )
          )
          with check (
            exists (
              select 1
                from public.checklist_template_versions v
                join public.checklist_templates t on t.id = v.template_id
               where v.id = version_id
                 and v.published_at is null
                 and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
            )
          );

/*
  Deleting an item from a DRAFT version is allowed and needs to be — building a form
  means removing a line you just typed. It is impossible on a published one because
  the USING clause tests `published_at is null`, and impossible in practice once any
  run exists because `checklist_answers.item_id` is `on delete restrict`.
*/
drop policy if exists checklist_items_delete on public.checklist_items;
create policy checklist_items_delete on public.checklist_items
  for delete using (
    exists (
      select 1
        from public.checklist_template_versions v
        join public.checklist_templates t on t.id = v.template_id
       where v.id = version_id
         and v.published_at is null
         and public.caller_has_role(t.centre_id, array['owner', 'manager']::public.member_role[])
    )
  );

-- Runs ----------------------------------------------------------------------

drop policy if exists checklist_runs_select on public.checklist_runs;
create policy checklist_runs_select on public.checklist_runs
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists checklist_runs_insert on public.checklist_runs;
create policy checklist_runs_insert on public.checklist_runs
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (created_by is null or created_by = auth.uid())
  );

/*
  A completed run is frozen. Same mechanism as a published version, and the same
  reason as `incidents`: an amendment is a new record carrying the correction, never
  an edit to the one that was signed.

  Educators, not just managers — the person walking the playground is the person
  filling this in.
*/
drop policy if exists checklist_runs_update on public.checklist_runs;
create policy checklist_runs_update on public.checklist_runs
  for update using (
            completed_at is null
            and centre_id in (select public.caller_staff_centre_ids())
          )
          with check (centre_id in (select public.caller_staff_centre_ids()));

-- Answers -------------------------------------------------------------------

drop policy if exists checklist_answers_select on public.checklist_answers;
create policy checklist_answers_select on public.checklist_answers
  for select using (
    exists (
      select 1 from public.checklist_runs r
       where r.id = run_id
         and r.centre_id in (select public.caller_staff_centre_ids())
    )
  );

drop policy if exists checklist_answers_insert on public.checklist_answers;
create policy checklist_answers_insert on public.checklist_answers
  for insert with check (
    exists (
      select 1 from public.checklist_runs r
       where r.id = run_id
         and r.completed_at is null
         and r.centre_id in (select public.caller_staff_centre_ids())
    )
  );

drop policy if exists checklist_answers_update on public.checklist_answers;
create policy checklist_answers_update on public.checklist_answers
  for update using (
            exists (
              select 1 from public.checklist_runs r
               where r.id = run_id
                 and r.completed_at is null
                 and r.centre_id in (select public.caller_staff_centre_ids())
            )
          )
          with check (
            exists (
              select 1 from public.checklist_runs r
               where r.id = run_id
                 and r.completed_at is null
                 and r.centre_id in (select public.caller_staff_centre_ids())
            )
          );

-- No DELETE on runs or answers, by anybody. A run that was started and abandoned is
-- itself a fact about the day.

-- ---------------------------------------------------------------------------
-- Privileges
--
-- RLS is the second check; the grant is the first. Note `checklist_items` is the only
-- table here with a DELETE grant, and its policy narrows that to draft versions.
-- ---------------------------------------------------------------------------

revoke all on public.checklist_templates         from anon, authenticated, service_role;
revoke all on public.checklist_template_versions from anon, authenticated, service_role;
revoke all on public.checklist_items             from anon, authenticated, service_role;
revoke all on public.checklist_runs              from anon, authenticated, service_role;
revoke all on public.checklist_answers           from anon, authenticated, service_role;

grant select, insert, update         on public.checklist_templates         to authenticated, service_role;
grant select, insert, update         on public.checklist_template_versions to authenticated, service_role;
grant select, insert, update, delete on public.checklist_items             to authenticated, service_role;
grant select, insert, update         on public.checklist_runs              to authenticated, service_role;
grant select, insert, update         on public.checklist_answers           to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Audit
--
-- Templates, versions and items carry the trigger because they are configuration and
-- a changed form is exactly the thing somebody will later want explained. Runs and
-- answers carry it too: they are frozen on completion rather than append-only from
-- the first byte, so the window in which they can change is real and worth recording.
-- ---------------------------------------------------------------------------

drop trigger if exists checklist_templates_audit on public.checklist_templates;
create trigger checklist_templates_audit
  after insert or update or delete on public.checklist_templates
  for each row execute function public.audit_trigger();

drop trigger if exists checklist_versions_audit on public.checklist_template_versions;
create trigger checklist_versions_audit
  after insert or update or delete on public.checklist_template_versions
  for each row execute function public.audit_trigger();

drop trigger if exists checklist_items_audit on public.checklist_items;
create trigger checklist_items_audit
  after insert or update or delete on public.checklist_items
  for each row execute function public.audit_trigger();

drop trigger if exists checklist_runs_audit on public.checklist_runs;
create trigger checklist_runs_audit
  after insert or update or delete on public.checklist_runs
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- Three more ways for the audit trigger to reach a centre
--
-- `audit_trigger()` resolves the tenant from centre_id, then child_id, invoice_id,
-- guardian_id, staff_member_id, post_id, and gives up. Two of this migration's tables
-- carry none of those — `checklist_template_versions` hangs off a template,
-- `checklist_items` off a version, `checklist_answers` off a run.
--
-- Attaching a trigger anyway is exactly the defect 0059 was written to fix: the
-- function falls through to `if v_centre is null then return`, writes nothing, and
-- both audit-coverage guards go on reporting complete coverage because they check
-- that a trigger EXISTS. `shifts` and `staff_leave` were silently unaudited from 0041
-- until 0059 for precisely this reason, and the roster feeds a compliance figure.
--
-- So the branches are added in the same migration as the tables, and the catalogue
-- assertion in `rls_isolation.sql` — which lists the resolvable column names by hand —
-- is extended in the same commit. Without that second half this passes and means
-- nothing.
-- ---------------------------------------------------------------------------

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_old     jsonb;
  v_centre  uuid;
  v_changed text[];
  v_detail  jsonb := '{}'::jsonb;
begin
  v_row := to_jsonb(coalesce(new, old));

  -- Which tenant does this row belong to? It carries centre_id, or it hangs off a child
  -- that does, or off an invoice that does, or off a guardian, staff member or post that does.
  if v_row ? 'centre_id' then
    v_centre := (v_row ->> 'centre_id')::uuid;
  elsif v_row ? 'child_id' and (v_row ->> 'child_id') is not null then
    select c.centre_id into v_centre from public.children c
     where c.id = (v_row ->> 'child_id')::uuid;
  elsif v_row ? 'invoice_id' then
    select i.centre_id into v_centre from public.invoices i
     where i.id = (v_row ->> 'invoice_id')::uuid;
  -- Added in 0044 for `guardian_pins`, the first table to hang off a guardian and
  -- nothing else. Unreachable for `child_guardians` and `invoices`, which match above.
  elsif v_row ? 'guardian_id' and (v_row ->> 'guardian_id') is not null then
    select g.centre_id into v_centre from public.guardians g
     where g.id = (v_row ->> 'guardian_id')::uuid;
  -- 0059: `shifts` and `staff_leave`, which hang off a staff member and nothing else.
  elsif v_row ? 'staff_member_id' and (v_row ->> 'staff_member_id') is not null then
    select s.centre_id into v_centre from public.staff_members s
     where s.id = (v_row ->> 'staff_member_id')::uuid;
  -- 0059: `post_strands`, which hangs off a post. Keyed (post_id, strand_id) with no `id`,
  -- so `entity_id` falls back below the same way `guardian_pins` does.
  elsif v_row ? 'post_id' and (v_row ->> 'post_id') is not null then
    select p.centre_id into v_centre from public.posts p
     where p.id = (v_row ->> 'post_id')::uuid;
  -- 0068: `checklist_template_versions`.
  elsif v_row ? 'template_id' and (v_row ->> 'template_id') is not null then
    select t.centre_id into v_centre from public.checklist_templates t
     where t.id = (v_row ->> 'template_id')::uuid;
  -- 0068: `checklist_items`, two joins up.
  elsif v_row ? 'version_id' and (v_row ->> 'version_id') is not null then
    select t.centre_id into v_centre
      from public.checklist_template_versions v
      join public.checklist_templates t on t.id = v.template_id
     where v.id = (v_row ->> 'version_id')::uuid;
  -- 0068: `checklist_answers`. The run carries the centre directly.
  elsif v_row ? 'run_id' and (v_row ->> 'run_id') is not null then
    select r.centre_id into v_centre from public.checklist_runs r
     where r.id = (v_row ->> 'run_id')::uuid;
  elsif tg_table_name = 'centres' then
    v_centre := (v_row ->> 'id')::uuid;
  end if;

  -- `child_id` present but null on a table that also has no centre_id: fall through to
  -- invoice_id rather than giving up, which is the invoice_lines case.
  if v_centre is null and v_row ? 'invoice_id' then
    select i.centre_id into v_centre from public.invoices i
     where i.id = (v_row ->> 'invoice_id')::uuid;
  end if;

  -- A row that cannot be attributed to a centre is not auditable, and audit_events
  -- requires centre_id. Better to let the operation stand than to fail it. The assertion at
  -- the foot of 0059 is what stops that mercy from hiding a missing branch.
  if v_centre is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_row)
     where v_row -> key is distinct from v_old -> key;
    if v_changed is not null then
      v_detail := jsonb_build_object('columns', to_jsonb(v_changed));
    end if;
  end if;

  insert into public.audit_events (centre_id, actor, action, entity, entity_id, detail)
  values (
    v_centre,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid else null end,
    v_detail
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists checklist_answers_audit on public.checklist_answers;
create trigger checklist_answers_audit
  after insert or update or delete on public.checklist_answers
  for each row execute function public.audit_trigger();
