-- ---------------------------------------------------------------------------
-- 0034 — the registers that belong to the building rather than to a child
--
-- Drills, hazards, and the routine safety checks a centre does before the doors
-- open. Three tables in one migration because they share a boundary exactly: all
-- centre-scoped, all staff-only, none of them touching guardianship. That is the
-- whole reason this phase is simpler than the last one — `caller_may_see_child`
-- does not appear anywhere in it, and neither does the trap where a family reads a
-- record about their own child that was not ready.
--
-- WHAT IS DELIBERATELY NOT HERE: HOW OFTEN
--
-- No drill frequency. The figure commonly quoted is every three months and it is not
-- sourced in this repo, which ships `criteria` empty for exactly that reason. So
-- `centres.drill_interval_days` is nullable, null means the centre has not stated
-- one, and the product shows how long it has been without calling it late. This is
-- the fourth outing of the `RATIO_TABLES_VERIFIED` argument and the second of the
-- sleep-check shape: a default would read to a centre as the rule, and if the rule is
-- stricter the product has talked them into a breach behind a green screen.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.drill_kind as enum (
    'fire',
    'earthquake',
    'lockdown',
    'tsunami',
    'other'
  );
exception when duplicate_object then null; end $$;

comment on type public.drill_kind is
  'Tsunami is separate from earthquake on purpose: coastal services practise a different response — move uphill rather than shelter in place — and a register that conflates them cannot show which was rehearsed.';

create table if not exists public.drills (
  id               uuid primary key default gen_random_uuid(),
  centre_id        uuid not null references public.centres(id) on delete cascade,

  kind             public.drill_kind not null,
  held_at          timestamptz not null,
  duration_seconds integer,

  -- Counts, not links. A drill's value as evidence is that this many people got out
  -- in this long, and tying it to the roll would make a record about the building
  -- depend on a child's record that may later be purged.
  adults_present   smallint,
  children_present smallint,

  notes            text,
  /**
   * What went wrong, and it is the column that matters.
   *
   * A register of drills that all went perfectly is a register nobody learned from.
   * The point of practising is to find the gate that sticks, and a schema with
   * nowhere to write that produces a folder of green ticks.
   */
  issues_found     text,

  recorded_by      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint drills_not_future check (held_at <= now() + interval '2 hours'),
  constraint drills_duration_sane check (duration_seconds is null or duration_seconds between 1 and 86400),
  constraint drills_counts_sane check (
    (adults_present is null or adults_present between 0 and 200)
    and (children_present is null or children_present between 0 and 500)
  )
);

comment on table public.drills is
  'Emergency drills held. No required frequency is stored or implied — see centres.drill_interval_days, which is null until a centre states one.';

create index if not exists drills_centre_idx on public.drills (centre_id, held_at desc);

alter table public.centres
  add column if not exists drill_interval_days smallint;

comment on column public.centres.drill_interval_days is
  'Days between emergency drills, as stated by the centre. NULL means not configured, and the product then shows elapsed time without judging it. Not a regulatory figure.';

alter table public.centres drop constraint if exists centres_drill_interval_sane;
alter table public.centres
  add constraint centres_drill_interval_sane
  check (drill_interval_days is null or drill_interval_days between 1 and 730);

grant update (drill_interval_days) on public.centres to authenticated;

-- ---------------------------------------------------------------------------
-- Hazards
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.hazard_risk as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

create table if not exists public.hazards (
  id            uuid primary key default gen_random_uuid(),
  centre_id     uuid not null references public.centres(id) on delete cascade,

  description   text not null,
  area          text,
  risk          public.hazard_risk not null,
  /**
   * What is being done about it, separately from what it is.
   *
   * A hazard register with no control column is a list of things somebody noticed.
   * The question a review asks is not "did you see it" but "what did you do", and
   * the two have to be answerable apart — a hazard can be recorded at 9am and
   * controlled at 11.
   */
  control       text,

  identified_at timestamptz not null default now(),
  identified_by uuid references auth.users(id) on delete set null,
  reviewed_at   timestamptz,
  resolved_at   timestamptz,
  resolution    text,

  created_at    timestamptz not null default now(),

  constraint hazards_description_present check (length(trim(description)) > 0),
  -- Resolved means somebody can say how. A date with no account of what changed is
  -- the same empty claim as a sighting with nobody attached.
  constraint hazards_resolution_complete check (
    (resolved_at is null) = (resolution is null or length(trim(resolution)) = 0)
  ),
  constraint hazards_resolved_after_identified check (resolved_at is null or resolved_at >= identified_at)
);

comment on table public.hazards is
  'The hazard register. `control` is what is done about a hazard that is still live; `resolution` is how a closed one was closed, and closing requires one.';

