-- ---------------------------------------------------------------------------
-- 0033 — sleep checks
--
-- A centre with sleeping under-2s records that somebody looked at them, at
-- intervals, and what they saw. It is the most repetitive record in the building
-- and the one a review will ask for first if anything ever goes wrong in a cot
-- room. It has been on a clipboard.
--
-- WHAT THIS DELIBERATELY DOES NOT KNOW: HOW OFTEN
--
-- There is no interval in this migration and none in `@ece/core`. The figures
-- commonly quoted are five and ten minutes; neither is sourced in this repo, and
-- "every N minutes" is a claim about the licensing criteria, which ship empty here
-- precisely because nobody has read them (see `criteria`, 0012).
--
-- So `centres.sleep_check_minutes` is nullable and null means **not configured**.
-- The product shows elapsed time since the last check — a fact — and computes
-- "overdue" only once a centre has stated its own interval. It never renders the
-- word compliant. This is the `RATIO_TABLES_VERIFIED` pattern applied a fourth
-- time, and the reason is the same one every time: a manager who is told they are
-- within an interval stops watching the clock.
--
-- WHY THE COLUMN IS `observed_position` AND NOT `position`
--
-- `POSITION` is a SQL function (`position(x in y)`). Postgres allows it as a column
-- name and then parses `select position from …` in a way that surprises people once
-- and costs an afternoon. Not worth the four saved characters.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.sleep_position as enum (
    'back',
    'side',
    'front',
    'awake',
    -- Recorded rather than guessed. A child under a blanket in a dark room is a
    -- real observation, and forcing a choice between four positions that were not
    -- seen would make the register say something the checker did not.
    'not_observed'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.sleep_checks (
  id                 bigserial primary key,
  child_id           uuid not null references public.children(id) on delete cascade,

  at                 timestamptz not null,
  observed_position  public.sleep_position not null,
  breathing_observed boolean not null,

  -- Nullable and `on delete set null`, as everywhere else: a deleted account must
  -- not take the record with it. The insert policy pins it to the caller.
  checked_by         uuid references auth.users(id) on delete set null,

  -- Same contract as attendance and medication: fixed at enqueue, reused on retry.
  -- A cot room is the worst wifi in the building and this is the most frequent
  -- write in the product.
  client_uuid        uuid not null unique,

  corrects           bigint references public.sleep_checks(id) on delete set null,
  note               text,
  created_at         timestamptz not null default now(),

  constraint sleep_checks_not_future check (at <= now() + interval '2 hours'),
  constraint sleep_checks_not_ancient check (at > now() - interval '14 days'),
  constraint sleep_checks_correction_has_note
    check (corrects is null or length(coalesce(note, '')) >= 3)
);

comment on table public.sleep_checks is
  'One observation of one sleeping child. Append-only. No interval is stored or implied here — see centres.sleep_check_minutes, which is null until a centre states one.';

create index if not exists sleep_checks_child_idx on public.sleep_checks (child_id, at desc);

-- ---------------------------------------------------------------------------
-- The interval, which belongs to the centre and to nobody else
-- ---------------------------------------------------------------------------

alter table public.centres
  add column if not exists sleep_check_minutes smallint;

comment on column public.centres.sleep_check_minutes is
  'Minutes between sleep checks, as stated by the centre. NULL means not configured, and the product then shows elapsed time without judging it. Not a regulatory figure — this repo has not read the criteria.';

alter table public.centres
  drop constraint if exists centres_sleep_interval_sane;
alter table public.centres
  add constraint centres_sleep_interval_sane
  check (sleep_check_minutes is null or sleep_check_minutes between 1 and 120);

grant update (sleep_check_minutes) on public.centres to authenticated;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.sleep_checks enable row level security;

-- Staff and the child's own guardians. Nothing to withhold: that a child slept, and
-- that somebody looked at them, is exactly what a parent is entitled to know, and
-- it is the part of the day they most often ask about.
drop policy if exists sleep_checks_select on public.sleep_checks;
create policy sleep_checks_select on public.sleep_checks
  for select using (public.caller_may_see_child(child_id));

drop policy if exists sleep_checks_write_insert on public.sleep_checks;
create policy sleep_checks_write_insert on public.sleep_checks
  for insert with check (
    public.caller_is_staff_for_child(child_id)
    and (checked_by is null or checked_by = auth.uid())
  );

-- No UPDATE and no DELETE policy, and the grants below withhold the verbs too.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.sleep_checks from anon, authenticated, service_role;

grant select, insert on public.sleep_checks to authenticated;
grant usage on sequence public.sleep_checks_id_seq to authenticated;
grant select on public.sleep_checks to service_role;

-- Append-only: the row is the record, so no audit trigger. Carried by name in the
-- exemption lists in `rls_isolation.sql` and `scripts/security-review.ts`.
