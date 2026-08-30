-- ---------------------------------------------------------------------------
-- 0078 — the six `_not_ancient` CHECK constraints become BEFORE INSERT triggers
--
-- `npm run drill:restore` went red on 2026-08-30 and stayed red. It extracted 12,929
-- rows from 72 tables and could not load them back:
--
--   ERROR: 23514: new row for relation "staff_count_events"
--   violates check constraint "staff_count_not_ancient"
--   DETAIL: Failing row contains (..., 2026-08-04 05:56:04.698+00, ...)
--
-- Nothing regressed. The constraint reads `at > now() - interval '14 days'`, the fixture
-- rows were written on 2026-08-04, and they aged out of the window. Six tables carry that
-- shape and they are the operational core — the roll, staff on site, medication, sleep,
-- safety checks, staff attendance.
--
-- A CHECK containing `now()` is a documented PostgreSQL footgun for exactly this reason.
-- The manual is explicit that a CHECK must not reference anything but the current row,
-- and a time-relative predicate silently makes the table's own history unloadable — by
-- this drill, by `pg_restore`, or by any recovery at all more than a fortnight after the
-- fact. For a compliance product whose pitch is that it holds the record, a record that
-- cannot be put back is not a record.
--
-- WHY A TRIGGER FIXES IT, WHICH IS NOT THE REASON [[unverified-claims]] ITEM 44 GAVE
--
-- Item 44 said "a CHECK is re-evaluated on every write including a restore; a trigger on
-- INSERT guards new writes". That reasoning is wrong and it is worth correcting here
-- rather than quietly relying on the right answer. A BEFORE INSERT row trigger fires on
-- precisely the operations a CHECK is evaluated on — `INSERT`, `INSERT … SELECT` and
-- `COPY FROM` all fire it. A restore IS a write. Swapping one for the other on that
-- reasoning would have produced the identical failure with a different error code, after
-- six migrations against the most-written tables in the schema.
--
-- What actually makes this work is ORDERING, and it is a property of pg_dump rather than
-- of triggers. A dump is emitted in three sections: pre-data (table definitions, and
-- CHECK constraints live inside them), data (the COPY), and post-data (indexes, FOREIGN
-- KEY constraints and TRIGGERS). So a CHECK is in force while the rows land and a trigger
-- is created afterwards and never sees them. That is why the six FK constraints on these
-- same tables have never broken a restore either, and why this file moves the rule across
-- the pre-data/post-data line rather than weakening it.
--
-- AND WHY THERE IS AN ESCAPE HATCH ANYWAY
--
-- The ordering argument covers `pg_restore`. It does not cover the recovery path this
-- repository actually built: `scripts/restore-drill.ts` extracts to JSON and loads with
-- `INSERT … SELECT jsonb_populate_recordset(...)` into a schema that already exists. Any
-- real recovery driven from that extract would recreate the schema first — triggers and
-- all — and then insert, and the trigger would fire. So the function yields to a session
-- setting:
--
--   set app.restoring = 'on';   -- or PGOPTIONS="-c app.restoring=on"
--
-- This is deliberately NOT a security control and must not be mistaken for one. Anyone
-- who can insert can set it. That is acceptable because the rule it relaxes is a
-- data-quality guard against a typo'd or back-dated timestamp, not a tenant boundary —
-- the boundary is RLS, and RLS is untouched by this file. Stating it plainly because the
-- next reader will otherwise have to work out whether a bypassable guard was an
-- oversight. It was not.
--
-- WHAT THIS DOES NOT CHANGE
--
-- The eleven `_not_future` constraints stay CHECKs and are deliberately untouched. They
-- read `<= now() + interval '2 hours'`, and a row from the past satisfies that at every
-- future moment, so they restore cleanly. Only a lower bound relative to `now()` rots.
--
-- Normal write behaviour is identical: an ancient row is still refused, with the same
-- 14-day window, on every path in the product. `rls_isolation.sql` asserts both halves —
-- that the guard still refuses, and that the escape hatch actually opens — because a
-- trigger that silently did nothing would make `drill:restore` green for the wrong reason
-- and nothing else in the suite would notice.
--
-- A HONEST NOTE ON WHY THE DRILL GOES GREEN
--
-- The drill builds its shadow tables with `create table … (like public.<t> including
-- all)`, and `LIKE` does not copy triggers — INCLUDING ALL covers defaults, constraints,
-- indexes, storage, comments, generated, identity and statistics, and stops there. So
-- after this migration the drill's shadow tables carry no guard at all and the load
-- succeeds trivially. That is a weaker green than the red it replaces, so the drill gains
-- a schema check in the same commit: every one of these six tables must carry the trigger
-- and must NOT carry a `_not_ancient` CHECK. Without it, deleting the guard outright
-- would also turn the drill green.
-- ---------------------------------------------------------------------------