create index if not exists hazards_centre_open_idx on public.hazards (centre_id, risk) where resolved_at is null;
create index if not exists hazards_centre_idx on public.hazards (centre_id, identified_at desc);

-- ---------------------------------------------------------------------------
-- Routine safety checks
--
-- Append-only, and the most frequent write in this migration: the walk round the
-- playground before the gate opens. Same idempotency contract as attendance and the
-- other registers, because this is done on a phone in the rain.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.safety_area as enum (
    'playground',
    'sandpit',
    'gates_and_fences',
    'indoor',
    'water',
    'chemicals',
    'first_aid_kit',
    'other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.safety_checks (
  id          bigserial primary key,
  centre_id   uuid not null references public.centres(id) on delete cascade,

  area        public.safety_area not null,
  at          timestamptz not null,
  passed      boolean not null,
  note        text,

  checked_by  uuid references auth.users(id) on delete set null,
  client_uuid uuid not null unique,
  created_at  timestamptz not null default now(),

  constraint safety_checks_not_future check (at <= now() + interval '2 hours'),
  constraint safety_checks_not_ancient check (at > now() - interval '14 days'),
  /**
   * A failed check must say what was wrong.
   *
   * The single most useful constraint in this file. Without it "playground: fail" is
   * a row that tells the next person nothing, and the whole value of the register is
   * that somebody later can act on what was found.
   */
  constraint safety_checks_failure_has_note check (passed or length(coalesce(note, '')) >= 3)
);

comment on table public.safety_checks is
  'Routine pre-opening and periodic checks. Append-only. A failed check must carry a note saying what was wrong.';

create index if not exists safety_checks_centre_idx on public.safety_checks (centre_id, at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Identical for all three and simple for once: staff at the centre, nobody else.
-- `caller_staff_centre_ids()` excludes `parent` by construction, which is what makes
-- this phase's boundary a one-liner where Phase 8's took a trigger.
-- ---------------------------------------------------------------------------

alter table public.drills        enable row level security;
alter table public.hazards       enable row level security;
alter table public.safety_checks enable row level security;

drop policy if exists drills_select on public.drills;
create policy drills_select on public.drills
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists drills_write_insert on public.drills;
create policy drills_write_insert on public.drills
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (recorded_by is null or recorded_by = auth.uid())
  );

drop policy if exists drills_write_update on public.drills;
create policy drills_write_update on public.drills
  for update using (centre_id in (select public.caller_staff_centre_ids()))
          with check (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists hazards_select on public.hazards;
create policy hazards_select on public.hazards
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists hazards_write_insert on public.hazards;
create policy hazards_write_insert on public.hazards
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (identified_by is null or identified_by = auth.uid())
  );

drop policy if exists hazards_write_update on public.hazards;
create policy hazards_write_update on public.hazards
  for update using (centre_id in (select public.caller_staff_centre_ids()))
          with check (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists safety_checks_select on public.safety_checks;
create policy safety_checks_select on public.safety_checks
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists safety_checks_write_insert on public.safety_checks;
create policy safety_checks_write_insert on public.safety_checks
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (checked_by is null or checked_by = auth.uid())
  );

-- No DELETE policy on any of the three, and no DELETE grant below. A drill that was
-- held, a hazard that was found and a check that failed are all evidence, and a
-- register somebody can tidy proves nothing. A hazard is closed with `resolved_at`,
-- not removed.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.drills        from anon, authenticated, service_role;
revoke all on public.hazards       from anon, authenticated, service_role;
revoke all on public.safety_checks from anon, authenticated, service_role;

grant select, insert, update on public.drills  to authenticated, service_role;
grant select, insert, update on public.hazards to authenticated, service_role;

-- Append-only, so no UPDATE for anybody including service_role.
grant select, insert on public.safety_checks to authenticated;
grant usage on sequence public.safety_checks_id_seq to authenticated;
grant select on public.safety_checks to service_role;

-- ---------------------------------------------------------------------------
-- Audit
--
-- `drills` and `hazards` are mutable and carry the trigger. `safety_checks` is
-- append-only — the row is its own record — and is carried by name in the exemption
-- lists in `rls_isolation.sql` and `scripts/security-review.ts`.
-- ---------------------------------------------------------------------------

drop trigger if exists drills_audit on public.drills;
create trigger drills_audit
  after insert or update or delete on public.drills
  for each row execute function public.audit_trigger();

drop trigger if exists hazards_audit on public.hazards;
create trigger hazards_audit
  after insert or update or delete on public.hazards
  for each row execute function public.audit_trigger();
