-- 0012 — licensing criteria and evidence
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS SHIPS WITH NO CRITERIA IN IT, ON PURPOSE
--
-- The licensing criteria for a centre-based service run to several dozen numbered
-- items across curriculum, premises and facilities, health and safety, and governance.
-- Their exact numbering and wording is a published document, and it was renumbered in
-- 2026. I do not have that document to hand, and inventing plausible criterion numbers
-- and texts would produce the single worst possible outcome for this feature: a centre
-- assembling an evidence binder against a list that looks official and is not.
--
-- So this migration builds the machinery and seeds nothing. `criteria` starts empty,
-- the dashboard says so, and `scripts/import-criteria.ts` loads a real set from a file
-- somebody has checked. The gap is visible instead of papered over.
--
-- This is the same decision as `RATIO_TABLES_VERIFIED` in ratios.ts, taken more
-- strictly because there is no defensible approximation of a criterion number.
-- ─────────────────────────────────────────────────────────────────────────────

-- ---------------------------------------------------------------------------
-- The criteria
-- ---------------------------------------------------------------------------

/**
 * A set is versioned, because the criteria were renumbered and both numbering schemes
 * will be in use for a while.
 *
 * A binder assembled in June against the old numbers has to keep reading correctly
 * after the new set is loaded, so evidence points at a criterion row rather than at a
 * bare code string, and each row records which set it belongs to.
 */
create table if not exists public.criteria_sets (
  id          uuid primary key default gen_random_uuid(),
  -- e.g. "Centre-based, 2026". Free text: the naming is somebody else's.
  name        text not null,
  service_type text not null default 'centre-based',
  /** Where this came from. A set with no source is not usable as evidence. */
  source      text not null,
  effective_from date,
  -- Only one set should be current per service type at a time; enforced by the partial
  -- index below rather than by a boolean nobody maintains.
  is_current  boolean not null default false,
  imported_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint criteria_sets_source_present check (length(trim(source)) > 0)
);

create unique index if not exists criteria_sets_one_current
  on public.criteria_sets (service_type) where is_current;

create table if not exists public.criteria (
  id          uuid primary key default gen_random_uuid(),
  set_id      uuid not null references public.criteria_sets(id) on delete cascade,

  -- The published identifier, e.g. a health-and-safety criterion number.
  code        text not null,
  -- Which grouping it sits in. Free text for the same reason as above.
  category    text not null,
  title       text not null,
  detail      text,

  /**
   * The code this replaced in the previous set.
   *
   * The plan called the old-to-new mapping the actual moat, and it is: a centre with
   * three years of evidence filed against the old numbers needs it to still be findable.
   */
  supersedes_code text,
  sort_order  integer not null default 0,

  constraint criteria_code_present check (length(trim(code)) > 0),
  constraint criteria_unique_in_set unique (set_id, code)
);

comment on table public.criteria is
  'Empty by default. Load a real set with scripts/import-criteria.ts; nothing here is seeded, because a plausible-looking invented criterion is worse than none.';

create index if not exists criteria_set_idx on public.criteria (set_id, category, sort_order);

-- ---------------------------------------------------------------------------
-- Evidence
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.evidence_kind as enum (
    'document',
    'photo',
    'meeting_minutes',
    'ratio_history',
    'staff_record',
    'policy',
    'note'
  );
exception when duplicate_object then null; end $$;

/**
 * A piece of evidence, attached to a criterion.
 *
 * `ratio_history` is a kind of its own because it is the one form of evidence this
 * product generates rather than stores: Phase 2's attendance and adult counts replay
 * into a ratio record, so "we maintained ratios" is answerable from data the centre
 * already produced by using the app. That is the whole argument for building attendance
 * before compliance.
 *
 * No file storage yet. `location` is where the thing actually is — a filing cabinet, a
 * shared drive, or a URL — because a centre's evidence mostly exists already and the
 * useful first step is knowing what covers which criterion. Attaching real files is
 * Phase 4's media pipeline, and it needs consent gating that does not exist yet.
 */
create table if not exists public.evidence (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres(id) on delete cascade,
  criterion_id uuid references public.criteria(id) on delete set null,

  kind         public.evidence_kind not null,
  title        text not null,
  detail       text,
  /** Where it is. Not a file: see the note above. */
  location     text,

  /** The period this evidence covers, for anything time-bounded. */
  covers_from  date,
  covers_to    date,

  -- Who is accountable for it being current, which is a different question from who
  -- filed it.
  owner_name   text,

  added_by     uuid references auth.users(id) on delete set null,
  added_at     timestamptz not null default now(),
  archived_at  timestamptz,

  constraint evidence_title_present check (length(trim(title)) > 0),
  constraint evidence_dates_ordered check (covers_to is null or covers_from is null or covers_to >= covers_from)
);

comment on column public.evidence.criterion_id is
  'Nullable, and on delete set null. Evidence outlives a criteria set being replaced — losing the document because the numbering changed would be the opposite of the point.';

create index if not exists evidence_centre_idx    on public.evidence (centre_id) where archived_at is null;
create index if not exists evidence_criterion_idx on public.evidence (criterion_id) where archived_at is null;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.criteria_sets enable row level security;
alter table public.criteria      enable row level security;
alter table public.evidence      enable row level security;

-- Criteria are published rules, not tenant data: every centre reads the same set, and
-- there is nothing confidential about a licensing criterion. Readable by any signed-in
-- user; writable by nobody through the API.
drop policy if exists criteria_sets_select on public.criteria_sets;
create policy criteria_sets_select on public.criteria_sets for select using (true);

drop policy if exists criteria_select on public.criteria;
create policy criteria_select on public.criteria for select using (true);

-- Evidence is tenant data, and it is management-level: an educator does not assemble
-- the licensing binder, and some of what goes in it (staffing, governance) is not
-- theirs to read.
drop policy if exists evidence_select on public.evidence;
create policy evidence_select on public.evidence
  for select using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists evidence_write on public.evidence;
create policy evidence_write on public.evidence
  for all
  using      (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
    and (added_by is null or added_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.criteria_sets from anon, authenticated, service_role;
revoke all on public.criteria      from anon, authenticated, service_role;
revoke all on public.evidence      from anon, authenticated, service_role;

grant select on public.criteria_sets to authenticated;
grant select on public.criteria      to authenticated;

-- Importing a criteria set is an operator action, like creating a centre. It is a claim
-- about what the law says, and it should go through a reviewed script rather than a form
-- somebody can reach on a Tuesday.
grant all on public.criteria_sets to service_role;
grant all on public.criteria      to service_role;

grant select, insert, update on public.evidence to authenticated, service_role;
-- No DELETE. Evidence is archived, because "what did the binder contain in March" is
-- the question a review asks, and a deleted item cannot answer it.