create or replace function public.reject_ancient_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  -- Yield to a restore. See the header: a data-quality guard, not a boundary.
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;

  -- tg_argv[0] is the timestamp column: `at` on five of the six, `given_at` on
  -- medication_administrations. Read through jsonb so one function serves all six
  -- rather than six near-identical bodies drifting apart, which is how the two
  -- hand-maintained token files diverged.
  v_at := (to_jsonb(new) ->> tg_argv[0])::timestamptz;

  -- A null timestamp is not this trigger's business. Every one of these columns is
  -- NOT NULL and the column constraint is the right place to say so; duplicating it
  -- here would mean two error messages for one defect.
  if v_at is not null and v_at <= now() - interval '14 days' then
    raise exception
      'row is older than the 14 day window (% on %.%)', tg_argv[0], tg_table_schema, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- A trigger needs TRIGGER on the table, never EXECUTE on the function, so this costs
-- nothing and keeps the shape 0013, 0072 and 0077 established. This function is not
-- SECURITY DEFINER and so is not what `review:security` looks for — revoked anyway,
-- because "it is only INVOKER today" is an argument that must be re-made after every
-- edit, and a revoke is one that need not be.
revoke execute on function public.reject_ancient_row() from public, anon, authenticated;

comment on function public.reject_ancient_row() is
  'Trigger only. Refuses an INSERT whose timestamp column (tg_argv[0]) is more than 14 days old. Replaces six time-relative CHECK constraints that made the operational core unrestorable — a CHECK is pre-data in a dump and enforced during COPY, a trigger is post-data and is created after the rows land. Yields when app.restoring is ''on''. That is a data-quality guard, not a security control: the tenant boundary is RLS.';

alter table public.attendance_events        drop constraint if exists attendance_not_ancient;
alter table public.staff_count_events       drop constraint if exists staff_count_not_ancient;
alter table public.medication_administrations drop constraint if exists medication_admin_not_ancient;
alter table public.sleep_checks             drop constraint if exists sleep_checks_not_ancient;
alter table public.safety_checks            drop constraint if exists safety_checks_not_ancient;
alter table public.staff_attendance_events  drop constraint if exists staff_attendance_not_ancient;

drop trigger if exists attendance_not_ancient on public.attendance_events;
create trigger attendance_not_ancient
  before insert on public.attendance_events
  for each row execute function public.reject_ancient_row('at');

drop trigger if exists staff_count_not_ancient on public.staff_count_events;
create trigger staff_count_not_ancient
  before insert on public.staff_count_events
  for each row execute function public.reject_ancient_row('at');

drop trigger if exists medication_admin_not_ancient on public.medication_administrations;
create trigger medication_admin_not_ancient
  before insert on public.medication_administrations
  for each row execute function public.reject_ancient_row('given_at');

drop trigger if exists sleep_checks_not_ancient on public.sleep_checks;
create trigger sleep_checks_not_ancient
  before insert on public.sleep_checks
  for each row execute function public.reject_ancient_row('at');

drop trigger if exists safety_checks_not_ancient on public.safety_checks;
create trigger safety_checks_not_ancient
  before insert on public.safety_checks
  for each row execute function public.reject_ancient_row('at');

drop trigger if exists staff_attendance_not_ancient on public.staff_attendance_events;
create trigger staff_attendance_not_ancient
  before insert on public.staff_attendance_events
  for each row execute function public.reject_ancient_row('at');

-- The trigger keeps the constraint's name on purpose. An operator reading a failure sees
-- the same identifier the product has raised since 0009, and `pg_trigger` is where it now
-- lives rather than `pg_constraint`.

do $$
declare
  v_missing text;
  v_stale   text;
begin
  select string_agg(t.tbl, ', ' order by t.tbl) into v_missing
    from (values
      ('attendance_events'), ('staff_count_events'), ('medication_administrations'),
      ('sleep_checks'), ('safety_checks'), ('staff_attendance_events')
    ) as t(tbl)
   where not exists (
     select 1 from pg_trigger g
       join pg_class c on c.oid = g.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.tbl
        and g.tgname like '%_not_ancient' and not g.tgisinternal
   );
  if v_missing is not null then
    raise exception '0078: no _not_ancient trigger on %', v_missing;
  end if;

  select string_agg(conname, ', ' order by conname) into v_stale
    from pg_constraint
   where contype = 'c' and conname like '%_not_ancient';
  if v_stale is not null then
    raise exception '0078: a _not_ancient CHECK survives and will break the next restore: %', v_stale;
  end if;
end $$;
