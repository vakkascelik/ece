-- RLS isolation test — the most important test in this system.
--
-- Tenant separation is enforced by policy. Until something asserts it, it is a
-- claim. This creates two centres with a member each, then impersonates each
-- member and proves they cannot read OR write the other's rows.
--
-- WHY IT IS WRITTEN LIKE THIS
--
-- No Docker, no pgTAP, no local Postgres. So it is one self-contained script
-- that runs anywhere there is SQL access — the Supabase SQL editor, the
-- Management API, psql — and it ends in ROLLBACK, so it never leaves data
-- behind and is safe to run against a live project.
--
-- HOW IMPERSONATION WORKS
--
-- Supabase policies call auth.uid(), which reads the `sub` claim out of
-- `request.jwt.claims`. Setting that GUC locally is exactly what PostgREST does
-- per request, so `set local role authenticated` plus a claims blob reproduces a
-- real authenticated call without needing a JWT or a network round trip.
--
-- Results are collected into a table AND raised as notices, because the two
-- transports show different things: psql prints notices, the Management API
-- returns rows. A failure raises, which aborts the transaction and loses the
-- table — that is fine, the exception message names the assertion that failed.
--
-- Run:  npm run test:rls

begin;

create temporary table results (
  seq   serial primary key,
  ok    boolean not null,
  label text    not null
) on commit drop;

-- The harness records results while impersonating `authenticated` and `anon`, and
-- this table is owned by postgres — so without these it fails with exactly the
-- error class the suite exists to catch, which is funny once.
--
-- Wide on purpose: this is scaffolding inside a transaction that always rolls
-- back, not product surface. Do not copy the shape of these two lines into a
-- migration.
grant insert on results to authenticated, anon, service_role;
grant usage  on sequence results_seq_seq to authenticated, anon, service_role;

/**
 * A function body with its SQL comments removed.
 *
 * Used by the UTC-date scan below, which reads `prosrc` and would otherwise flag a
 * function for describing the mistake it is avoiding. Both comment forms: `--` to end of
 * line, and block comments, which Postgres regex handles because `.` matches a newline
 * by default.
 */
create or replace function pg_temp.sql_code(src text) returns text language sql immutable as $fn$
  select regexp_replace(
           regexp_replace(src, '--[^' || chr(10) || ']*', '', 'g'),
           '/\*.*?\*/', '', 'g')
$fn$;

/*
 * A timestamp inside whatever part of TODAY has actually elapsed at this centre.
 *
 * ADDED 2026-09-04 because the suite failed at 00:13 New Zealand time and had done so for
 * one hour in every twenty-four since the ratio-source block was written. `now() - interval
 * '1 hour'` at 00:13 is YESTERDAY, and `adults_present_now` filters on
 * `at >= centre_day_start(...)`, so a typed count of 7 seeded an hour ago was correctly
 * excluded and the assertion read 0. The product was right and the test was wrong.
 *
 * This is the same defect `recentlyToday()` in `apps/web/e2e/fixtures/tenant.ts` already
 * exists to avoid, with the same comment on it - 'an hour before 00:07 is yesterday'. The
 * e2e fixture learned it and the SQL suite never did.
 *
 * WHY A FRACTION RATHER THAN A CLAMP. The e2e helper clamps to `now - 60s` and accepts that
 * ordering is lost, which is fine for one event. This block seeds FIVE ordered events across
 * three hours, and at 00:13 there are not three hours of today to place them in - so
 * clamping collapses the order the assertions depend on, and anchoring to `day_start + 3
 * hours` puts them in the future. A fraction of the elapsed day preserves order at any hour,
 * keeps every event inside today, and never produces a future timestamp.
 */
create or replace function pg_temp.today_at(p_centre uuid, p_fraction numeric)
returns timestamptz language sql stable as $$
  select public.centre_day_start(p_centre)
       + (now() - public.centre_day_start(p_centre)) * p_fraction;
$$;

create or replace function pg_temp.expect(condition boolean, label text)
returns void language plpgsql as $$
begin
  insert into results (ok, label) values (coalesce(condition, false), label);
  if condition then
    raise notice 'PASS  %', label;
  else
    raise exception 'FAIL  %', label;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Fixture: two centres, one member each
-- ---------------------------------------------------------------------------

-- Written as the table owner, bypassing RLS, so the fixture itself is not the
-- thing under test.
set local role postgres;

insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', 'alice@rlstest.invalid',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('22222222-2222-4222-8222-222222222222', 'bob@rlstest.invalid',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
on conflict (id) do nothing;

insert into public.centres (id, name, slug) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS Test Centre A', 'rls-test-a'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'RLS Test Centre B', 'rls-test-b');

insert into public.memberships (centre_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner');

-- ---------------------------------------------------------------------------
-- Alice sees exactly her own centre
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.centres where slug like 'rls-test-%') = 1,
  'alice sees exactly one test centre'
);

select pg_temp.expect(
  (select count(*) from public.centres where slug = 'rls-test-b') = 0,
  'alice CANNOT READ centre B'
);

select pg_temp.expect(
  (select count(*) from public.memberships
    where centre_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0,
  'alice CANNOT READ centre B memberships'
);

-- ---------------------------------------------------------------------------
-- The centre_members view and the privileged email lookup behind it.
--
-- The negative assertion alone is not enough here: a view that is broken and
-- returns nothing to anybody satisfies it perfectly. The first run of this suite
-- proved that in the least ambiguous way available — the view threw 42501
-- because security_invoker made the auth.users join run as the caller. So the
-- positive case is asserted too, and on the email specifically, because that
-- column is the only reason the view exists.
-- ---------------------------------------------------------------------------

select pg_temp.expect(
  (select count(*) from public.centre_members
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'centre_members returns alice her own membership'
);

select pg_temp.expect(
  (select member_email from public.centre_members
    where user_id = '11111111-1111-4111-8111-111111111111') = 'alice@rlstest.invalid',
  'centre_members resolves the email (member_email is reachable by a real caller)'
);

-- A Postgres view runs as its OWNER unless declared security_invoker, which
-- would return every membership in the database to any caller. This asserts 0002
-- got that right.
select pg_temp.expect(
  (select count(*) from public.centre_members
    where centre_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0,
  'centre_members view respects RLS (security_invoker is on)'
);

-- member_email is security definer and PostgREST exposes it over RPC, so it is
-- reachable without going through the view. Its own membership check is
-- therefore the access control, not a second line of defence.
select pg_temp.expect(
  public.member_email('22222222-2222-4222-8222-222222222222') is null,
  'member_email REFUSES the email of a user in another centre'
);

select pg_temp.expect(
  public.member_email('11111111-1111-4111-8111-111111111111') = 'alice@rlstest.invalid',
  'member_email returns the email of a user the caller shares a centre with'
);

-- ---------------------------------------------------------------------------
-- Writes. USING controls visibility, WITH CHECK controls insertion — a policy
-- with only USING lets a caller insert into a centre it cannot read, and the
-- row then vanishes from its own view, so the bug is invisible in testing.
-- ---------------------------------------------------------------------------

do $$
declare wrote boolean := false;
begin
  begin
    insert into public.memberships (centre_id, user_id, role)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            '11111111-1111-4111-8111-111111111111', 'owner');
    wrote := true;
  exception when insufficient_privilege or check_violation then
    wrote := false;
  end;
  perform pg_temp.expect(not wrote, 'alice CANNOT WRITE a membership into centre B');
end $$;

-- The one above is refused at the privilege layer, because 0001 grants no INSERT
-- on memberships to anyone (membership creation is a service-role onboarding
-- flow). So it does not exercise WITH CHECK. This does: UPDATE is granted, so the
-- request reaches the policy, and the policy filters the row out — which is zero
-- rows affected rather than an error.
do $$
declare n integer;
begin
  update public.memberships set role = 'parent'
   where centre_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'alice CANNOT UPDATE a membership in centre B');
end $$;

-- Column-level grants, asserted separately from the policies because they are a
-- different mechanism and regress independently — someone writing `grant update
-- on public.memberships` while fixing an unrelated permission error would widen
-- both of these and break no test that checks only rows.
--
-- The sqlstate is put in the label so a failure says which layer gave way:
-- 42501 is the privilege refusal we want; 23514 would mean the column grant is
-- gone and only WITH CHECK is left holding it.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.memberships set centre_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     where user_id = '11111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'alice cannot express moving a membership between centres, got ' || code);
end $$;

do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    -- Her own centre, so the row passes centres_update. Only the column grant
    -- stands between an owner and rewriting the slug that appears in URLs.
    update public.centres set slug = 'rls-test-hijacked'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'an owner cannot rewrite their centre slug, got ' || code);
end $$;

-- And the granted columns must actually work, or the roster and settings screens
-- are broken in a way no negative assertion above would notice.
do $$
declare n integer;
begin
  update public.centres set name = 'Renamed By Owner'
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN rename their own centre');
end $$;

do $$
declare changed integer;
begin
  update public.centres set name = 'hijacked'
   where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  changed := 0;
  select count(*) into changed from public.centres
   where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and name = 'hijacked';
  -- An UPDATE filtered out by RLS affects zero rows rather than raising, so the
  -- assertion has to be "nothing changed", not "an error was thrown".
  perform pg_temp.expect(changed = 0, 'alice CANNOT UPDATE centre B');
end $$;

/*
 * SENDING ANYTHING TO AN EXTERNAL MODEL IS OFF UNTIL SOMEBODY TURNS IT ON (0047).
 *
 * The load-bearing property of the whole column, and the one a future migration could
 * quietly undo by adding a default or a backfill.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CORRECTION, 2026-08-09. THIS WAS A CENSUS AND IS NOW A PROPERTY.
 *
 * It used to read `select count(*) from public.centres where ai_features` — nought across
 * the WHOLE TABLE. That is a different claim from the one the label makes, and it is
 * false in normal operation: the moment any centre legitimately turns the feature on, the
 * assertion fails for a reason that is not a defect.
 *
 * It was caught by an e2e run that enabled the flag on the audit tenant and had not yet
 * put it back. That is the benign version. The malignant version arrives when a real
 * customer switches it on and `test:rls` goes red every run until somebody edits this
 * line — and the pressure at that moment is to delete the check, on a security assertion,
 * to make a suite go green. A check whose normal state is failing is a check that gets
 * removed. See `unverified-claims` on never flipping a flag to silence a warning.
 *
 * So it now asserts the thing the label always meant: a centre created without mentioning
 * the column comes out false, and the catalogue default is false. Both survive a real
 * customer enabling the feature, and both still fail if a migration adds a `default true`
 * or backfills the column — which is the failure this exists to catch.
 */
set local role postgres;

do $$
declare v_id uuid; v_on boolean;
begin
  insert into public.centres (name, slug, timezone)
  values ('AI DEFAULT PROBE', 'ai-default-probe', 'Pacific/Auckland')
  returning id, ai_features into v_id, v_on;

  perform pg_temp.expect(
    v_on = false,
    'a centre created without mentioning ai_features does NOT permit sending data to an external model'
  );

  delete from public.centres where id = v_id;
end $$;

-- And the catalogue agrees, so the property does not rest on one insert happening to
-- work. A backfill would leave this untouched; a changed default would not.
select pg_temp.expect(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'centres' and column_name = 'ai_features') = 'false',
  'and the column default is false in the catalogue, not merely in practice'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';


-- Creating a tenant is an onboarding action, not something an authenticated
-- client may do — there is deliberately no INSERT policy on centres.
do $$
declare wrote boolean := false;
begin
  begin
    insert into public.centres (name, slug) values ('Rogue Centre', 'rls-test-rogue');
    wrote := true;
  exception when insufficient_privilege then
    wrote := false;
  end;
  perform pg_temp.expect(not wrote, 'an authenticated user CANNOT create a centre');
end $$;

-- ---------------------------------------------------------------------------
-- Symmetry: the same must hold from Bob's side. A policy that accidentally
-- keys on "the first centre" would pass every test above.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.centres where slug = 'rls-test-a') = 0,
  'bob CANNOT READ centre A'
);

select pg_temp.expect(
  (select count(*) from public.centres where slug = 'rls-test-b') = 1,
  'bob CAN read his own centre'
);

-- Symmetric on the email too, so a guard that happens to favour the first user
-- in the table does not pass.
select pg_temp.expect(
  public.member_email('11111111-1111-4111-8111-111111111111') is null,
  'member_email refuses alice''s email to bob'
);

-- ---------------------------------------------------------------------------
-- Audit log: append-only, and not editable by the people it describes.
-- ---------------------------------------------------------------------------

set local role postgres;
insert into public.audit_events (centre_id, actor_id, action, entity, entity_id)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        '22222222-2222-4222-8222-222222222222', 'test', 'centre', 'b');
insert into public.audit_events (centre_id, actor_id, action, entity, entity_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111', 'test', 'centre', 'a');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Scoped to action = 'test' throughout this section. Since 0005 every fixture
-- write above fires an audit trigger, so an unfiltered count here would measure
-- the fixture rather than the policy — and would need editing every time a test
-- above it changes.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where centre_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and action = 'test') = 0,
  'alice CANNOT READ centre B audit events'
);

select pg_temp.expect(
  (select count(*) from public.audit_events
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and action = 'test') = 1,
  'alice CAN read her own centre audit events'
);

-- The triggers from 0005 are the reason the application cannot forget to audit,
-- so their output is asserted rather than assumed. `an owner CAN rename their own
-- centre` ran earlier in this transaction; this is the record of it.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and entity = 'centres' and action = 'update') >= 1,
  'the audit trigger recorded the centre rename without being asked'
);

select pg_temp.expect(
  (select detail -> 'changed' ? 'name' from public.audit_events
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and entity = 'centres' and action = 'update'
    order by id desc limit 1),
  'and named the column that changed'
);

/*
 * AND AN OWNER CAN ACTUALLY TURN THE MODEL FLAG ON (0048).
 *
 * `centres` carries a COLUMN-level update grant, not a table-wide one. 0047 added the
 * column and not the grant, so Postgres refused the statement before any policy ran —
 * and because `updateCentre` builds one UPDATE from every changed field, that broke the
 * entire settings form: the sleep interval, the ratio source, the centre's name. A
 * feature nobody had enabled broke three that already worked.
 *
 * Asserted as a positive for the reason this suite keeps relearning: the "nobody has it
 * on" assertion above passes just as happily when the column is unwritable by anybody.
 *
 * It sits *here*, below the audit assertions, rather than beside that negative — those
 * read the most recent `centres` update, and two writes from this block would make the
 * latest row name `ai_features` instead of the rename they are about. Found by running
 * it in the obvious place first.
 */
do $$
declare n integer;
begin
  update public.centres set ai_features = true
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN turn the model flag on — the column grant exists');
  update public.centres set ai_features = false
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;

/*
 * 0083 — the service type columns, asserted the same way and for the same reason.
 *
 * Two positives and two constraint checks. The positives are the ones that matter: they
 * are the third attempt at guarding a failure mode this schema has now hit twice. 0047
 * added `ai_features` without extending the column-scoped UPDATE grant and broke the
 * WHOLE settings form, because `updateCentre` builds one statement from every changed
 * field. 0066 added `incidents.room_id`, checked the INSERT grants, missed the UPDATE
 * grants, and no incident draft could be corrected for six days.
 *
 * A negative assertion ("a parent cannot set the licence type") would pass just as
 * happily if the column were unwritable by everybody, which is precisely the broken
 * state. So these assert that an owner CAN write them.
 *
 * Restored to null afterwards, like the flag above, so no later block inherits a value
 * it did not set.
 *
 * MUTATION-DRILLED 2026-09-03, and the result changes how to read these labels. Pointing
 * the first update at `slug` — a column with SELECT and deliberately no UPDATE grant —
 * turned the suite red with:
 *
 *     permission denied for table centres
 *
 * Not a `FAIL` on the label below. A missing column grant RAISES, so the `do` block
 * propagates and the suite aborts before `expect` ever records anything. Red is still
 * red, so the gate holds — but the label is documentation for whoever reads the file, not
 * the text they will see when it breaks.
 *
 * Which is worth knowing, because that message is the whole reason 0047 was hard: Postgres
 * names the TABLE and not the column. "permission denied for table centres" after adding
 * a column to `centres` reads like a policy problem and is a grant problem, and the fix is
 * one line in the migration that added the column.
 */
do $$
declare n integer;
begin
  update public.centres set licence_type = 'education_and_care'
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN state the licence type — the column grant exists (0083)');

  update public.centres set service_model = 'all_day'
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN state the service model — the column grant exists (0083)');

  update public.centres set licence_type = null, service_model = null
   where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
end $$;

-- The CHECK refuses a value that is not on the list, rather than storing whatever arrives.
-- This is what makes "extend the list in a new migration" the only way to add a licence
-- type, which is the point: the two Crown pages disagree about this classification, so an
-- unlisted value must stop and be looked at rather than being filed under a neighbour.
do $$
declare code text := 'none';
begin
  begin
    update public.centres set licence_type = 'kohanga_reo'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an unlisted licence type is refused by the CHECK, not stored (0083)');
end $$;

do $$
declare code text := 'none';
begin
  begin
    update public.centres set service_model = 'all-day'
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a hyphenated service model is refused — the stored form is all_day (0083)');
end $$;

-- The constraint from 0003: audit rows outlive the record they describe, so they
-- carry column names and never values. A generic trigger logging to_jsonb(NEW)
-- would have copied allergies and custody orders in here.
select pg_temp.expect(
  not exists (
    select 1 from public.audit_events
     where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
       and detail::text like '%Renamed By Owner%'
  ),
  'and did NOT copy the value into the audit row'
);

-- An audit entry blaming somebody else is worse than no log at all.
do $$
declare wrote boolean := false;
begin
  begin
    insert into public.audit_events (centre_id, actor_id, action, entity)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '22222222-2222-4222-8222-222222222222', 'forged', 'centre');
    wrote := true;
  exception when insufficient_privilege or check_violation then
    wrote := false;
  end;
  perform pg_temp.expect(not wrote, 'alice CANNOT forge an audit entry as another actor');
end $$;

-- No UPDATE or DELETE policy exists, so both are denied by default. This is the
-- property that makes the log evidence rather than a changelog.
-- Append-only is enforced twice — no UPDATE/DELETE policy AND no UPDATE/DELETE
-- grant — so refusal can arrive either as 42501 from the privilege layer or as
-- zero rows affected from the policy layer. Both are a pass; the label records
-- which one answered, so removing one enforcement is visible in the output even
-- though the assertion still passes.
do $$
declare code text := 'none'; n integer := -1; tampered integer;
begin
  begin
    update public.audit_events set action = 'tampered'
     where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics n = row_count;
  exception when others then code := sqlstate;
  end;
  select count(*) into tampered from public.audit_events where action = 'tampered';
  perform pg_temp.expect(tampered = 0 and (code = '42501' or n = 0),
    'an owner CANNOT alter an audit entry (sqlstate ' || code || ', rows ' || n || ')');
end $$;

do $$
declare code text := 'none'; n integer := -1; remaining integer;
begin
  begin
    delete from public.audit_events
     where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    get diagnostics n = row_count;
  exception when others then code := sqlstate;
  end;
  select count(*) into remaining from public.audit_events
   where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and action = 'test';
  perform pg_temp.expect(remaining = 1 and (code = '42501' or n = 0),
    'an owner CANNOT delete an audit entry (sqlstate ' || code || ', rows ' || n || ')');
end $$;

-- ---------------------------------------------------------------------------
-- The service role is the credential that defeats everything else in this
-- schema — it bypasses RLS and can read every centre in one query. It still must
-- not be able to rewrite the record of what it did, because 0003 withholds
-- UPDATE and DELETE from it as well. That property is the whole argument for
-- calling this table evidence, so it gets asserted rather than commented.
-- ---------------------------------------------------------------------------

set local role service_role;

select pg_temp.expect(
  (select count(*) from public.audit_events where action = 'test') = 2,
  'service_role reads every centre''s audit events (RLS bypassed, as designed)'
);

do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.audit_events set action = 'tampered-by-service-role';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'service_role CANNOT alter an audit entry, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.audit_events;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'service_role CANNOT delete an audit entry, got ' || code);
end $$;

-- But it must still be able to append, or scheduled jobs cannot record anything.
do $$
declare n integer;
begin
  insert into public.audit_events (centre_id, action, entity)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'job.ran', 'system');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'service_role CAN append an audit entry');
end $$;

-- ===========================================================================
-- PHASE 1 — children, whānau, health and consent
--
-- Everything above tests one boundary: centre against centre. These test a second
-- one that lives inside a single centre, because `parent` is a role within the
-- tenant. Priya and Quinn are both parents at centre A with a child each. Every
-- assertion in this section would pass if the policies keyed on centre_id alone,
-- and the product would be handing one family another family's medical records.
-- ===========================================================================

set local role postgres;

insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
values
  ('33333333-3333-4333-8333-333333333333', 'priya@rlstest.invalid',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('44444444-4444-4444-8444-444444444444', 'quinn@rlstest.invalid',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
  ('55555555-5555-4555-8555-555555555555', 'ed@rlstest.invalid',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
on conflict (id) do nothing;

-- Two parents and an educator, all at centre A. Alice is already its owner.
insert into public.memberships (centre_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'parent'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'parent'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'educator');

-- Ana and Beau are at the same centre, in different families. Cody is at centre B.
insert into public.children (id, centre_id, first_name, last_name, date_of_birth) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Ana',  'Test', current_date - interval '3 years'),
  ('b2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'Beau', 'Test', current_date - interval '18 months'),
  ('c3333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'Cody', 'Test', current_date - interval '4 years');

insert into public.guardians (id, centre_id, user_id, full_name) values
  ('d1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '33333333-3333-4333-8333-333333333333', 'Priya Test'),
  ('d2222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   '44444444-4444-4444-8444-444444444444', 'Quinn Test'),
  -- Ana's other guardian, with no app account — the ordinary case for a
  -- grandparent on the collection list.
  ('d3333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   null, 'Ana Other-Guardian');

-- `is_authorised_signatory` (0061) is set deliberately and asymmetrically, because the
-- asymmetry is the test. Priya may sign for Ana. Quinn is Beau's father, has an app account
-- and a parent membership, and is NOT a signatory — so he passes every check the
-- verification policy makes except the one it exists to make. He is the control for ECE
-- Funding Handbook 6-3 criterion 4, and if that predicate is ever dropped from the policy
-- he is the row that notices.
insert into public.child_guardians (child_id, guardian_id, relationship, is_authorised_signatory) values
  ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'mother', true),
  ('a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333', 'grandmother', false),
  ('b2222222-2222-4222-8222-222222222222', 'd2222222-2222-4222-8222-222222222222', 'father', false);

insert into public.health_conditions (child_id, kind, name, severity, response_plan) values
  ('a1111111-1111-4111-8111-111111111111', 'allergy', 'Peanuts', 'anaphylaxis', 'EpiPen in the office'),
  ('b2222222-2222-4222-8222-222222222222', 'allergy', 'Dairy',   'moderate',    'No milk');

insert into public.custody_arrangements (child_id, detail) values
  ('a1111111-1111-4111-8111-111111111111', 'Parenting order in place. Do not discuss with either party.');

insert into public.enrolments (child_id, centre_id, start_date, funded_hours_per_week, days) values
  ('a1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   current_date - interval '6 months', 20, '{1,2,3}');

-- ---------------------------------------------------------------------------
-- Priya: her own child, and nobody else's
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.children) = 1,
  'a parent sees exactly one child — their own'
);

select pg_temp.expect(
  (select first_name from public.children) = 'Ana',
  'and it is the right one'
);

-- The assertion this whole section exists for.
select pg_temp.expect(
  (select count(*) from public.children
    where id = 'b2222222-2222-4222-8222-222222222222') = 0,
  'a parent CANNOT read another family''s child at the same centre'
);

select pg_temp.expect(
  (select count(*) from public.health_conditions
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 0,
  'a parent CANNOT read another family''s medical records'
);

select pg_temp.expect(
  (select name from public.health_conditions
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 'Peanuts',
  'a parent CAN read their own child''s allergy — they disclosed it'
);

-- Co-guardian privacy. Separated parents and protection orders are ordinary in
-- this domain, so the app does not hand one guardian another's contact details.
select pg_temp.expect(
  (select count(*) from public.guardians) = 1,
  'a parent sees only their own guardian record, not co-guardians'
);

select pg_temp.expect(
  (select count(*) from public.guardians
    where id = 'd2222222-2222-4222-8222-222222222222') = 0,
  'a parent CANNOT read another family''s guardian record'
);

-- The reason custody_arrangements is its own table rather than a column.
select pg_temp.expect(
  (select count(*) from public.custody_arrangements) = 0,
  'a parent CANNOT read the custody arrangement for their own child'
);

select pg_temp.expect(
  (select count(*) from public.enrolments
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'a parent CAN read their own child''s enrolment'
);

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.children (centre_id, first_name, last_name, date_of_birth)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Rogue', 'Child', current_date - interval '2 years');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'), 'a parent CANNOT enrol a child, got ' || code);
end $$;

-- ---------------------------------------------------------------------------
-- Consent: a parent may grant their own and only their own
-- ---------------------------------------------------------------------------

do $$
declare n integer;
begin
  insert into public.consent_events (child_id, kind, granted, given_by, recorded_by)
  values ('a1111111-1111-4111-8111-111111111111', 'photo_internal', true,
          'd1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a parent CAN record their own consent');
end $$;

select pg_temp.expect(
  public.has_consent('a1111111-1111-4111-8111-111111111111', 'photo_internal'),
  'has_consent reflects the grant'
);

-- Withdrawal is a new event, so the history survives. This is the question that
-- gets asked after a photo appears somewhere it should not have.
do $$
begin
  insert into public.consent_events (child_id, kind, granted, given_by, recorded_by)
  values ('a1111111-1111-4111-8111-111111111111', 'photo_internal', false,
          'd1111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333');
  perform pg_temp.expect(
    not public.has_consent('a1111111-1111-4111-8111-111111111111', 'photo_internal'),
    'withdrawing consent flips has_consent without deleting the history'
  );
  perform pg_temp.expect(
    (select count(*) from public.consent_events
      where child_id = 'a1111111-1111-4111-8111-111111111111' and kind = 'photo_internal') = 2,
    'and both events remain on the record'
  );
end $$;

select pg_temp.expect(
  not public.has_consent('a1111111-1111-4111-8111-111111111111', 'photo_public'),
  'consent defaults to false — photo_public was never granted by granting photo_internal'
);

-- One parent granting permission on another guardian's behalf.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.consent_events (child_id, kind, granted, given_by, recorded_by)
    values ('a1111111-1111-4111-8111-111111111111', 'photo_public', true,
            'd3333333-3333-4333-8333-333333333333', '33333333-3333-4333-8333-333333333333');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'a parent CANNOT record consent as a different guardian, got ' || code);
end $$;

do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.consent_events set granted = true
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'consent history CANNOT be altered, got ' || code);
end $$;

-- ---------------------------------------------------------------------------
-- The educator: every child at the centre, but not the parenting orders
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.children) = 2,
  'an educator sees every child at their centre'
);

select pg_temp.expect(
  (select count(*) from public.health_conditions) = 2,
  'an educator sees every allergy at their centre'
);

-- An educator needs to know a child must not go home with a named adult. That
-- belongs on the collection list, not in the terms of a court order.
select pg_temp.expect(
  (select count(*) from public.custody_arrangements) = 0,
  'an educator CANNOT read custody arrangements'
);

do $$
declare n integer;
begin
  insert into public.health_conditions (child_id, kind, name, severity)
  values ('b2222222-2222-4222-8222-222222222222', 'allergy', 'Bee stings', 'severe');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1,
    'an educator CAN record an allergy disclosed at the door');
end $$;

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.enrolments (child_id, centre_id, start_date)
    values ('b2222222-2222-4222-8222-222222222222',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date);
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'an educator CANNOT file an enrolment, got ' || code);
end $$;

-- The audit trigger fired for that allergy without the query layer asking, and
-- the log records who and when without restating the medical detail. Asserted on
-- a health table specifically, because this is the table where getting it wrong
-- copies a child's medical information into somewhere nobody is looking after it.
set local role postgres;
select pg_temp.expect(
  exists (
    select 1 from public.audit_events
     where entity = 'health_conditions' and action = 'insert'
       and actor_id = '55555555-5555-4555-8555-555555555555'
  ),
  'the audit trigger attributed the allergy to the educator who recorded it'
);

select pg_temp.expect(
  not exists (select 1 from public.audit_events where detail::text like '%Bee stings%'),
  'and kept the medical detail out of the audit row'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- The owner: custody visible, and the enrolment guards hold
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.custody_arrangements) = 1,
  'an owner CAN read custody arrangements'
);

-- Overlapping enrolments double-count funded hours, and the error surfaces months
-- later as a funding discrepancy nobody can trace back.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.enrolments (child_id, centre_id, start_date)
    values ('a1111111-1111-4111-8111-111111111111',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date);
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01',
    'an overlapping enrolment is refused by the database, got ' || code);
end $$;

/*
 * 0084 — the enrolment type and the 20 Hours attestation.
 *
 * `enrolments` carries TABLE-level grants, not column-scoped ones (measured: authenticated
 * holds SELECT, INSERT, UPDATE and DELETE, and its column-privilege counts equal its
 * column count in every verb). So unlike 0083's columns on `centres`, these need no grant
 * and the positive below is a weaker assertion than that one was. It is still worth having:
 * it proves the column exists, is writable through a policy, and accepts the value the
 * Handbook's own wording implies.
 *
 * The two negatives are the interesting ones.
 */
do $$
declare n integer;
begin
  update public.enrolments set enrolment_type = 'permanent'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n >= 1, 'an owner CAN state that an enrolment is permanent (0084)');
end $$;

-- NULL is not "permanent". Absence funding cannot be computed for a child whose type
-- nobody has stated, and defaulting to permanent would OVER-claim — the direction the
-- funding export currently promises is impossible. So the column must accept null and the
-- absence rules must refuse to guess, which is asserted here as a property of the schema
-- rather than left to the code that will read it.
do $$
declare n integer;
begin
  update public.enrolments set enrolment_type = null
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n >= 1, 'not stated is a storable enrolment type, and is not permanent (0084)');
end $$;

-- An unlisted type stops rather than being filed under a neighbour. The three values come
-- from Handbook 6-4 and nowhere else — ChildEnrolment in the ELI schema has no enrolment
-- type element at all — so a fourth arriving means somebody read something new, and it
-- should surface as a refusal and not as a row.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments set enrolment_type = 'temporary'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'an unlisted enrolment type is refused, got ' || code);
end $$;

-- ===========================================================================
-- 0086 — the child's residential address
--
-- Required by §6-1 and by ELI's `ChildEnrolment`, and stored structured because
-- `ChildEnrolmentAddress` requires Address1Line and AddressCity as separate elements.
--
-- The interesting assertions here are not the tenancy ones. They are the CHECK constraints
-- that stop an unserialisable row existing: a required element that is present but blank,
-- and a value longer than the schema's String100. Both would validate as far as this
-- database is concerned and fail — or worse, silently truncate — at the boundary.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.child_addresses (child_id, kind, address1_line, address_city, address_post_code)
  values ('a1111111-1111-4111-8111-111111111111', 'primary', '12 Example Road', 'Mount Albert', '1025');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN record a residential address (0086)');
end $$;

-- A second household is the case `SecondaryResidentialAddress` exists for.
do $$
declare n integer;
begin
  insert into public.child_addresses (child_id, kind, address1_line, address_city)
  values ('a1111111-1111-4111-8111-111111111111', 'secondary', '9 Other Street', 'Mount Roskill');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a child may have a secondary address as well (0086)');
end $$;

-- But not two primaries. The schema carries exactly one required primary, so a second is a
-- data-entry mistake and not an additional household.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.child_addresses (child_id, kind, address1_line, address_city)
    values ('a1111111-1111-4111-8111-111111111111', 'primary', '3 Duplicate Lane', 'Avondale');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23505', 'a second PRIMARY address is refused, got ' || code);
end $$;

-- A third kind is refused rather than stored. The schema allows two.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.child_addresses (child_id, kind, address1_line, address_city)
    values ('a1111111-1111-4111-8111-111111111111', 'holiday', '1 Beach Road', 'Piha');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an unlisted address kind is refused, got ' || code);
end $$;

/*
 * A REQUIRED ELEMENT THAT IS PRESENT AND BLANK — the assertion this table most needs.
 *
 * `Address1Line` and `AddressCity` are required in the XSD. `not null` alone accepts a
 * single space, which serialises to a present-but-empty required element: valid XML, and a
 * Crown return saying the child lives at " ". Refused by a trim check instead.
 */
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.child_addresses (child_id, kind, address1_line, address_city)
    values ('b2222222-2222-4222-8222-222222222222', 'primary', '   ', 'Mount Albert');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a blank Address1Line is refused, not stored, got ' || code);
end $$;

-- And the schema's String100 bound, enforced here so a long paste is a sentence on a form
-- rather than a truncation in a serialiser nobody is watching.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.child_addresses (child_id, kind, address1_line, address_city)
    values ('b2222222-2222-4222-8222-222222222222', 'primary', repeat('x', 101), 'Mount Albert');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an address line over the schema''s String100 is refused, got ' || code);
end $$;

-- The audit row is asserted, not assumed — 0059's failure mode, where three tables carried
-- triggers that wrote nothing for months because a centre could not be resolved.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'child_addresses' and action = 'insert') >= 1,
  'recording an address leaves an audit row — audit_trigger resolves child_id (0086)'
);

-- The other centre reads nothing.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_addresses) = 0,
  'another centre CANNOT read this centre''s addresses (0086)'
);

-- An educator reads it — they may need to know where a child goes home to — and cannot
-- change it, which is `caller_may_enrol` rather than `caller_is_staff_for_child`.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_addresses) > 0,
  'an educator CAN read a child''s address (0086)'
);
do $$
declare n integer;
begin
  update public.child_addresses set address_city = 'Somewhere Else'
   where child_id = 'a1111111-1111-4111-8111-111111111111' and kind = 'primary';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'an educator CANNOT change a child''s address (0086)');
end $$;

/*
 * AND NOT BY UPSERT EITHER, which is the statement `saveChildAddress` actually issues.
 *
 * The assertion above covers a bare UPDATE. `child_addresses` is written through an upsert on
 * `(child_id, kind)`, and `INSERT .. ON CONFLICT DO UPDATE` is a different statement under RLS: it
 * has to satisfy the insert policy's WITH CHECK and, on conflict, the update policy's USING and
 * WITH CHECK. Nothing here tested that combination, so an educator reaching the table by the one
 * route the application uses was unasserted.
 *
 * Note this is expected to ERROR rather than to match zero rows, unlike the UPDATE above: an
 * insert refused by a policy raises 42501 instead of quietly matching nothing, which is why the
 * API's error path and not its zero-row guard is what catches this one.
 */
do $$
declare code text := 'none (the upsert SUCCEEDED)';
begin
  begin
    insert into public.child_addresses (child_id, kind, address1_line, address_city)
    values ('a1111111-1111-4111-8111-111111111111', 'primary', '1 Educator Way', 'Somewhere Else')
    on conflict (child_id, kind) do update
      set address1_line = excluded.address1_line, address_city = excluded.address_city;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'an educator CANNOT upsert over a child''s address, got ' || code);
end $$;

-- A guardian reads their own child's address and cannot change it: the family supplies the
-- fact, the service records it.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_addresses) > 0,
  'a guardian CAN read their own child''s address (0086)'
);
do $$
declare n integer;
begin
  update public.child_addresses set address_city = 'Somewhere Else'
   where child_id = 'a1111111-1111-4111-8111-111111111111' and kind = 'primary';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'a guardian CANNOT change the recorded address themselves (0086)');
end $$;

-- The other family at the same centre reads nothing. The in-centre guardianship boundary.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_addresses) = 0,
  'a guardian of a DIFFERENT child at the same centre reads no address (0086)'
);

-- `anon` is stopped by the GRANT, before any policy runs.
do $$
declare code text := 'none';
begin
  set local role anon;
  begin
    perform 1 from public.child_addresses;
  exception when others then code := sqlstate;
  end;
  set local role authenticated;
  perform pg_temp.expect(code = '42501', 'anon is refused by the GRANT on child_addresses, got ' || code);
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

/*
 * The owner's upsert replaces in place rather than raising 23505 — the other half of the pair
 * above, and the reason `0086` chose `unique (child_id, kind)` over an effective-dated chain.
 * Asserted through the same statement the application issues, because "a plain UPDATE works" and
 * "the upsert works" are different claims and only the second one is on the path a person uses.
 */
do $$
declare n integer;
begin
  insert into public.child_addresses (child_id, kind, address1_line, address_city, address_post_code)
  values ('a1111111-1111-4111-8111-111111111111', 'primary', '14 Example Road', 'Kingsland', '1021')
  on conflict (child_id, kind) do update
    set address1_line   = excluded.address1_line,
        address_city    = excluded.address_city,
        address_post_code = excluded.address_post_code,
        recorded_at     = now();
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN replace an address by upsert, not just insert (0086)');
end $$;

-- And it replaced rather than accumulated. A unique constraint plus DO UPDATE is the only reason
-- there is one row here; the count is the assertion that the conflict target is the pair and not
-- the surrogate id, which would have quietly produced two primary addresses.
select pg_temp.expect(
  (select count(*) from public.child_addresses
    where child_id = 'a1111111-1111-4111-8111-111111111111' and kind = 'primary') = 1
  and (select address_city from public.child_addresses
        where child_id = 'a1111111-1111-4111-8111-111111111111' and kind = 'primary') = 'Kingsland',
  'the upsert REPLACED the primary address rather than adding a second (0086)'
);

-- ===========================================================================
-- 0093 — the notice date, and the one over-claim it closes
--
-- The assertion that matters here is the LAST one: notice and the end date are two facts, and
-- a schema that let one stand in for the other would either stop a claim early or keep
-- claiming after the Ministry says to stop. Everything above it is the paired-completeness and
-- signatory machinery, which is by now routine.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  update public.enrolments
     set notice_given_on = current_date,
         notice_given_by = 'd1111111-1111-4111-8111-111111111111'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a guardian of the child CAN give notice (0093)');
end $$;

-- Half a notice is refused: a date with nobody attached says a claim was stopped without
-- saying who asked for it to be.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments set notice_given_on = current_date, notice_given_by = null
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a notice date with nobody attached is refused, got ' || code);
end $$;

/*
 * THE SIGNATORY TRIGGER, ON A THIRD COLUMN.
 *
 * 0087's trigger is generic over the column via TG_ARGV, and 0093 recreated the trigger with
 * `notice_given_by` added to its argument list. This is what proves the third argument is
 * actually wired — without it the column would accept any guardian in the database, including
 * another centre's, which is what a bare foreign key permits.
 */
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments
       set notice_given_on = current_date,
           notice_given_by = 'd2222222-2222-4222-8222-222222222222'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'ANOTHER FAMILY''S guardian cannot give notice for this child, got ' || code);
end $$;

-- Notice cannot predate the enrolment it ends. A stored-date comparison rather than a
-- time-relative CHECK, so a restore cannot fail on a row that is merely old — 0078.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments
       set notice_given_on = '2020-01-01',
           notice_given_by = 'd1111111-1111-4111-8111-111111111111'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'notice before the enrolment started is refused, got ' || code);
end $$;

/*
 * NOTICE AND THE END DATE ARE TWO FACTS, AND THIS IS THE ASSERTION THE COLUMN EXISTS FOR.
 *
 * A family says in March that the child is leaving at Easter. The notice date is in March, the
 * end date is in April, and between them the enrolment is still CURRENT while no absence may be
 * claimed. A schema that derived one from the other would either stop the claim in April — a
 * month of absences the Ministry says are not claimable — or treat the March notice as an
 * ending and cut the enrolment short.
 *
 * Both are set here and read back independently, because "they can both be set" is a weaker
 * claim than "they hold different values and neither moved the other".
 */
do $$
declare v_notice date; v_end date; v_start date;
begin
  update public.enrolments
     set notice_given_on = '2026-03-10',
         notice_given_by = 'd1111111-1111-4111-8111-111111111111',
         end_date = '2026-04-17'
   where child_id = 'a1111111-1111-4111-8111-111111111111';

  select notice_given_on, end_date, start_date into v_notice, v_end, v_start
    from public.enrolments where child_id = 'a1111111-1111-4111-8111-111111111111';

  perform pg_temp.expect(
    v_notice = '2026-03-10' and v_end = '2026-04-17' and v_notice < v_end,
    'notice and the end date are independent, and notice comes first (0093)'
  );
end $$;

-- An educator cannot record notice: it stops a funding claim, so it is owner-or-manager like
-- everything else on this row.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare n integer;
begin
  update public.enrolments set notice_given_on = null, notice_given_by = null
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'an educator CANNOT record or clear notice (0093)');
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Cleared, and clearing must WORK: a notice entered against the wrong child has to be
-- removable, or a family that changes its mind loses funding nobody can restore.
do $$
declare n integer; v_notice date;
begin
  update public.enrolments
     set notice_given_on = null, notice_given_by = null, end_date = null
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  select notice_given_on into v_notice from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  perform pg_temp.expect(n = 1 and v_notice is null,
    'notice can be withdrawn, because a family may change its mind (0093)');
end $$;

-- ===========================================================================
-- 0092 — the §6-7 reconfirmation
--
-- The assertion worth reading first is the REPEATED one. Every other dated table built this
-- week refuses overlapping periods; this one deliberately does not, because §6-7's timeline
-- expects a pattern that persists to be reconfirmed more than once. An exclusion constraint
-- copied from `0089` out of habit would have refused exactly what the rule asks for.
--
-- The second is the SIGNATORY one, which is the only test that the trigger extended in 0092
-- can resolve a child through an enrolment. `enrolment_reconfirmations` carries no
-- `child_id`, so before that extension the guard silently compared against null and let
-- anything through.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare v_enrolment uuid; n integer;
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;

  insert into public.enrolment_reconfirmations
    (enrolment_id, guardian_id, confirmed_on, outcome, method)
  values (v_enrolment, 'd1111111-1111-4111-8111-111111111111', '2026-04-30', 'affirmed', 'portal');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN record a §6-7 reconfirmation (0092)');
end $$;

/*
 * REPEATED RECONFIRMATION IS THE POINT, NOT A CONFLICT.
 *
 * §6-7 runs month by month: a pattern that continues is reconfirmed again. The three other
 * dated tables from this week — 0085, 0088, 0089 — all refuse overlapping periods, and
 * copying that here would have refused the thing the rule requires. This is the assertion
 * that pins the ABSENCE of a constraint, which is the kind of decision a later migration
 * "tidies up".
 */
do $$
declare v_enrolment uuid; n integer;
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  insert into public.enrolment_reconfirmations
    (enrolment_id, guardian_id, confirmed_on, outcome, method)
  values (v_enrolment, 'd1111111-1111-4111-8111-111111111111', '2026-05-31', 'affirmed', 'paper');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1,
    'the SAME agreement can be reconfirmed again a month later - §6-7 expects it (0092)');
end $$;

-- What is refused is the same agreement twice on one day, which is a double submission rather
-- than a second conversation.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.enrolment_reconfirmations
      (enrolment_id, guardian_id, confirmed_on, outcome, method)
    values (v_enrolment, 'd3333333-3333-4333-8333-333333333333', '2026-05-31', 'affirmed', 'kiosk');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23505',
    'one agreement cannot be reconfirmed twice on the same day, got ' || code);
end $$;

-- §6-7's second outcome: "documenting revised attendance days/times". It has to say what it
-- revised — the same reasoning as 0061's `av_dispute_explained`, that an outcome needing a
-- reason is not recordable without one.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.enrolment_reconfirmations
      (enrolment_id, guardian_id, confirmed_on, outcome, method)
    values (v_enrolment, 'd1111111-1111-4111-8111-111111111111', '2026-06-30', 'revised', 'portal');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a REVISED agreement must say what changed, got ' || code);
end $$;

do $$
declare v_enrolment uuid; n integer;
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  insert into public.enrolment_reconfirmations
    (enrolment_id, guardian_id, confirmed_on, outcome, method, detail)
  values (v_enrolment, 'd1111111-1111-4111-8111-111111111111', '2026-06-30', 'revised', 'portal',
          'Dropped Friday; new block filed from 1 July');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a revision WITH a note is recorded (0092)');
end $$;

-- Whitespace is not a note. `not null` alone would accept a single space, which is the same
-- class of hole 0086 found on a required address line.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.enrolment_reconfirmations
      (enrolment_id, guardian_id, confirmed_on, outcome, method, detail)
    values (v_enrolment, 'd1111111-1111-4111-8111-111111111111', '2026-07-31', 'revised',
            'portal', '   ');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a blank revision note is refused, got ' || code);
end $$;

do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.enrolment_reconfirmations
      (enrolment_id, guardian_id, confirmed_on, outcome, method)
    values (v_enrolment, 'd1111111-1111-4111-8111-111111111111', '2026-08-31', 'maybe', 'portal');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an unlisted reconfirmation outcome is refused, got ' || code);
end $$;

/*
 * THE SIGNATORY TRIGGER, RESOLVING A CHILD THROUGH AN ENROLMENT.
 *
 * Quinn is Beau's father: a real guardian, at this same centre, with an account — and not
 * Ana's guardian. The foreign key accepts him. This table has no `child_id`, so 0087's
 * trigger compared against null until 0092 taught it to resolve one through the enrolment,
 * and without that extension this insert would have SUCCEEDED — a signature on Ana's funding
 * record attributed to another family's parent.
 */
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.enrolment_reconfirmations
      (enrolment_id, guardian_id, confirmed_on, outcome, method)
    values (v_enrolment, 'd2222222-2222-4222-8222-222222222222', '2026-09-30', 'affirmed', 'portal');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'ANOTHER FAMILY''S guardian cannot reconfirm this child''s agreement, got ' || code);
end $$;

/*
 * And the other centre's guardian, which is the tenancy half of the same trigger.
 *
 * The guardian is CREATED HERE rather than borrowed from 0088's block, and that correction is
 * worth recording: this block sits earlier in the file, so 0088's `d9999999` does not exist
 * yet. Borrowing it made the assertion pass for the wrong reason — the trigger fires before
 * the foreign key, so a uuid belonging to nobody raises the same 23514 as one belonging to
 * another centre, and the label claimed a tenancy test it was not performing.
 */
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
insert into public.guardians (id, centre_id, full_name)
values ('d8888888-8888-4888-8888-888888888888', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'Other Centre Signatory');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)'; v_exists boolean;
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;

  -- The guardian must actually EXIST for this to be a tenancy test rather than a
  -- missing-row test. Asserted, because that is precisely what went wrong first time.
  select exists (select 1 from public.guardians g
                  where g.id = 'd8888888-8888-4888-8888-888888888888') into v_exists;
  perform pg_temp.expect(v_exists = false,
    'centre A cannot even SEE the other centre''s guardian, so the row exists unseen (0092)');

  begin
    insert into public.enrolment_reconfirmations
      (enrolment_id, guardian_id, confirmed_on, outcome, method)
    values (v_enrolment, 'd8888888-8888-4888-8888-888888888888', '2026-10-31', 'affirmed', 'portal');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'ANOTHER CENTRE''S guardian cannot reconfirm an agreement here, got ' || code);
end $$;

-- The audit row, attributed through the enrolment. This is 0090's branch doing its work on a
-- second table, and the assertion is what distinguishes "the trigger fired" from "the trigger
-- resolved a tenant".
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'enrolment_reconfirmations'
      and action = 'insert'
      and centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') >= 1,
  'a reconfirmation leaves an audit row attributed through the enrolment (0090 + 0092)'
);

-- An educator neither reads nor writes: a reconfirmation is a funding-compliance record, and
-- `caller_may_exempt` is owner-or-manager.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_reconfirmations) = 0,
  'an educator reads NO reconfirmation (0092)'
);

-- Nor the parent who signed it. They hold their own copy and §6-7 requires the SERVICE to keep
-- one; a family-facing view of their own signatures is a real feature and is not this one.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_reconfirmations) = 0,
  'the PARENT who signed does not read it back here either (0092)'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_reconfirmations) = 0,
  'another centre CANNOT read this centre''s reconfirmations (0092)'
);

do $$
declare code text := 'none';
begin
  set local role anon;
  begin
    perform 1 from public.enrolment_reconfirmations;
  exception when others then code := sqlstate;
  end;
  set local role authenticated;
  perform pg_temp.expect(code = '42501',
    'anon is refused by the GRANT on enrolment_reconfirmations, got ' || code);
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Leave the table empty, so a later assertion counting rows on this enrolment is not reading
-- this block's fixtures.
delete from public.enrolment_reconfirmations;

-- ===========================================================================
-- 0096 — the RS7 declaration
--
-- A legal attestation about how a service pays its teachers, made to the Crown. The
-- boundary under test is narrower than most: owner or manager for **select** as well
-- as the write verbs, because an educator has no reason to read their employer's
-- salary declaration and the funding surface it sits behind is `manageCentre`.
--
-- The two CHECKs are transcriptions rather than opinions — the period start comes
-- from the public schema's `RS7PeriodStartDate` pattern and the six parity steps from
-- its enumeration — so getting either wrong would let a service record a declaration
-- the Ministry's own schema would reject on submission.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.rs7_declarations
  (id, centre_id, period_start_date, salaries_attestation, parity_attestation,
   parity_attestation_code, submitter_name, contact_number, designation, recorded_by)
values ('ea111111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        date '2026-06-01', true, true, 'STEP1-11',
        'Aroha Ngata', '09 555 0100', 'Centre Manager',
        '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.rs7_declarations) = 1,
  'an owner can record the RS7 declaration'
);

-- One per centre per period. A second is an edit, not another statement.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.rs7_declarations (centre_id, period_start_date)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2026-06-01');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a second declaration for the same period is refused');
end $$;

-- The period start is the schema's, not ours: `[0-9]{4}-(02|06|10)-01`.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.rs7_declarations (centre_id, period_start_date)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2026-03-01');
  exception when check_violation then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'a period start the RS7 schema does not allow is refused — Feb, Jun or Oct the first'
  );
end $$;

-- The parity steps are the schema's enumeration, and nothing here knows what they mean.
do $$
declare ok boolean := false;
begin
  begin
    update public.rs7_declarations set parity_attestation_code = 'STEP7'
     where id = 'ea111111-1111-4111-8111-111111111111';
  exception when check_violation then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parity step outside the schema''s six is refused');
end $$;

-- Blank is not an answer. `not null` would accept three spaces and say nothing.
do $$
declare ok boolean := false;
begin
  begin
    update public.rs7_declarations set submitter_name = '   '
     where id = 'ea111111-1111-4111-8111-111111111111';
  exception when check_violation then ok := true;
  end;
  perform pg_temp.expect(ok, 'a blank submitter name is refused rather than stored');
end $$;

-- NULL is not false. An unsigned declaration has not answered "no".
update public.rs7_declarations set salaries_attestation = null
 where id = 'ea111111-1111-4111-8111-111111111111';
select pg_temp.expect(
  (select salaries_attestation is null from public.rs7_declarations
    where id = 'ea111111-1111-4111-8111-111111111111'),
  'an attestation can be set back to NOT STATED, which is not the same as false'
);
update public.rs7_declarations set salaries_attestation = true
 where id = 'ea111111-1111-4111-8111-111111111111';

-- THE BOUNDARY THIS SECTION EXISTS FOR. An educator reads nothing.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.rs7_declarations) = 0,
  'an educator reads NO declaration — it is a statement about their employer''s salaries'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.rs7_declarations (centre_id, period_start_date)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', date '2026-10-01');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor can an educator make one');
end $$;

-- A parent reads nothing either, and neither does another centre.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.rs7_declarations) = 0,
  'a parent reads NO declaration'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.rs7_declarations) = 0,
  'another centre reads NO declaration'
);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
delete from public.rs7_declarations;

-- ===========================================================================
-- 0089 — absence-rule exemptions (§7-7), and 0090's audit attribution
--
-- Two things are under test here and they are worth separating. The CHECK constraints are a
-- transcription of §7-7's criteria — a short-term illness may only be evidenced by an EC13
-- and must carry an end date, an IDP must carry its issue date — and getting one wrong would
-- let a service record an exemption the Handbook does not allow, which is a funding claim
-- nobody could defend.
--
-- The other is the AUDIT ROW. `absence_exemptions` keys on `enrolment_id`, which was not in
-- `audit_trigger()`'s resolution list until 0090. Without that branch every write here would
-- have succeeded and left no audit trail at all — the 0059 defect, which the class assertion
-- further down this file caught the same day 0089 was written.
--
-- Fixed literal dates, not `current_date`: this suite runs in UTC and the product judges in
-- the centre's zone.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Ana's enrolment, by lookup rather than by a hardcoded id: the fixture inserts it without
-- one, and an assertion built on a uuid that does not exist fails with 42501 where it meant
-- to test a constraint. That substitution cost a run on 0086.
do $$
declare v_enrolment uuid; n integer;
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  perform pg_temp.expect(v_enrolment is not null, 'the fixture has an enrolment to exempt (0089)');

  insert into public.absence_exemptions
    (enrolment_id, basis, evidence, ec12_completed_on, exempt_from, exempt_to, notes)
  values (v_enrolment, 'short_term_illness', 'ec13', '2026-02-01', '2026-02-01', '2026-03-15',
          'Chickenpox, EC13 period stated');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN record a §7-7 exemption (0089)');
end $$;

/*
 * THE AUDIT ROW, WHICH IS THE ASSERTION 0090 EXISTS FOR.
 *
 * `enrolment_id` was not in `audit_trigger()`'s list, so before 0090 this insert left no
 * trace. Attribution is asserted as well as existence: the row has to land against THIS
 * centre, which is what the join through `enrolments` provides and what a wrong branch would
 * get wrong silently.
 */
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'absence_exemptions'
      and action = 'insert'
      and centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') >= 1,
  'recording an exemption leaves an audit row attributed to the right centre (0090)'
);

-- §7-7: a short-term illness is evidenced by an EC13 and nothing else. A Child Disability
-- Allowance letter does not evidence a fortnight of chickenpox.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.absence_exemptions
      (enrolment_id, basis, evidence, ec12_completed_on, exempt_from, exempt_to)
    values (v_enrolment, 'short_term_illness', 'child_disability_allowance',
            '2026-05-01', '2026-05-01', '2026-05-30');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a short-term illness cannot be evidenced by a disability allowance, got ' || code);
end $$;

-- And it must be bounded, because the EC13 "specifies the exemption period".
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.absence_exemptions
      (enrolment_id, basis, evidence, ec12_completed_on, exempt_from)
    values (v_enrolment, 'short_term_illness', 'ec13', '2026-05-01', '2026-05-01');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a short-term illness exemption with no end date is refused, got ' || code);
end $$;

-- An IDP with no issue date makes §7-7's "issued within previous 6 months" unanswerable.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.absence_exemptions
      (enrolment_id, basis, evidence, ec12_completed_on, exempt_from)
    values (v_enrolment, 'ongoing_learning_support', 'idp', '2026-06-01', '2026-06-01');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an IDP with no issue date is refused, got ' || code);
end $$;

/*
 * AN OLD IDP IS ACCEPTED, and that is the assertion for a constraint deliberately NOT written.
 *
 * §7-7 wants an IDP "issued within previous 6 months". No CHECK enforces it: a time-relative
 * one would make this table unrestorable (0078), and "previous" does not say previous to what
 * — the application, the claim, or the absence. So a two-year-old IDP is STORED and whether it
 * satisfies §7-7 is a question for the readiness surface. This pins that decision, because the
 * obvious future "improvement" is to add the CHECK.
 */
do $$
declare v_enrolment uuid; n integer;
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  insert into public.absence_exemptions
    (enrolment_id, basis, evidence, evidence_dated_on, ec12_completed_on, exempt_from, notes)
  values (v_enrolment, 'ongoing_learning_support', 'idp', '2024-01-01', '2026-06-01',
          '2026-06-01', 'IDP two years old - reportable, not refusable');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1,
    'an IDP older than six months is STORED, not refused - 0078''s lesson (0089)');
end $$;

-- An ongoing need may be open-ended, which is what distinguishes it from a short-term
-- illness. Note the row above is already open-ended from 2026-06-01, so a later one collides:
-- the same infinity semantics as 0085 and 0088.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.absence_exemptions
      (enrolment_id, basis, evidence, ec12_completed_on, exempt_from, exempt_to)
    values (v_enrolment, 'ongoing_learning_support', 'ec13', '2026-09-01', '2026-09-01',
            '2026-09-30');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01',
    'an open-ended exemption covers every later date, so a later one collides, got ' || code);
end $$;

-- And an overlap with the bounded February one is refused too.
do $$
declare v_enrolment uuid; code text := 'none (the insert SUCCEEDED)';
begin
  select id into v_enrolment from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111' limit 1;
  begin
    insert into public.absence_exemptions
      (enrolment_id, basis, evidence, ec12_completed_on, exempt_from, exempt_to)
    values (v_enrolment, 'short_term_illness', 'ec13', '2026-03-01', '2026-03-15', '2026-03-20');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01',
    'two exemptions cannot cover the same day of one agreement, got ' || code);
end $$;

/*
 * WHO CANNOT SEE IT, and this is the narrow choice being pinned rather than a tenancy check.
 *
 * An educator reads `health_conditions`, because they have to respond to an allergy at the
 * door. An absence-rule exemption is a purely financial instrument and the row discloses that
 * a child has an ongoing learning support need or a health problem — so the audience is owner
 * and manager, and this assertion is what stops that being widened without a decision.
 */
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.absence_exemptions) = 0,
  'an educator reads NO exemption - narrower than health conditions, on purpose (0089)'
);

-- Nor the child's own parent, which is a real trade-off rather than an oversight: they
-- supplied the EC13, so they know, and a self-service view of it is a disclosure surface
-- nobody asked for. Recorded here so the next reader knows it was weighed.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.absence_exemptions) = 0,
  'a PARENT does not read their own child''s exemption either (0089)'
);

-- The other centre reads nothing, and cannot write one against this centre's enrolment.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.absence_exemptions) = 0,
  'another centre CANNOT read this centre''s exemptions (0089)'
);
do $$
declare v_enrolment uuid := 'e1111111-1111-4111-8111-111111111111'; code text := 'none';
begin
  -- The id is fabricated on purpose: centre B's owner cannot SELECT centre A's enrolments, so
  -- this is what an attempt from outside actually looks like. `caller_may_exempt` finds no
  -- matching enrolment either way and the insert is refused.
  begin
    insert into public.absence_exemptions
      (enrolment_id, basis, evidence, ec12_completed_on, exempt_from, exempt_to)
    values (v_enrolment, 'short_term_illness', 'ec13', '2026-02-01', '2026-02-01', '2026-02-28');
  exception when others then code := sqlstate;
  end;
  -- 42501, measured rather than guessed: the insert policy refuses it before the foreign key
  -- is consulted, so this pins the POLICY rather than accepting whichever of two codes turns
  -- up. A disjunction here would have passed even if the only thing stopping a cross-tenant
  -- write were referential integrity.
  perform pg_temp.expect(code = '42501',
    'another centre CANNOT record an exemption against this centre''s enrolment, got ' || code);
end $$;

-- `anon` is stopped by the GRANT, before any policy runs.
do $$
declare code text := 'none';
begin
  set local role anon;
  begin
    perform 1 from public.absence_exemptions;
  exception when others then code := sqlstate;
  end;
  set local role authenticated;
  perform pg_temp.expect(code = '42501',
    'anon is refused by the GRANT on absence_exemptions, got ' || code);
end $$;

-- And the definer predicate is callable by a signed-in caller but answers only about their own
-- centres. Asserted because a predicate granted to `anon` would be a tenancy oracle.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare code text := 'none';
begin
  set local role anon;
  begin
    perform public.caller_may_exempt('00000000-0000-4000-8000-000000000000');
  exception when others then code := sqlstate;
  end;
  set local role authenticated;
  perform pg_temp.expect(code = '42501', 'anon cannot call caller_may_exempt, got ' || code);
end $$;

-- Leave the table as it was found: these rows are the fixture's only exemptions and later
-- assertions count enrolments rather than exemptions, but the exclusion constraint is per
-- enrolment and a leftover open-ended row would collide with anything added after this.
delete from public.absence_exemptions;

-- ===========================================================================
-- 0088 — service closures
--
-- Fixed literal dates throughout, not `current_date`. A closure is judged by the centre's
-- calendar and the suite runs in UTC, and an assertion built on "today" is only true for half
-- the day — which cost an e2e run on 2026-09-04 and is now a convention. Nothing here needs
-- to be relative, so nothing here is.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.service_closures (centre_id, starts_on, ends_on, reason_note)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-01-05', '2026-01-09', 'Summer close-down');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN record a period the service was closed (0088)');
end $$;

-- An overlapping period is a data-entry mistake with arithmetic consequences: §6-6 counts
-- consecutive closed days, and a period counted twice extends a suspension that should have
-- ended. One day of overlap is enough to catch it.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures (centre_id, starts_on, ends_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-01-09', '2026-01-12');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01', 'an OVERLAPPING closure is refused, got ' || code);
end $$;

-- And the day after is not an overlap. `[]` is inclusive at both ends, so this is the
-- assertion that the range bound is right rather than off by one in the safe-looking
-- direction: with `[)` this insert would pass and the overlap above would too.
do $$
declare n integer;
begin
  insert into public.service_closures (centre_id, starts_on, ends_on, reason_note)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-01-10', '2026-01-12', 'Extra day');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a closure starting the day after another is accepted (0088)');
end $$;

/*
 * A CLOSURE WITH NO STATED END. A flood on Tuesday and nobody knows for how long. Recording
 * it as a one-day closure would be false and refusing it until the end is known loses the
 * fact, so null is "not yet known" — the same three-state treatment `enrolments.end_date`
 * gets. Placed far enough forward that its infinite tail cannot collide with anything above.
 */
do $$
declare n integer;
begin
  insert into public.service_closures (centre_id, starts_on, ends_on, reason_note)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2031-06-01', null, 'Flood, reopening unknown');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a closure with NO stated end is recorded, not refused (0088)');
end $$;

-- And it covers every later date, which is what a null end MEANS. The same infinity semantics
-- 0085 relies on, asserted here because a null that quietly meant "one day" would let a second
-- closure be filed inside an ongoing one.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures (centre_id, starts_on, ends_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2031-09-01', '2031-09-05');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01',
    'an open-ended closure covers every later date, so a later one collides, got ' || code);
end $$;

-- Backwards dates are a typo, and a negative closure would subtract days from a suspension.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures (centre_id, starts_on, ends_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-03-10', '2026-03-01');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a closure ending before it starts is refused, got ' || code);
end $$;

/*
 * THE TWO THAT GUARD THE WIRE, and they are the reason this table has CHECK constraints at
 * all. `ClosureReasonCode` is a LookupCode: a value over the bound would be truncated by a
 * serialiser nobody is watching, and one that is present but blank serialises to an empty
 * attribute on a Crown return. Both are refused here instead.
 */
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures (centre_id, starts_on, ends_on, reason_code)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-04-01', '2026-04-02', repeat('x', 11));
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a reason code over the schema''s LookupCode bound is refused, got ' || code);
end $$;

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures (centre_id, starts_on, ends_on, reason_code)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-04-01', '2026-04-02', '   ');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a blank reason code is refused, not stored, got ' || code);
end $$;

-- An UNRESOLVABLE code is accepted, and that is the point: `code_sets` reserves a
-- `closure_reason` domain and ships it EMPTY, because the Ministry has not published the
-- list. A foreign key here would make the column unwritable until it does. The gap belongs on
-- a readiness report, not in a rejected write.
do $$
declare n integer;
begin
  insert into public.service_closures (centre_id, starts_on, ends_on, reason_code)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-04-01', '2026-04-02', 'HOLIDAY');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1,
    'a reason code with no published list behind it is STORED, not refused (0088)');
end $$;

select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'service_closures' and action = 'insert') >= 1,
  'recording a closure leaves an audit row — audit_trigger resolves centre_id (0088)'
);

-- The other centre reads nothing.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.service_closures) = 0,
  'another centre CANNOT read this centre''s closures (0088)'
);

/*
 * A PARENT CAN READ THEM, and this is the widening worth asserting rather than the
 * restriction. A family needs to know the centre is shut next Thursday; that is the single
 * most operationally useful thing on this table, and hiding it behind a staff role would be
 * perverse. The select policy is `caller_centre_ids()` — every member — where almost
 * everything else on the child side keys on guardianship.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.service_closures) > 0,
  'a PARENT can see when the service is closed (0088)'
);

-- And cannot record one. A closure changes funded days.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures (centre_id, starts_on, ends_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-07-01', '2026-07-02');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'a parent CANNOT record a closure, got ' || code);
end $$;

-- An educator reads them and cannot change them — same split as the address table.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.service_closures) > 0,
  'an educator CAN see when the service is closed (0088)'
);
do $$
declare n integer;
begin
  update public.service_closures set reason_note = 'Rewritten by an educator'
   where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'an educator CANNOT change a closure (0088)');
end $$;


-- ---------------------------------------------------------------------------
-- 0091 — an approved emergency closure is fundable, and the states that guard it
--
-- The assertions here are all about which combinations may EXIST, because the funded-hours
-- path will branch on them in 2F: a term break and a snow day are both closed days and only
-- one is claimable. A row that says "approved" without saying it is being claimed, or that
-- carries a letter date for a request nobody has answered, would each be a claim nobody could
-- defend to an auditor.
--
-- The owner claim is re-set first, and that is not decoration: this block sits after 0088's
-- educator assertions, so without it the first insert runs as an educator and dies on the
-- write policy rather than testing anything. The suite is one long transaction and the JWT is
-- whatever the previous block left behind.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.service_closures
    (centre_id, starts_on, ends_on, reason_note, claimed_as_emergency, ero_approval,
     ero_letter_dated_on)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-06-10', '2026-06-11',
          'Storm, roads closed', true, 'approved', '2026-06-20');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an APPROVED emergency closure can be recorded in full (0091)');
end $$;

-- Declined is an outcome, not an absence of one. §7-5: ERO's letter confirms
-- "approval/not approval", so a boolean could not hold this and a declined closure would be
-- indistinguishable from a term break.
do $$
declare n integer;
begin
  insert into public.service_closures
    (centre_id, starts_on, ends_on, reason_note, claimed_as_emergency, ero_approval,
     ero_letter_dated_on)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-06-15', '2026-06-15',
          'Staff shortage - claimed, then declined', true, 'declined', '2026-06-25');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a DECLINED emergency closure is a recorded outcome (0091)');
end $$;

-- And a claim with no answer yet, which is the ordinary state: §7-5 says to contact ERO "at
-- the first available opportunity", which is after the doors are already shut.
do $$
declare n integer;
begin
  insert into public.service_closures
    (centre_id, starts_on, ends_on, reason_note, claimed_as_emergency, ero_approval)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-06-18', '2026-06-18',
          'Flooding, ERO contacted', true, 'requested');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an emergency closure awaiting EROs answer is recordable (0091)');
end $$;

-- An unlisted approval state is refused rather than stored.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures
      (centre_id, starts_on, ends_on, claimed_as_emergency, ero_approval)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-06-22', '2026-06-22', true, 'pending');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an unlisted ERO approval state is refused, got ' || code);
end $$;

/*
 * AN ERO LETTER ABOUT A TERM BREAK IS NOT A THING.
 *
 * The assertion that stops the two facts drifting apart. Without it a closure could carry
 * `approved` while `claimed_as_emergency` stayed false — a row saying the Ministry's auditor
 * approved something nobody is claiming, which reads as evidence and is not.
 */
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures
      (centre_id, starts_on, ends_on, claimed_as_emergency, ero_approval)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-06-24', '2026-06-24', false, 'approved');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'an approval cannot sit on a closure nobody is claiming as an emergency, got ' || code);
end $$;

-- A letter date with no letter. `requested` means ERO has been contacted and nothing has come
-- back, so a date here would be a document that does not exist.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.service_closures
      (centre_id, starts_on, ends_on, claimed_as_emergency, ero_approval, ero_letter_dated_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-06-26', '2026-06-26', true,
            'requested', '2026-06-27');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a letter date on a request nobody has answered is refused, got ' || code);
end $$;

/*
 * THE DEFAULT IS THE SAFE DIRECTION, and this pins it.
 *
 * Every closure recorded before 0091 has `claimed_as_emergency = false`, so it is an ordinary
 * closure: not claimable. That under-claims rather than over-claims, which is the one
 * direction this product's funding figures promise they never get wrong — and a default of
 * true would have silently turned every term break already on file into a funding claim.
 */
do $$
declare v_claimed boolean;
begin
  insert into public.service_closures (centre_id, starts_on, ends_on, reason_note)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-07-06', '2026-07-17', 'Term break');
  select claimed_as_emergency into v_claimed from public.service_closures
   where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and starts_on = '2026-07-06';
  perform pg_temp.expect(v_claimed = false,
    'a closure recorded without saying otherwise is NOT claimable (0091)');
end $$;

-- Still owner-or-manager to write, unchanged by 0091: the new columns are covered by 0088's
-- policies because the table is not column-scoped. Asserted rather than assumed, since a
-- column added to a table with column-level grants would have needed its own grant (0047).
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare n integer;
begin
  update public.service_closures set claimed_as_emergency = true, ero_approval = 'approved'
   where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and starts_on = '2026-07-06';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0,
    'an educator CANNOT turn a term break into an approved emergency closure (0091)');
end $$;

-- And an educator can still READ them, which 0088 established and 0091 must not narrow.
select pg_temp.expect(
  (select count(*) from public.service_closures) > 0,
  'an educator still reads closures after 0091 added columns (0091)'
);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- `anon` is stopped by the GRANT, before any policy runs.
do $$
declare code text := 'none';
begin
  set local role anon;
  begin
    perform 1 from public.service_closures;
  exception when others then code := sqlstate;
  end;
  set local role authenticated;
  perform pg_temp.expect(code = '42501', 'anon is refused by the GRANT on service_closures, got ' || code);
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- ===========================================================================
-- 0087 — the rest of §6-1: the other-service hours, and the dated parent signature
--
-- The assertions that matter here are NOT about policies. Every column added by 0087 sits
-- on a table whose policies were settled long ago, and the new surface is a TRIGGER:
-- `assert_signatories_are_guardians` refuses a signature attributed to somebody who is not
-- a current guardian of that child. A foreign key to `guardians` cannot express that — it
-- would happily accept another centre's parent — so what is asserted below is the thing the
-- foreign key does not say.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Ana's mother signs Ana's enrolment record. The ordinary case, and it has to work before
-- any refusal below means anything.
do $$
declare n integer;
begin
  update public.enrolments
     set signed_on = current_date,
         signed_by = 'd1111111-1111-4111-8111-111111111111'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a guardian of the child CAN be recorded as signing the enrolment record (0087)');
end $$;

-- A guardian with no app account signs just as well. `guardians.user_id` is nullable so a
-- grandparent on the collection list can exist, and 0084 pointing this class of column at
-- `auth.users` is exactly what 0087 corrects — so the grandmother is the row that proves the
-- correction was the right one.
do $$
declare n integer;
begin
  update public.enrolments
     set signed_on = current_date,
         signed_by = 'd3333333-3333-4333-8333-333333333333'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a guardian with NO app account can sign - the 0084 correction (0087)');
end $$;

/*
 * THE ASSERTION THE TRIGGER EXISTS FOR. Quinn is Beau's father: a real guardian, at this
 * same centre, with an account and a parent membership — and not Ana's guardian. The foreign
 * key accepts him. Nothing else in this schema would object to a signature on Ana's
 * enrolment record attributed to another family's parent.
 */
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments
       set signed_on = current_date,
           signed_by = 'd2222222-2222-4222-8222-222222222222'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'ANOTHER FAMILY''S guardian cannot be recorded as signing this child''s record, got ' || code);
end $$;

/*
 * And the tenancy case, which is the reason the trigger was written rather than left to the
 * foreign key. Centre B's owner creates a guardian in their own centre — a legitimate write
 * under their own policies — and centre A's owner then tries to record that person as having
 * signed a centre A child's enrolment. Same trigger branch as Quinn above, different claim:
 * this one is about a tenant boundary rather than about the right family.
 */
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
insert into public.guardians (id, centre_id, full_name)
values ('d9999999-9999-4999-8999-999999999999', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Other Centre Parent');

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments
       set signed_on = current_date,
           signed_by = 'd9999999-9999-4999-8999-999999999999'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'ANOTHER CENTRE''S guardian cannot be recorded as a signatory - the foreign key would accept them, got ' || code);
end $$;

-- Half a signature is refused rather than stored: a date with nobody attached says an
-- attestation happened without saying who made it, which is worse than no record at all.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments set signed_on = current_date, signed_by = null
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a signature date with no signatory is refused, got ' || code);
end $$;

/*
 * REVOKING A GUARDIANSHIP DOES NOT MAKE THE ROW UNEDITABLE, and this is the assertion for
 * the guard rather than for the rule. The trigger validates only when the signatory is set
 * or changed; without that, revoking Priya would make every later update of an unrelated
 * column on this enrolment fail — a row nobody could edit because of something true about a
 * person who signed it last year. The signature itself deliberately stands: it records what
 * happened on a date, and revoking a guardianship afterwards does not un-sign it.
 */
do $$
declare n integer;
begin
  update public.enrolments
     set signed_on = current_date, signed_by = 'd1111111-1111-4111-8111-111111111111'
   where child_id = 'a1111111-1111-4111-8111-111111111111';

  update public.child_guardians set revoked_at = now()
   where child_id = 'a1111111-1111-4111-8111-111111111111'
     and guardian_id = 'd1111111-1111-4111-8111-111111111111';

  update public.enrolments set notes = 'edited after the guardianship was revoked'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1,
    'revoking a guardianship does NOT make an already-signed enrolment uneditable (0087)');

  -- And put it back, because every later assertion in this suite assumes Priya is still
  -- Ana's guardian. A fixture edited mid-suite that is not undone is how an unrelated
  -- assertion fails three hundred lines later for a reason nobody can find.
  update public.child_guardians set revoked_at = null
   where child_id = 'a1111111-1111-4111-8111-111111111111'
     and guardian_id = 'd1111111-1111-4111-8111-111111111111';
end $$;

-- A revoked guardian cannot sign something NEW, which is the other half of the same rule.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  update public.child_guardians set revoked_at = now()
   where child_id = 'a1111111-1111-4111-8111-111111111111'
     and guardian_id = 'd3333333-3333-4333-8333-333333333333';
  begin
    update public.enrolments
       set signed_on = current_date, signed_by = 'd3333333-3333-4333-8333-333333333333'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  update public.child_guardians set revoked_at = null
   where child_id = 'a1111111-1111-4111-8111-111111111111'
     and guardian_id = 'd3333333-3333-4333-8333-333333333333';
  perform pg_temp.expect(code = '23514', 'a REVOKED guardian cannot sign something new, got ' || code);
end $$;

-- The 0084 correction, exercised through the column it corrects. A guardian id is now
-- accepted where an `auth.users` id used to be required.
do $$
declare n integer;
begin
  update public.enrolments
     set twenty_hours_attested_on = current_date,
         twenty_hours_attested_by = 'd1111111-1111-4111-8111-111111111111'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'the 20 Hours attestation now names a GUARDIAN - 0084 corrected (0087)');
end $$;

-- And a caller's own user id is no longer accepted there, which is the point of the
-- correction. The trigger refuses it before the foreign key is ever consulted.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments
       set twenty_hours_attested_on = current_date,
           twenty_hours_attested_by = '11111111-1111-4111-8111-111111111111'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a staff USER id is no longer accepted as the 20 Hours attesting party, got ' || code);
end $$;

-- The other-service hours: null and zero are both storable and they are different answers.
-- 6-1 wants the figure "including none if appropriate", so "attested as none" and "nobody
-- asked" cannot collapse into each other.
do $$
declare n integer; v numeric;
begin
  update public.enrolments set hours_at_other_service_per_week = 0
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  select hours_at_other_service_per_week into v from public.enrolments
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  perform pg_temp.expect(n = 1 and v = 0 and v is not null,
    'ZERO hours at another service is a recorded answer, not an absent one (0087)');
end $$;

-- Out of band is refused, on the same sanity bound `funded_hours_per_week` already uses.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments set hours_at_other_service_per_week = 60
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'an implausible other-service figure is refused, got ' || code);
end $$;

-- The trigger function is granted to NOBODY. A trigger does not need EXECUTE to fire, so a
-- grant would only widen the surface — and "granted to nobody" is one dropped revoke away
-- from "granted to everyone signed in", which nothing else would notice. Same assertion
-- shape as kiosk_pin_gate (0062) and report_absence_core (0063).
do $$
declare code text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.assert_signatories_are_guardians();
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'assert_signatories_are_guardians is callable by nobody directly, got ' || code);
end $$;

-- An educator still cannot sign anything, which is the policy rather than the trigger: the
-- trigger would have accepted Priya, and `caller_may_enrol` never lets the statement run.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare n integer;
begin
  update public.enrolments
     set signed_on = current_date, signed_by = 'd1111111-1111-4111-8111-111111111111'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'an educator CANNOT record a signature on an enrolment (0087)');
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- Leave the fixture as it was found: the signature columns are cleared so that later
-- assertions counting or comparing enrolment rows see what they were written against.
update public.enrolments
   set signed_on = null, signed_by = null,
       twenty_hours_attested_on = null, twenty_hours_attested_by = null,
       hours_at_other_service_per_week = null,
       notes = null
 where child_id = 'a1111111-1111-4111-8111-111111111111';

-- ===========================================================================
-- 0085 — the child booking schedule: the enrolment agreement as a pattern
--
-- The table §6-5 and §6-7 need, and the one ELI calls `ChildBookingSchedule`. Keyed on the
-- child rather than the enrolment, because the XSD is and because `audit_trigger()` can
-- resolve a centre from `child_id`.
--
-- The boundary that matters here is the one INSIDE a centre, not between centres. An
-- educator may read a child's record and must not be able to rewrite the agreement the
-- child's funding rests on — that is what `caller_may_enrol` narrows and what a policy
-- keyed on `caller_is_staff_for_child` would have got wrong.
-- ===========================================================================

set local role postgres;
insert into public.child_booking_schedule (child_id, weekday, from_time, to_time, effective_from)
values ('a1111111-1111-4111-8111-111111111111', 2, '08:00', '15:00', '2026-02-01');
set local role authenticated;

-- The owner writes it. Positive first: a negative alone passes just as happily when the
-- table is unwritable by everybody.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare n integer;
begin
  insert into public.child_booking_schedule (child_id, weekday, from_time, to_time, effective_from)
  values ('a1111111-1111-4111-8111-111111111111', 3, '08:00', '15:00', '2026-02-01');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN record a booking schedule for their own child (0085)');
end $$;

-- Split sessions on one weekday are legal: the XSD allows more than one block per day
-- (maxOccurs unbounded) and a sessional service is the case it exists for.
do $$
declare n integer;
begin
  insert into public.child_booking_schedule (child_id, weekday, from_time, to_time, effective_from)
  values ('a1111111-1111-4111-8111-111111111111', 3, '15:30', '17:30', '2026-02-01');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'two non-overlapping blocks on one weekday are allowed (0085)');
end $$;

-- Overlapping the same minute of the same weekday is not. Double-counting an agreement is
-- the same class of error as an overlapping enrolment.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.child_booking_schedule (child_id, weekday, from_time, to_time, effective_from)
    values ('a1111111-1111-4111-8111-111111111111', 3, '14:00', '16:00', '2026-02-01');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01',
    'an overlapping block on the same weekday is refused, got ' || code);
end $$;

-- And an OPEN-ENDED block blocks a later overlapping one until it is closed, because a null
-- `effective_to` is infinity in the exclusion constraint. This is the behaviour that
-- surprised 0081's author, asserted here so the next person meets it as a test rather than
-- as a puzzle.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.child_booking_schedule (child_id, weekday, from_time, to_time, effective_from)
    values ('a1111111-1111-4111-8111-111111111111', 2, '08:00', '15:00', '2027-06-01');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23P01',
    'an open-ended block blocks a later overlapping one until closed, got ' || code);
end $$;

-- Closing it first makes the same insert legal, which is how an agreement is changed —
-- exactly what §6-7 requires when attendance stops matching it.
do $$
declare n integer;
begin
  update public.child_booking_schedule set effective_to = '2027-05-31'
   where child_id = 'a1111111-1111-4111-8111-111111111111' and weekday = 2;
  insert into public.child_booking_schedule (child_id, weekday, from_time, to_time, effective_from)
  values ('a1111111-1111-4111-8111-111111111111', 2, '08:00', '15:00', '2027-06-01');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'closing a block then adding the next is how an agreement changes (0085)');
end $$;

-- The audit row is asserted, not assumed. 0059's failure mode was three tables carrying
-- triggers that wrote nothing for months because audit_trigger() could not resolve a centre.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'child_booking_schedule' and action = 'insert') >= 1,
  'writing a booking schedule leaves an audit row — audit_trigger resolves child_id (0085)'
);

-- The other centre cannot see it.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_booking_schedule) = 0,
  'another centre CANNOT read this centre''s booking schedules (0085)'
);

-- THE ASSERTION THIS TABLE'S POLICY EXISTS FOR. An educator reads the agreement — they run
-- the room and need to know who is expected — and cannot change it, because the funded hours
-- claimed for an absence are derived from it.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_booking_schedule) > 0,
  'an educator CAN read the booking schedule for a child at their centre (0085)'
);
/*
  ONE row, and shrinking. The first version of this assertion updated every row for the
  child and set `to_time` LATER, which — when the policy was deliberately weakened to drill
  it — made two blocks on weekday 3 overlap, so the exclusion constraint raised before
  `expect` was reached. The suite went red, which is something, but not on this assertion
  and not with this message.

  A negative assertion has to fail for ITS OWN reason when the thing it guards is removed.
  Narrowing one block cannot collide with anything, so a permitted write here shows up as
  `n = 1` and nothing else.
*/
do $$
declare n integer;
begin
  update public.child_booking_schedule set from_time = '09:00'
   where child_id = 'a1111111-1111-4111-8111-111111111111'
     and weekday = 3 and from_time = '08:00';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0,
    'an educator CANNOT rewrite the enrolment agreement — caller_may_enrol, not caller_is_staff_for_child (0085)');
end $$;

-- A parent reads their own child's agreement. It is their agreement: §6-7's reconfirmation
-- is signed and dated by them.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_booking_schedule) > 0,
  'a guardian CAN read their own child''s booking schedule (0085)'
);
do $$
declare n integer;
begin
  update public.child_booking_schedule set from_time = '09:00'
   where child_id = 'a1111111-1111-4111-8111-111111111111'
     and weekday = 3 and from_time = '08:00';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'a guardian CANNOT change the agreement themselves (0085)');
end $$;

-- The other parent, whose child is at the same centre, reads nothing. The in-centre
-- guardianship boundary, which is the harder of the two.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.child_booking_schedule) = 0,
  'a guardian of a DIFFERENT child at the same centre reads no schedule (0085)'
);

-- `anon` is stopped by the grant, before any policy runs.
do $$
declare code text := 'none';
begin
  set local role anon;
  begin
    perform 1 from public.child_booking_schedule;
  exception when others then code := sqlstate;
  end;
  set local role authenticated;
  perform pg_temp.expect(code = '42501', 'anon is refused by the GRANT on child_booking_schedule, got ' || code);
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- A half-recorded attestation is worse than none: a date with nobody's name against it
-- reads, in an audit, as though somebody attested and we lost who. Same paired-completeness
-- shape as `immunisation_sighting_complete` in 0036.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.enrolments set twenty_hours_attested_on = '2026-03-01'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'an attestation date with no signatory is refused, got ' || code);
end $$;

/*
 * And the pair together is accepted, which is the half a negative cannot prove.
 *
 * THE SIGNATORY CHANGED UNDER THIS ASSERTION ON 2026-09-04 and it is worth saying why rather
 * than quietly editing the uuid. It used to name `11111111-…`, the OWNER'S USER ID, because
 * 0084 pointed `twenty_hours_attested_by` at `auth.users` — and that was the defect 0087
 * corrects: a 20 Hours attestation is signed by a parent, who may have no account at all.
 * So this now names Ana's mother.
 *
 * The suite caught it by failing, which is the outcome to want: an assertion whose premise a
 * migration has falsified should stop the build rather than keep passing against the old
 * world. The one to watch for is the version that does NOT fail.
 */
do $$
declare n integer;
begin
  update public.enrolments
     set twenty_hours_attested_on = '2026-03-01',
         twenty_hours_attested_by = 'd1111111-1111-4111-8111-111111111111'
   where child_id = 'a1111111-1111-4111-8111-111111111111';
  get diagnostics n = row_count;
  perform pg_temp.expect(n >= 1, 'a dated attestation with a signatory is accepted (0084)');

  update public.enrolments
     set twenty_hours_attested_on = null, twenty_hours_attested_by = null
   where child_id = 'a1111111-1111-4111-8111-111111111111';
end $$;

-- Filing a child's enrolment against the operator's other site would put the
-- funded hours in the wrong roll return.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.enrolments (child_id, centre_id, start_date)
    values ('c3333333-3333-4333-8333-333333333333',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', current_date);
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'an enrolment CANNOT be filed against the wrong centre, got ' || code);
end $$;

-- ---------------------------------------------------------------------------
-- Two sites, one operator: the check the plan asks for at the end of every phase
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.children) = 1,
  'staff at centre B see only centre B''s children'
);

select pg_temp.expect(
  (select count(*) from public.children
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'Mt Albert''s children are invisible from Mt Roskill'
);

select pg_temp.expect(
  (select count(*) from public.health_conditions) = 0,
  'and so are their medical records'
);

-- ===========================================================================
-- ATTENDANCE
--
-- Append-only, and the record a funding claim rests on. Three properties matter:
-- who may write it, that it cannot be rewritten, and that a retried offline flush
-- lands once. The last of those is the whole reason `client_uuid` exists.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.attendance_events (child_id, kind, at, client_uuid, recorded_by)
  values ('a1111111-1111-4111-8111-111111111111', 'in', now(),
          '00000000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an educator CAN sign a child in');
end $$;

-- The idempotency contract. A flush whose response was lost retries the same key.
do $$
declare n integer;
begin
  insert into public.attendance_events (child_id, kind, at, client_uuid, recorded_by)
  values ('a1111111-1111-4111-8111-111111111111', 'in', now(),
          '00000000-0000-4000-8000-000000000001', '55555555-5555-4555-8555-555555555555')
  on conflict (client_uuid) do nothing;
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 0, 'retrying the same client_uuid writes nothing');
end $$;

select pg_temp.expect(
  (select count(*) from public.attendance_events
    where client_uuid = '00000000-0000-4000-8000-000000000001') = 1,
  'so exactly one event exists after a double flush'
);

-- Attribution cannot be forged: a funding claim has to answer "who signed this in".
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.attendance_events (child_id, kind, at, client_uuid, recorded_by)
    values ('a1111111-1111-4111-8111-111111111111', 'in', now(),
            '00000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'attendance CANNOT be attributed to another person, got ' || code);
end $$;

-- A sign-in dated into the future would let somebody pre-record attendance.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.attendance_events (child_id, kind, at, client_uuid)
    values ('a1111111-1111-4111-8111-111111111111', 'in', now() + interval '6 hours',
            '00000000-0000-4000-8000-000000000003');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a future-dated sign-in is refused, got ' || code);
end $$;

-- But a device with a slightly wrong clock still works.
do $$
declare n integer;
begin
  insert into public.attendance_events (child_id, kind, at, client_uuid)
  values ('b2222222-2222-4222-8222-222222222222', 'in', now() + interval '30 minutes',
          '00000000-0000-4000-8000-000000000004');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'half an hour of device clock skew is tolerated');
end $$;

-- Backdating attendance is how a funding claim becomes fraud.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.attendance_events (child_id, kind, at, client_uuid)
    values ('a1111111-1111-4111-8111-111111111111', 'in', now() - interval '20 days',
            '00000000-0000-4000-8000-000000000005');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'attendance cannot be backdated a fortnight, got ' || code);
end $$;

-- A correction is a new row, and it has to say why.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.attendance_events (child_id, kind, at, client_uuid, corrects)
    values ('a1111111-1111-4111-8111-111111111111', 'in', now(),
            '00000000-0000-4000-8000-000000000006',
            (select id from public.attendance_events
              where client_uuid = '00000000-0000-4000-8000-000000000001'));
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514', 'a correction without a reason is refused, got ' || code);
end $$;

-- Append-only, enforced at both layers as with the audit log.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.attendance_events set kind = 'out'
     where client_uuid = '00000000-0000-4000-8000-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'attendance CANNOT be updated, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.attendance_events
     where client_uuid = '00000000-0000-4000-8000-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'attendance CANNOT be deleted, got ' || code);
end $$;

-- The derived roll, which is computed and never stored.
select pg_temp.expect(
  (select kind::text from public.attendance_today
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 'in',
  'attendance_today shows the child as present'
);

/*
 * 0026: a corrected event must not decide the roll — and the case that matters is the one where
 * the correction moves the time BACKWARDS.
 *
 * A correction carries the time the event should have had, so fixing a sign-in that was recorded at
 * 15:00 to its real 08:05 inserts a row with an EARLIER `at` than the row it supersedes. The view
 * ordered by `at desc`, so it preferred the superseded row — meaning the correction was ignored in
 * exactly the common case: somebody noticing in the afternoon that a child was never signed in.
 *
 * Written as the owner so the fixture is not the thing under test, then read back as the educator.
 */
set local role postgres;

/*
 * Times derived from the child's own latest event, not from midnight.
 *
 * A first attempt anchored these to `centre_day_start + N hours`, which made the assertion depend
 * on what time of day the suite happened to run — in the first hours of an NZ day the fixture's own
 * sign-in was still the latest event and the test failed for a reason that had nothing to do with
 * corrections. Relative offsets make the ordering a property of the fixture instead of the clock.
 *
 * Required order: existing sign-in < the correction < the superseded row it replaces. That is the
 * shape that catches the bug, because `order by at desc` prefers the superseded row.
 */
insert into public.attendance_events (id, child_id, kind, at, recorded_by, client_uuid)
select 900001, 'a1111111-1111-4111-8111-111111111111', 'out',
       max(ae.at) + interval '2 minutes',
       '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000901'
  from public.attendance_events ae
 where ae.child_id = 'a1111111-1111-4111-8111-111111111111';

-- `attendance_correction_has_note` requires a reason on any row carrying `corrects`, which is why
-- this one has one and the original does not.
insert into public.attendance_events (id, child_id, kind, at, recorded_by, client_uuid, corrects, note)
select 900002, 'a1111111-1111-4111-8111-111111111111', 'out',
       (select at from public.attendance_events where id = 900001) - interval '1 minute',
       '11111111-1111-4111-8111-111111111111', '00000000-0000-4000-8000-000000000902', 900001,
       'Signed out at the wrong time; corrected to when they actually left.';

select pg_temp.expect(
  (select event_id from public.attendance_today
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 900002,
  'attendance_today returns the CORRECTION, not the later event it supersedes'
);

/*
 * And the id it hands back is the one a further correction should point at. Without this the next
 * correction attaches to an already-superseded event, the chain becomes two siblings, and
 * `resolveCorrections` then drops the original while leaving both corrections live.
 */
select pg_temp.expect(
  not exists (
    select 1 from public.attendance_today
     where child_id = 'a1111111-1111-4111-8111-111111111111'
       and event_id = 900001
  ),
  'and never hands back an event that something corrects'
);

-- Cleaned up so the assertions after this see the roll they expect.
delete from public.attendance_events where id in (900001, 900002);

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- A guardian signs their own child in, because in New Zealand the attendance record
-- underpinning a funding claim carries a parent's signature.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.attendance_events (child_id, kind, at, client_uuid, recorded_by)
  values ('a1111111-1111-4111-8111-111111111111', 'out', now(),
          '00000000-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a guardian CAN sign their own child out');
end $$;

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.attendance_events (child_id, kind, at, client_uuid, recorded_by)
    values ('b2222222-2222-4222-8222-222222222222', 'in', now(),
            '00000000-0000-4000-8000-000000000008', '33333333-3333-4333-8333-333333333333');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'a guardian CANNOT sign another family''s child in, got ' || code);
end $$;

select pg_temp.expect(
  (select count(*) from public.attendance_events
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 0,
  'and cannot read another family''s attendance either'
);

-- Two sites, one operator.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.attendance_events) = 0,
  'centre B sees none of centre A''s attendance'
);
select pg_temp.expect(
  (select count(*) from public.attendance_today) = 0,
  'and none of its present roll'
);

-- ===========================================================================
-- POSTS, MEDIA AND THE CONSENT GATE
--
-- The gate is two mechanisms and both are asserted: a trigger that refuses an attachment, and a
-- RESTRICTIVE policy that re-checks on every read so withdrawing consent hides existing media.
--
-- The restrictive policy exists because the first version put the check inside the permissive
-- `media_select` and separately declared `media_write` as FOR ALL. FOR ALL covers SELECT, and
-- permissive policies are OR-ed — so staff matched the write policy and the consent check never
-- had to be satisfied. It hid correctly from whānau, which is what made it survive review.
-- ===========================================================================

set local role postgres;

-- Beau's whānau grant photo consent; Ana's do not (the Phase 1 section withdrew it).
insert into public.consent_events (child_id, kind, granted, given_by, recorded_by)
values ('b2222222-2222-4222-8222-222222222222', 'photo_internal', true,
        'd2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
  values ('11111111-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'learning_moment', 'Tower building', 'Beau built a tower.',
          '55555555-5555-4555-8555-555555555555', now());
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an educator CAN publish a learning moment');
end $$;

insert into public.post_children (post_id, child_id)
values ('11111111-aaaa-4aaa-8aaa-000000000001', 'b2222222-2222-4222-8222-222222222222');

insert into public.media (id, centre_id, post_id, kind, audience, storage_path, uploaded_by)
values ('22222222-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-aaaa-4aaa-8aaa-000000000001', 'photo', 'journal',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/suite-1.jpg',
        '55555555-5555-4555-8555-555555555555');

-- Beau has consent.
do $$
declare n integer;
begin
  insert into public.media_children (media_id, child_id)
  values ('22222222-aaaa-4aaa-8aaa-000000000001', 'b2222222-2222-4222-8222-222222222222');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a child WITH photo consent can be tagged in media');
end $$;

-- Ana's was withdrawn earlier in this transaction. The trigger must refuse.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.media_children (media_id, child_id)
    values ('22222222-aaaa-4aaa-8aaa-000000000001', 'a1111111-1111-4111-8111-111111111111');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a child WITHOUT photo consent CANNOT be tagged, got ' || code);
end $$;

-- Public sharing is a different consent. Nobody in this fixture granted photo_public.
insert into public.media (id, centre_id, post_id, kind, audience, storage_path, uploaded_by)
values ('22222222-aaaa-4aaa-8aaa-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-aaaa-4aaa-8aaa-000000000001', 'photo', 'public',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/suite-2.jpg',
        '55555555-5555-4555-8555-555555555555');

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.media_children (media_id, child_id)
    values ('22222222-aaaa-4aaa-8aaa-000000000002', 'b2222222-2222-4222-8222-222222222222');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'journal consent does NOT authorise public sharing, got ' || code);
end $$;

-- Widening an existing item re-opens the question.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.media set audience = 'public'
     where id = '22222222-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'an existing journal item CANNOT be widened to public, got ' || code);
end $$;

select pg_temp.expect(
  (select count(*) from public.media where id = '22222222-aaaa-4aaa-8aaa-000000000001') = 1,
  'staff can see media while consent holds'
);

-- THE RESTRICTIVE POLICY. Withdraw and it disappears, for staff as well.
set local role postgres;
insert into public.consent_events (child_id, kind, granted, given_by, recorded_by)
values ('b2222222-2222-4222-8222-222222222222', 'photo_internal', false,
        'd2222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.media where id = '22222222-aaaa-4aaa-8aaa-000000000001') = 0,
  'withdrawing consent hides existing media from STAFF, not only from whānau'
);

-- And staff must still be able to delete what they can no longer read, which is why the
-- restrictive policy is scoped to SELECT.
do $$
declare n integer;
begin
  delete from public.media where id = '22222222-aaaa-4aaa-8aaa-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'but staff CAN still delete media they can no longer read');
end $$;

-- The oracle is not granted: "does child X have photo consent" is not a question anybody may ask
-- directly.
do $$
declare code text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.child_consent_for_audience('b2222222-2222-4222-8222-222222222222', 'journal');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'child_consent_for_audience is NOT callable by a user, got ' || code);
end $$;

-- A parent sees a pānui and a post about their own child, and neither a draft nor another
-- family's learning moment.
set local role postgres;
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
values ('11111111-aaaa-4aaa-8aaa-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'Closed Monday', 'Public holiday.',
        '11111111-1111-4111-8111-111111111111', now()),
       ('11111111-aaaa-4aaa-8aaa-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'Draft notice', 'Not finished.',
        '11111111-1111-4111-8111-111111111111', null);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.posts
    where id = '11111111-aaaa-4aaa-8aaa-000000000002') = 1,
  'a parent sees a published pānui'
);

select pg_temp.expect(
  (select count(*) from public.posts
    where id = '11111111-aaaa-4aaa-8aaa-000000000003') = 0,
  'and CANNOT see an unpublished draft'
);

select pg_temp.expect(
  (select count(*) from public.posts
    where id = '11111111-aaaa-4aaa-8aaa-000000000001') = 0,
  'and CANNOT see a learning moment about another family''s child'
);

-- Centre B sees none of it.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.posts
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'centre B sees none of centre A''s posts'
);

-- ===========================================================================
-- MESSAGES
-- ===========================================================================

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- A parent starting a thread is the point of the feature: a centre that can message families and
-- cannot be messaged back has built a broadcast channel.
do $$
declare n integer;
begin
  insert into public.message_threads (id, centre_id, child_id, subject, started_by)
  values ('33333333-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'a1111111-1111-4111-8111-111111111111', 'Nap times',
          '33333333-3333-4333-8333-333333333333');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a parent CAN start a thread about their own child');
end $$;

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.message_threads (centre_id, child_id, subject, started_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
            'About your child', '33333333-3333-4333-8333-333333333333');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'but NOT about another family''s child, got ' || code);
end $$;

insert into public.messages (thread_id, author_id, body)
values ('33333333-aaaa-4aaa-8aaa-000000000001', '33333333-3333-4333-8333-333333333333',
        'Does she still nap after lunch?');

-- Append-only, both layers.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.messages set body = 'edited'
     where thread_id = '33333333-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'a message CANNOT be edited, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.messages where thread_id = '33333333-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'and CANNOT be deleted, got ' || code);
end $$;

-- Staff at the centre are in every thread, because a message to a family is centre business —
-- the person who wrote it may be on leave when the reply arrives.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.messages
    where thread_id = '33333333-aaaa-4aaa-8aaa-000000000001') = 1,
  'an educator sees a thread a parent started'
);

-- Another family must not.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.message_threads) = 0,
  'another family sees no thread about somebody else''s child'
);
select pg_temp.expect(
  (select count(*) from public.messages) = 0,
  'and none of its messages'
);

-- ===========================================================================
-- NOTIFICATIONS
-- ===========================================================================

set local role postgres;
insert into public.push_tokens (user_id, token) values
  ('33333333-3333-4333-8333-333333333333', 'ExponentPushToken[suite-parent]'),
  ('55555555-5555-4555-8555-555555555555', 'ExponentPushToken[suite-educator]');
insert into public.notifications (centre_id, user_id, kind, title, body)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333',
        'post', 'New learning moment', 'Ana built a tower.');

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.push_tokens) = 1,
  'a device token is visible only to the person it belongs to'
);

select pg_temp.expect(
  (select count(*) from public.notifications) = 1,
  'and a notification only to its recipient'
);

-- Not even a manager. The queue records what a specific family was told and when.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.notifications) = 0,
  'an owner CANNOT read a family''s notification history'
);
select pg_temp.expect(
  (select count(*) from public.push_tokens) = 0,
  'nor their device tokens'
);

-- Queueing means deciding who receives it, which is a service-role action.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.notifications (centre_id, user_id, kind, title, body)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333',
            'post', 'Forged', 'Not from the centre.');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'a user CANNOT put a notification in somebody else''s queue, got ' || code);
end $$;

-- ===========================================================================
-- STAFF RECORDS, CRITERIA AND EVIDENCE
--
-- The interesting one here is that an educator must be able to read their OWN police
-- vetting result and nobody else's. That is not a convenience — a vetting result is
-- personal information about the person it concerns, and the Privacy Act gives them a
-- right of access to it (IPP 6). A policy that hid it from them would put the product in
-- the way of a statutory right.
-- ===========================================================================

set local role postgres;

insert into public.staff_records (centre_id, user_id, person_name, kind, expires_on, sighted_by, sighted_at)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555',
   'Ed Educator', 'police_vetting', current_date + 200, '11111111-1111-4111-8111-111111111111', now()),
  -- Somebody else's record at the same centre, and a reliever with no account at all.
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111',
   'Alice Owner', 'first_aid', current_date + 30, '11111111-1111-4111-8111-111111111111', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null,
   'Rita Reliever', 'police_vetting', current_date - 10, null, null),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', null,
   'Bee Manager', 'first_aid', current_date + 100, null, null);

insert into public.evidence (centre_id, kind, title, added_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'policy', 'Evacuation procedure',
        '11111111-1111-4111-8111-111111111111');

-- The owner sees the centre's records.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.staff_records) = 3,
  'an owner sees every staff record at their centre, including relievers with no account'
);

select pg_temp.expect(
  (select count(*) from public.evidence) = 1,
  'and the evidence on file'
);

-- The educator: their own row, and only their own.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.staff_records) = 1,
  'an educator sees exactly one staff record'
);

select pg_temp.expect(
  (select person_name from public.staff_records) = 'Ed Educator',
  'and it is their own — IPP 6 gives them a right of access to it'
);

select pg_temp.expect(
  (select count(*) from public.staff_records where person_name = 'Alice Owner') = 0,
  'an educator CANNOT read a colleague''s vetting result'
);

-- Reading their own record is not editing it.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.staff_records set expires_on = current_date + 9999
     where person_name = 'Ed Educator';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501' or
    (select expires_on from public.staff_records where person_name = 'Ed Educator') <> current_date + 9999,
    'an educator CANNOT edit their own vetting record');
end $$;

-- Evidence is management-level. Some of what goes in a binder — staffing, governance —
-- is not an educator's to read.
select pg_temp.expect(
  (select count(*) from public.evidence) = 0,
  'an educator CANNOT read the evidence binder'
);

-- Criteria are published rules, not tenant data. Every centre reads the same set and
-- there is nothing confidential about a licensing criterion.
select pg_temp.expect(
  (select count(*) from public.criteria_sets) >= 0,
  'any signed-in user may read criteria sets'
);

-- A parent has no business in any of this.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_records) = 0,
  'a parent sees no staff records at all'
);
select pg_temp.expect(
  (select count(*) from public.evidence) = 0,
  'and no evidence'
);

-- Two sites.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_records) = 1,
  'centre B sees only its own staff records'
);
select pg_temp.expect(
  (select count(*) from public.staff_records where person_name = 'Ed Educator') = 0,
  'and none of centre A''s'
);

-- Sighting cannot be attributed to somebody else: the entire value of the field is that
-- a named person says they saw the document.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.staff_records (centre_id, person_name, kind, sighted_by, sighted_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Forged Sighting', 'first_aid',
            '22222222-2222-4222-8222-222222222222', now());
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'sighting CANNOT be attributed to another person, got ' || code);
end $$;

-- A lapsed certificate quietly removed is indistinguishable from one that never existed,
-- and "we held a current first aid certificate in March" is what a review asks.
do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.staff_records where person_name = 'Rita Reliever';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'a staff record CANNOT be deleted, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.evidence;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'evidence CANNOT be deleted, got ' || code);
end $$;

-- Importing a criteria set is a claim about what the law says, so it goes through a
-- reviewed script with the service role rather than a form anybody can reach.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.criteria_sets (name, source) values ('Invented', 'made up');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'an owner CANNOT import a criteria set through the API, got ' || code);
end $$;

-- ===========================================================================
-- BOOKINGS, WAITLIST AND BILLING
--
-- Money and planning. Two properties matter beyond the usual isolation: a family sees their own
-- invoices but not the centre's pricing or the waitlist, and an issued invoice cannot have its
-- lines changed — because altering what a family was billed after they were billed it is not an
-- edit, it is a different invoice.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.bookings (centre_id, child_id, on_date, status)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
          current_date, 'booked');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN book a child');
end $$;

-- A booking filed against the operator's other site would put the child in the wrong roll.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.bookings (centre_id, child_id, on_date, status)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b2222222-2222-4222-8222-222222222222',
            current_date + 1, 'booked');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'a booking CANNOT be filed against the wrong centre, got ' || code);
end $$;

-- Two bookings for one child on one day would double a roll and later an invoice.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.bookings (centre_id, child_id, on_date, status)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
            current_date, 'absent');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23505', 'a second booking for the same day is refused, got ' || code);
end $$;

-- An educator runs the room; booking has a fee attached and a licence capacity to respect.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.bookings (centre_id, child_id, on_date, status)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
            current_date + 2, 'booked');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'an educator CANNOT create a booking, got ' || code);
end $$;

-- The waitlist holds other families' names and their place in the queue.
set local role postgres;
insert into public.waitlist (centre_id, child_name, guardian_name, contact)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Waiting Child', 'Waiting Parent', '021 555 0000');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.waitlist) = 0,
  'an educator CANNOT read the waitlist'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.waitlist) = 0,
  'and a parent certainly cannot — it is a list of who is ahead of them'
);

-- A guardian sees their own child's booked days, so "am I down for Thursday" needs no phone call.
select pg_temp.expect(
  (select count(*) from public.bookings
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 0,
  'a parent sees no booking for another family''s child'
);

-- ---------------------------------------------------------------------------
-- PARENT-REPORTED ABSENCE (0051)
--
-- The first write a guardian may perform on the centre's own records, so the assertions
-- come in two halves and both matter:
--
--   1. the function does what it says, and
--   2. the TABLE IS STILL CLOSED to that guardian.
--
-- The second is the one that would be easy to lose. A future migration adding a
-- guardian-friendly policy to `bookings` would make every test in the first half keep
-- passing while opening a write path nobody designed. So the direct-UPDATE refusal is
-- asserted here rather than assumed from 0018.
--
-- Dates are `current_date ± 7` deliberately. The function reckons "today" in the CENTRE's
-- timezone and the session is UTC, so a booking on `current_date` is on the wrong side of
-- midnight for part of every day — a test written against it would pass in the morning
-- and fail in the evening. A week either side is unambiguous in both zones.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.bookings (centre_id, child_id, on_date, status, note)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
        current_date + 7, 'booked', 'Office note, not the parent''s to edit');

-- Beau's father. Guardian `d2222222`, app account `44444444`.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date + 7) = 'recorded',
  'a guardian marks their own child''s booked day as absent'
);

select pg_temp.expect(
  (select status from public.bookings
    where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 7)
    = 'absent',
  'and the booking is now absent'
);

/*
 * THE COLUMN THE FUNCTION EXISTS TO PROTECT.
 *
 * A policy permissive enough to allow the status change would also have allowed this
 * note to be rewritten — WITH CHECK sees only the NEW row and cannot say "nothing else
 * changed". Asserting the note survived is asserting that the definer function, and not
 * a policy, is the write path.
 */
select pg_temp.expect(
  (select note from public.bookings
    where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 7)
    = 'Office note, not the parent''s to edit',
  'and the office''s note on that booking is untouched'
);

-- A double tap is neither a success nor an error. Reporting it as success would hide it;
-- reporting it as failure would alarm somebody who did exactly the right thing.
select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date + 7) = 'already_absent',
  'reporting it twice says so, rather than lying either way'
);

-- The past is refused. Not about money — `absent` still charges — but about the integrity
-- of a record of a day that has already happened.
select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date - 7) = 'past',
  'a guardian CANNOT rewrite a day that has already been'
);

select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date + 30) = 'no_booking',
  'and a day the child is not booked has nothing to mark'
);

-- Another family's child, which is the boundary INSIDE the centre — both callers are
-- parents at the same service.
select pg_temp.expect(
  public.report_absence('a1111111-1111-4111-8111-111111111111', current_date + 7) = 'not_permitted',
  'a guardian CANNOT report an absence for a child who is not theirs'
);

/*
 * AND THE TABLE IS STILL CLOSED.
 *
 * `bookings_write` is owner and manager only, so this UPDATE matches no rows and reports
 * no error — a policy filters rather than raises. Asserted on the surviving value, since
 * "no exception" is what a refusal looks like from the client.
 */
do $$
declare v_status public.booking_status;
begin
  begin
    update public.bookings set status = 'cancelled', note = 'parent edited this'
     where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 7;
  exception when others then null;
  end;
  select status into v_status from public.bookings
   where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 7;
  perform pg_temp.expect(
    v_status = 'absent',
    'a guardian CANNOT update a booking directly — the function is the whole write path, got '
      || coalesce(v_status::text, 'no row')
  );
end $$;

-- Nor insert one. Booking is office work because a booking carries a fee and the centre
-- has a licence capacity to respect.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.bookings (centre_id, child_id, on_date, status)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
            current_date + 14, 'booked');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor can a guardian book a day — that is still office work');
end $$;

/*
 * `cancelled` IS NOT REACHABLE, AND IT IS THE ONE THAT MOVES MONEY.
 *
 * 0018: absent = did not attend, usually still charged; cancelled = withdrawn in time.
 * The function writes the literal `'absent'` and nothing else, which is what makes it
 * safe to hand to a guardian at all. A cancelled booking is also not something they may
 * re-mark.
 */
set local role postgres;
insert into public.bookings (centre_id, child_id, on_date, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222',
        current_date + 21, 'cancelled');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date + 21) = 'not_bookable',
  'a CANCELLED booking is not a guardian''s to re-mark — that is the status that moves money'
);

/*
 * The write is audited without the function asking, because `bookings` carries the shared
 * trigger. A parent-made change to the centre's own records that left no trace would be
 * the worst version of this feature.
 *
 * CHECKED AS THE OWNER, AND THE FIRST VERSION OF THIS WAS WRONG BECAUSE IT WAS NOT.
 *
 * Written first as a count run by the parent, it failed — and the obvious reading was
 * "the trigger did not fire". It had fired. A parent cannot SELECT `audit_events` at all,
 * so the count was zero because of the policy on the reader, not because of a missing
 * row. An assertion whose subject cannot see its own evidence reports the wrong failure,
 * and it would have sent somebody looking for a bug in the trigger.
 */
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'bookings' and action = 'update'
      and actor_id = '44444444-4444-4444-8444-444444444444') >= 1,
  'a parent-reported absence is AUDITED, and attributed to the PARENT rather than the office'
);

-- And the parent cannot read that record of their own action, which is the correct
-- asymmetry: the audit log holds every family's activity, not just theirs.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.audit_events) = 0,
  'and the parent cannot read the audit log, not even the entry they caused'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';


-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

set local role postgres;
insert into public.fee_schedules (centre_id, name, unit, amount_cents, gst_inclusive)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Full day', 'per_day', 6500, false);

insert into public.invoices (id, centre_id, guardian_id, reference, status, period_from, period_to,
                            issued_at, created_by)
values ('44444444-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'd1111111-1111-4111-8111-111111111111', 'INV-0001', 'issued',
        current_date - 30, current_date, now(), '11111111-1111-4111-8111-111111111111'),
       -- A draft for the same guardian, which they must NOT see.
       ('44444444-aaaa-4aaa-8aaa-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'd1111111-1111-4111-8111-111111111111', 'INV-0002', 'draft',
        current_date - 30, current_date, null, '11111111-1111-4111-8111-111111111111');

insert into public.invoice_lines (invoice_id, child_id, description, quantity, unit_cents)
values ('44444444-aaaa-4aaa-8aaa-000000000001', 'a1111111-1111-4111-8111-111111111111',
        'Full days', 8, 6500),
       -- A credit is a negative line, not a second table, so the total cannot disagree with itself.
       ('44444444-aaaa-4aaa-8aaa-000000000001', 'a1111111-1111-4111-8111-111111111111',
        'Credit: centre closed', -1, 6500);

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.invoices) = 1,
  'a guardian sees their ISSUED invoice'
);

select pg_temp.expect(
  (select reference from public.invoices) = 'INV-0001',
  'and not the draft — a half-built figure is not a bill'
);

-- A total with no breakdown is one nobody can check, and checking it is the point.
select pg_temp.expect(
  (select count(*) from public.invoice_lines) = 2,
  'and can read the lines it is made of, including the credit'
);

select pg_temp.expect(
  (select total_cents from public.invoice_totals
    where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001') = 45500,
  'the derived total is 7 × $65 = $455.00, credit included'
);

-- Pricing is the centre's own business; families see amounts on their invoice.
select pg_temp.expect(
  (select count(*) from public.fee_schedules) = 0,
  'a guardian CANNOT read the fee schedule'
);

-- ---------------------------------------------------------------------------
-- FUNDING RECEIPTS (0046) — what the Ministry actually paid
--
-- The centre's money against the Crown's. No guardian branch at all, unlike `invoices`,
-- which is why one `FOR ALL` policy covers reads and writes: there is no reader here who
-- is not also a writer.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.funding_receipts
  (id, centre_id, period_label, period_from, period_to, claimed_cents, received_cents, received_on, recorded_by)
values ('55555555-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Feb-Mar 2026', current_date - 60, current_date - 30, 1200000, 1150000,
        current_date - 20, '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select claimed_cents - received_cents from public.funding_receipts
    where id = '55555555-aaaa-4aaa-8aaa-000000000001') = 50000,
  'an owner records a claim and a receipt, and the variance is $500.00 short'
);

-- Null is the useful state, not an unfinished one: a centre often knows what arrived
-- before it can find what it claimed.
insert into public.funding_receipts
  (centre_id, period_label, period_from, period_to, received_cents, received_on)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Apr-May 2026',
        current_date - 30, current_date, 900000, current_date - 5);

select pg_temp.expect(
  (select count(*) from public.funding_receipts where claimed_cents is null) = 1,
  'and a receipt with no stated claim is accepted rather than refused'
);

-- Money without a date cannot be matched to a bank statement.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.funding_receipts
      (centre_id, period_label, period_from, period_to, received_cents, received_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Undated',
            current_date - 10, current_date, 500000, null);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'money received with no date is refused — it cannot be reconciled');
end $$;

-- One row per period. A wash-up updates the running total; a second row would double it.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.funding_receipts
      (centre_id, period_label, period_from, period_to, received_cents, received_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Feb-Mar 2026',
            current_date - 60, current_date - 30, 50000, current_date);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a second row for the same period is refused — the wash-up updates the first');
end $$;

-- The wash-up itself, and the audit trail that stands in for the itemisation this table
-- deliberately does not keep.
update public.funding_receipts
   set received_cents = 1200000, received_on = current_date
 where id = '55555555-aaaa-4aaa-8aaa-000000000001';

select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'funding_receipts'
      and entity_id = '55555555-aaaa-4aaa-8aaa-000000000001'
      and action = 'update') = 1,
  'a wash-up is AUDITED — the itemisation this table does not keep lives in the audit log'
);

-- Nobody below the office. An educator has no reason to see the centre's funding
-- position, and a parent still less.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.funding_receipts) = 0,
  'an educator reads NO funding receipts'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.funding_receipts) = 0,
  'and a parent reads none either'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.funding_receipts
      (centre_id, period_label, period_from, period_to, received_cents, received_on)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Forged',
            current_date - 10, current_date, 1, current_date);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor can a parent record one');
end $$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.funding_receipts) = 0,
  'and another centre''s owner sees nothing at all'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- ARREARS (0045)
--
-- A view over the same rows, so the interesting question is not what it computes —
-- `@ece/core` does the ageing and is tested there — but whether `security_invoker`
-- carries the invoice boundary across it. A view that ran as its owner would hand
-- every centre's debts to anybody who could select from it.
-- ---------------------------------------------------------------------------

select pg_temp.expect(
  (select count(*) from public.invoice_arrears) = 1,
  'a guardian sees their own issued invoice in arrears'
);

select pg_temp.expect(
  (select paid_cents from public.invoice_arrears
    where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001') = 0
  and (select total_cents from public.invoice_arrears
    where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001') = 45500,
  'owing the full $455.00, because nothing has been paid against it'
);

select pg_temp.expect(
  (select count(*) from public.invoice_arrears
    where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000002') = 0,
  'and the DRAFT is absent — nothing is owed on an invoice nobody has issued'
);

-- Part payment moves the balance, and the view reads the payments rather than a stored
-- figure that would have to be kept in step with them.
set local role postgres;
insert into public.payments (invoice_id, amount_cents, paid_on, recorded_by)
values ('44444444-aaaa-4aaa-8aaa-000000000001', 20000,
        (now() at time zone 'Pacific/Auckland')::date,
        '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select paid_cents from public.invoice_arrears
    where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001') = 20000,
  'a part payment shows against the invoice without any stored balance to keep in step'
);

/*
 * THE ASSERTION THIS VIEW EXISTS FOR.
 *
 * `status` is a label somebody set; the payments are the fact. Marking an invoice paid
 * without the money arriving must NOT make the balance disappear — that is precisely
 * the row a centre needs to see, and a view filtering on the label could never show it.
 */
set local role postgres;
update public.invoices set status = 'paid'
 where id = '44444444-aaaa-4aaa-8aaa-000000000001';
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select total_cents - paid_cents from public.invoice_arrears
    where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001') = 25500,
  'an invoice MARKED PAID that is not paid still shows its balance — the view trusts the money'
);

set local role postgres;
update public.invoices set status = 'issued'
 where id = '44444444-aaaa-4aaa-8aaa-000000000001';
set local role authenticated;

-- Another family, and another centre.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.invoice_arrears) = 0,
  'another guardian at the same centre sees no arrears of theirs'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.invoice_arrears) = 0,
  'and another centre sees none at all'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- Another family's invoice.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.invoices) = 0,
  'another guardian sees no invoice of theirs'
);

-- Lines cannot be added to an issued invoice.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.invoice_lines (invoice_id, description, quantity, unit_cents)
    values ('44444444-aaaa-4aaa-8aaa-000000000001', 'Sneaky extra', 1, 9900);
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'a line CANNOT be added to an issued invoice, got ' || code);
end $$;

-- But a draft is still editable.
do $$
declare n integer;
begin
  insert into public.invoice_lines (invoice_id, description, quantity, unit_cents)
  values ('44444444-aaaa-4aaa-8aaa-000000000002', 'Full days', 4, 6500);
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a draft invoice CAN still be built up');
end $$;

-- A recorded receipt is a statement that money arrived; correcting one means a reversal.
insert into public.payments (invoice_id, amount_cents, recorded_by)
values ('44444444-aaaa-4aaa-8aaa-000000000001', 45500, '11111111-1111-4111-8111-111111111111');

do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.payments set amount_cents = 1
     where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'a payment CANNOT be edited, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.payments where invoice_id = '44444444-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'nor deleted, got ' || code);
end $$;

-- Two sites.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.invoices) = 0,
  'centre B sees none of centre A''s invoices'
);
select pg_temp.expect(
  (select count(*) from public.fee_schedules) = 0,
  'nor its pricing'
);
select pg_temp.expect(
  (select count(*) from public.bookings) = 0,
  'nor its bookings'
);

-- ===========================================================================
-- INCIDENTS (0030)
--
-- One table, two audiences, and the boundary between them runs *inside* a centre —
-- the hard kind. `caller_may_see_child` is true for staff and guardians alike, so
-- using it on this table would stream a half-written injury report to a family's
-- phone as a teacher typed it. The draft/final split is the product decision; these
-- are the assertions that make it a property rather than an intention.
--
-- Ana (a1111…) is at centre A. Priya (3333…, guardian d1111…) is her mother. Quinn
-- (4444…, guardian d2222…) is Beau's father and no relation. Ed (5555…) is an
-- educator at centre A. Bob (2222…) owns centre B.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.incidents
  (id, centre_id, child_id, kind, occurred_at, description, reported_by)
values
  ('e1111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a1111111-1111-4111-8111-111111111111',
   'injury', now() - interval '1 hour',
   'Grazed knee on the path by the sandpit.',
   '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.incidents
    where id = 'e1111111-1111-4111-8111-111111111111') = 1,
  'an educator can open a draft incident for a child at their centre'
);

-- A report filed against the wrong centre lands in the wrong binder. The child's
-- centre is the authority, not whatever the caller sent.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.incidents (centre_id, child_id, kind, occurred_at, description)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'a1111111-1111-4111-8111-111111111111',
            'injury', now(), 'Filed against the wrong centre.');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an incident CANNOT be filed against a centre that is not the child''s');
end $$;

-- THE ONE. A draft is working material.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.incidents
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'a parent CANNOT READ a draft incident about their own child'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.incidents) = 0,
  'an owner of another centre CANNOT READ the incident at all'
);

-- Finalise it, as the educator who wrote it.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
update public.incidents set status = 'final'
 where id = 'e1111111-1111-4111-8111-111111111111';

select pg_temp.expect(
  (select status from public.incidents
    where id = 'e1111111-1111-4111-8111-111111111111') = 'final',
  'an educator can finalise their own draft'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.incidents
    where id = 'e1111111-1111-4111-8111-111111111111') = 1,
  'and once final, the child''s own parent CAN read it'
);

-- Guardianship, not tenancy. Quinn is a parent at the same centre and no relation.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.incidents
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'another family at the SAME CENTRE cannot read it even when final'
);

/*
 * The acknowledgement, which is the only fact in this table the centre does not
 * author. Three ways it can go wrong and all three are asserted: a parent editing
 * the report itself, a parent acknowledging as somebody else, and staff recording
 * the family's acknowledgement for them.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    update public.incidents set description = 'It was nothing, really.'
     where id = 'e1111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT rewrite the description of an incident');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.incidents
       set acknowledged_at = now(),
           acknowledged_by = 'd2222222-2222-4222-8222-222222222222'
     where id = 'e1111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT acknowledge as a different guardian');
end $$;

update public.incidents
   set acknowledged_at = now(),
       acknowledged_by = 'd1111111-1111-4111-8111-111111111111'
 where id = 'e1111111-1111-4111-8111-111111111111';

select pg_temp.expect(
  (select acknowledged_by from public.incidents
    where id = 'e1111111-1111-4111-8111-111111111111')
    = 'd1111111-1111-4111-8111-111111111111',
  'the child''s own guardian CAN acknowledge it, attributed to themselves'
);

-- Final means final. An amendment is a new row carrying `supersedes`.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    update public.incidents set description = 'Actually it was a bruise.'
     where id = 'e1111111-1111-4111-8111-111111111111';
    ok := (select description from public.incidents
            where id = 'e1111111-1111-4111-8111-111111111111')
          <> 'Actually it was a bruise.';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a finalised incident CANNOT be edited, even by its author');
end $$;

/*
 * A DRAFT *CAN* BE CORRECTED, INCLUDING ITS ROOM — 0082.
 *
 * The assertion the edit path never had, and its absence cost the feature its whole
 * life. `0066` added `incidents.room_id`; `0030` had granted UPDATE **by column, on
 * purpose**, so that moving a report to a different child is refused by Postgres before
 * any policy runs; and `room_id` was never added to that list. `updateIncidentDraft`
 * always sends it, because the correction form has a room picker and a patch that
 * omitted the field could not clear one — so **every draft correction failed with
 * `42501 permission denied for table incidents` from 2026-08-28 until 0082.**
 *
 * Written as a functional check rather than a catalogue one deliberately. The catalogue
 * can say which columns are granted; only a write can say whether that set is the one
 * the application actually sends. A test that asserted the column list would have
 * passed on the day the column list was wrong.
 *
 * `room_id = null` is the app's ordinary case — no room chosen — and it exercises the
 * privilege exactly the same way, because assignment needs UPDATE on the column
 * whatever the value is.
 */
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.incidents
  (id, centre_id, child_id, kind, occurred_at, description, reported_by)
values
  ('e3333333-3333-4333-8333-333333333333',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a1111111-1111-4111-8111-111111111111',
   'injury', now() - interval '30 minutes',
   'Tripped on teh mat.',
   '55555555-5555-4555-8555-555555555555');

do $$
declare code text := 'none';
begin
  begin
    -- Exactly the column set `updateIncidentDraft` sends.
    update public.incidents
       set kind = 'injury',
           occurred_at = now() - interval '30 minutes',
           description = 'Tripped on the mat.',
           location = null,
           room_id = null,
           first_aid_given = null,
           witness_name = null
     where id = 'e3333333-3333-4333-8333-333333333333';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(
    code = 'none',
    'a DRAFT incident can be corrected with the column set the app sends, room_id included — got ' || code
  );
end $$;

select pg_temp.expect(
  (select description from public.incidents
    where id = 'e3333333-3333-4333-8333-333333333333') = 'Tripped on the mat.',
  'and the correction actually landed, rather than matching no rows'
);

-- Nobody deletes licensing evidence. The verb is revoked, so this is refused before
-- any policy is consulted — and it is revoked from `service_role` too.
do $$
declare ok boolean := false;
begin
  begin
    delete from public.incidents where id = 'e1111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE an incident — the verb is revoked, got 42501');
end $$;

select pg_temp.expect(
  (select count(*) from public.incidents
    where id = 'e1111111-1111-4111-8111-111111111111') = 1,
  'and it is still there, so the refusal was real rather than a filtered no-op'
);

-- Deliberately NOT cleaned up. The retention section below purges Ana, and this row
-- is the only thing in the schema that proves a cascade reaches a table from which
-- DELETE has been revoked for every role. See the assertion after the purge.

-- ===========================================================================
-- INCIDENT INVESTIGATIONS (0074)
--
-- The other half of the incident form. The boundary being tested is the deliberate
-- asymmetry: Priya CAN read the finalised incident above — she acknowledged it —
-- and must read not one line of its investigation, which is the centre's internal
-- follow-up. Ed is still the caller from the block above.
-- ===========================================================================

insert into public.incident_investigations
  (id, centre_id, incident_id, required, outcome, created_by)
values
  ('f0741111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'e1111111-1111-4111-8111-111111111111',
   true, 'Path resealed by the sandpit.',
   '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.incident_investigations
    where id = 'f0741111-1111-4111-8111-111111111111') = 1,
  'an educator can record the investigation of a finalised incident at their centre'
);

-- THE ONE. Same incident, same family, opposite answer to the report itself.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.incident_investigations) = 0,
  'a parent CANNOT READ the investigation of their own child''s final incident'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.incident_investigations (centre_id, incident_id, required)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'e1111111-1111-4111-8111-111111111111', false);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and a parent CANNOT WRITE one');
end $$;

-- Centre B: neither read it, nor pin an investigation of centre A's incident onto
-- centre B. The second is the mismatch the insert policy's EXISTS is for — Bob's
-- own centre satisfies the tenancy conjunct, and the incident lookup refuses.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.incident_investigations) = 0,
  'another centre cannot READ an investigation'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.incident_investigations (centre_id, incident_id, required)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'e1111111-1111-4111-8111-111111111111', true);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'an investigation cannot point at another centre''s incident, whatever centre_id it claims');
end $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- One row per incident, and the row is the decision.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.incident_investigations (centre_id, incident_id, required)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'e1111111-1111-4111-8111-111111111111', false);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'a SECOND investigation of the same incident is refused — the decision already exists');
end $$;

-- A WorkSafe date asserts a WorkSafe yes.
do $$
declare ok boolean := false;
begin
  begin
    update public.incident_investigations
       set worksafe_advised_on = '2026-08-29'
     where id = 'f0741111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'a date of advising WorkSafe is refused while worksafe_advised is not yes');
end $$;

update public.incident_investigations
   set worksafe_advised = true, worksafe_advised_on = '2026-08-29'
 where id = 'f0741111-1111-4111-8111-111111111111';
select pg_temp.expect(
  (select worksafe_advised_on is not null from public.incident_investigations
    where id = 'f0741111-1111-4111-8111-111111111111'),
  'saying the yes and the date together works — the follow-up stays editable'
);

-- The pair of ids sits outside the UPDATE grant, so an investigation cannot drift
-- to a different incident after the insert policy checked the match.
do $$
declare ok boolean := false;
begin
  begin
    update public.incident_investigations
       set incident_id = 'e1111111-1111-4111-8111-111111111111'
     where id = 'f0741111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'an investigation cannot be MOVED to a different incident — the column is outside the grant');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.incident_investigations
     where id = 'f0741111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE an investigation — the verb is revoked');
end $$;

select pg_temp.expect(
  (select count(*) from public.incident_investigations
    where id = 'f0741111-1111-4111-8111-111111111111') = 1,
  'and it is still there, so the refusal was real rather than a filtered no-op'
);

-- ===========================================================================
-- MEDICATION ADMINISTRATION (0032)
--
-- `medication_authorities` records that a guardian said yes. This records that
-- somebody then gave the child something. Append-only, so the interesting
-- assertions are the refusals: outside the authorised window, against the wrong
-- child's authority, and the two verbs nobody holds.
-- ===========================================================================

set local role postgres;
insert into public.medication_authorities
  (id, child_id, medicine, dose, authorised_by, starts_on, expires_on)
values
  ('f1111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   'Amoxicillin', '5ml', 'd1111111-1111-4111-8111-111111111111',
   ((now() at time zone 'Pacific/Auckland')::date - 1),
   ((now() at time zone 'Pacific/Auckland')::date + 5)),
  -- Beau's, used to prove an administration cannot cite another child's authority.
  ('f2222222-2222-4222-8222-222222222222',
   'b2222222-2222-4222-8222-222222222222',
   'Paracetamol', '2.5ml', 'd2222222-2222-4222-8222-222222222222',
   ((now() at time zone 'Pacific/Auckland')::date - 1),
   ((now() at time zone 'Pacific/Auckland')::date + 5)),
  -- Expired yesterday. The window is the point of the table.
  ('f3333333-3333-4333-8333-333333333333',
   'a1111111-1111-4111-8111-111111111111',
   'Ibuprofen', '5ml', 'd1111111-1111-4111-8111-111111111111',
   ((now() at time zone 'Pacific/Auckland')::date - 10),
   ((now() at time zone 'Pacific/Auckland')::date - 1));

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.medication_administrations
  (authority_id, child_id, given_at, dose_given, given_by, client_uuid)
values
  ('f1111111-1111-4111-8111-111111111111',
   'a1111111-1111-4111-8111-111111111111',
   now() - interval '30 minutes', '5ml',
   '55555555-5555-4555-8555-555555555555',
   '0e111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.medication_administrations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'an educator can record a dose inside the authorised window'
);

-- The window. An authority that expired yesterday does not authorise today.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.medication_administrations
      (authority_id, child_id, given_at, dose_given, given_by, client_uuid)
    values ('f3333333-3333-4333-8333-333333333333',
            'a1111111-1111-4111-8111-111111111111',
            now(), '5ml', '55555555-5555-4555-8555-555555555555', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a dose CANNOT be recorded against an expired authority');
end $$;

-- The denormalised child_id cannot drift from the authority it cites.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.medication_administrations
      (authority_id, child_id, given_at, dose_given, given_by, client_uuid)
    values ('f2222222-2222-4222-8222-222222222222',
            'a1111111-1111-4111-8111-111111111111',
            now(), '5ml', '55555555-5555-4555-8555-555555555555', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a dose CANNOT cite an authority belonging to a different child');
end $$;

-- The outbox contract, identical to attendance: the same key twice is one dose.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.medication_administrations
      (authority_id, child_id, given_at, dose_given, given_by, client_uuid)
    values ('f1111111-1111-4111-8111-111111111111',
            'a1111111-1111-4111-8111-111111111111',
            now(), '5ml', '55555555-5555-4555-8555-555555555555',
            '0e111111-1111-4111-8111-111111111111');
  exception when unique_violation then ok := true;
  end;
  perform pg_temp.expect(ok, 'a replayed client_uuid is refused, so a flaky flush cannot double-dose the record');
end $$;

-- Append-only, enforced by the absent grant rather than by an absent policy.
do $$
declare ok boolean := false;
begin
  begin
    update public.medication_administrations set dose_given = '10ml'
     where client_uuid = '0e111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can UPDATE a medication record — the verb is revoked, got 42501');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.medication_administrations
     where client_uuid = '0e111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor DELETE one');
end $$;

-- Read: unlike an incident draft, there is nothing to withhold here. A parent is
-- entitled to know their child was given medicine.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.medication_administrations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'the child''s own parent CAN read the dose their child was given'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.medication_administrations
      (authority_id, child_id, given_at, dose_given, given_by, client_uuid)
    values ('f1111111-1111-4111-8111-111111111111',
            'a1111111-1111-4111-8111-111111111111',
            now(), '5ml', '33333333-3333-4333-8333-333333333333', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT record an administration');
end $$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.medication_administrations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'another family at the same centre CANNOT read it'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.medication_administrations) = 0,
  'and another centre reads nothing at all'
);

/*
 * The witness rule, which is a centre setting rather than a regulation this repo has
 * read. Off by default; asserted here in both positions, because a setting that is
 * never exercised in the on position is a setting nobody knows works.
 */
set local role postgres;
update public.centres set medication_requires_witness = true
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.medication_administrations
      (authority_id, child_id, given_at, dose_given, given_by, client_uuid)
    values ('f1111111-1111-4111-8111-111111111111',
            'a1111111-1111-4111-8111-111111111111',
            now(), '5ml', '55555555-5555-4555-8555-555555555555', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'where the centre requires a witness, an unwitnessed dose is refused');
end $$;

insert into public.medication_administrations
  (authority_id, child_id, given_at, dose_given, given_by, witnessed_by, client_uuid)
values ('f1111111-1111-4111-8111-111111111111',
        'a1111111-1111-4111-8111-111111111111',
        now(), '5ml',
        '55555555-5555-4555-8555-555555555555',
        '11111111-1111-4111-8111-111111111111',
        gen_random_uuid());

select pg_temp.expect(
  (select count(*) from public.medication_administrations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 2,
  'and a witnessed one is accepted'
);

set local role postgres;
update public.centres set medication_requires_witness = false
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;

-- ===========================================================================
-- SLEEP CHECKS (0033)
--
-- The most repetitive record in the building. Same append-only shape as the two
-- above, so the assertions here are about the boundary and the verbs rather than
-- about new machinery — and about the interval, which the schema deliberately does
-- not know.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.sleep_checks
  (child_id, at, observed_position, breathing_observed, checked_by, client_uuid)
values
  ('b2222222-2222-4222-8222-222222222222',
   now() - interval '20 minutes', 'back', true,
   '55555555-5555-4555-8555-555555555555',
   '0f111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.sleep_checks
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 1,
  'an educator can record a sleep check'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.sleep_checks
      (child_id, at, observed_position, breathing_observed, checked_by, client_uuid)
    values ('b2222222-2222-4222-8222-222222222222',
            now(), 'side', true, '55555555-5555-4555-8555-555555555555',
            '0f111111-1111-4111-8111-111111111111');
  exception when unique_violation then ok := true;
  end;
  perform pg_temp.expect(ok, 'a replayed sleep-check key is refused, so a cot-room retry cannot double-record');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.sleep_checks set breathing_observed = false
     where client_uuid = '0f111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can UPDATE a sleep check — the verb is revoked');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.sleep_checks
     where client_uuid = '0f111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor DELETE one');
end $$;

-- Beau's father reads it; Ana's mother does not.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.sleep_checks
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 1,
  'the sleeping child''s own parent CAN read that somebody looked at them'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.sleep_checks) = 0,
  'another family at the same centre CANNOT'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.sleep_checks
      (child_id, at, observed_position, breathing_observed, checked_by, client_uuid)
    values ('a1111111-1111-4111-8111-111111111111',
            now(), 'back', true, '33333333-3333-4333-8333-333333333333', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and a parent CANNOT record a sleep check for their own child');
end $$;

/*
 * The interval is null until a centre states one, and that is the product decision
 * this asserts. A default of 5 or 10 would be this repo inventing a licensing
 * figure, which is the thing `criteria` ships empty to avoid.
 */
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select sleep_check_minutes from public.centres
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is null,
  'a centre has NO sleep-check interval until it states one — none is assumed'
);

do $$
declare ok boolean := false;
begin
  begin
    update public.centres set sleep_check_minutes = 0
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and a nonsensical interval is refused by the constraint');
end $$;

-- One for Ana as well, purely so the purge below has something to take. The
-- assertions above deliberately use Beau, so that they cannot pass by accident on a
-- fixture every other section has already touched.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
insert into public.sleep_checks
  (child_id, at, observed_position, breathing_observed, checked_by, client_uuid)
values
  ('a1111111-1111-4111-8111-111111111111',
   now() - interval '15 minutes', 'not_observed', true,
   '55555555-5555-4555-8555-555555555555',
   '0f222222-2222-4222-8222-222222222222');

-- ===========================================================================
-- CENTRE REGISTERS (0034)
--
-- Drills, hazards and safety checks. The boundary here is one line — staff at the
-- centre — because none of these are about a child, so `caller_staff_centre_ids()`
-- says everything. What still has to be asserted is that a *parent* is shut out
-- despite being a member of the centre, which is the case a `caller_centre_ids()`
-- policy would get wrong and nothing else would notice.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.drills (id, centre_id, kind, held_at, adults_present, children_present, issues_found, recorded_by)
values ('c1111111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'fire', now() - interval '2 hours', 3, 12,
        'The side gate stuck. Oiled it.',
        '55555555-5555-4555-8555-555555555555');

insert into public.hazards (id, centre_id, description, area, risk, control, identified_by)
values ('c2222222-2222-4222-8222-222222222222',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Loose paving stone by the sandpit.', 'Playground', 'medium',
        'Coned off until replaced.',
        '55555555-5555-4555-8555-555555555555');

insert into public.safety_checks (centre_id, area, at, passed, checked_by, client_uuid)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'playground', now() - interval '3 hours', true,
        '55555555-5555-4555-8555-555555555555',
        '0a111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.drills where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1
  and (select count(*) from public.hazards where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1
  and (select count(*) from public.safety_checks where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'an educator can record a drill, a hazard and a safety check'
);

-- A failed check that says nothing is the row the register exists to prevent.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.safety_checks (centre_id, area, at, passed, checked_by, client_uuid)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'gates_and_fences', now(), false,
            '55555555-5555-4555-8555-555555555555', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a FAILED safety check with no note is refused — the note is the point of the row');
end $$;

-- Closing a hazard requires saying how. A date with no account of what changed is
-- the same empty claim as a sighting with nobody attached.
do $$
declare ok boolean := false;
begin
  begin
    update public.hazards set resolved_at = now()
     where id = 'c2222222-2222-4222-8222-222222222222';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a hazard cannot be closed without a resolution');
end $$;

update public.hazards
   set resolved_at = now(), resolution = 'Paving stone replaced by the contractor.'
 where id = 'c2222222-2222-4222-8222-222222222222';
select pg_temp.expect(
  (select resolved_at is not null from public.hazards
    where id = 'c2222222-2222-4222-8222-222222222222'),
  'and it CAN be closed with one'
);

-- Append-only, enforced by the absent grant.
do $$
declare ok boolean := false;
begin
  begin
    update public.safety_checks set passed = false
     where client_uuid = '0a111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can UPDATE a safety check — the verb is revoked');
end $$;

-- Nothing here may be tidied away. A drill that was held and a hazard that was found
-- are evidence; a register somebody can delete from proves nothing.
do $$
declare ok boolean := false;
begin
  begin
    delete from public.drills where id = 'c1111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE a drill record');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.hazards where id = 'c2222222-2222-4222-8222-222222222222';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor a hazard — it is closed with resolved_at, not removed');
end $$;

/*
 * THE ASSERTION THIS SECTION EXISTS FOR.
 *
 * A parent is a member of centre A. A policy written with `caller_centre_ids()` —
 * the obvious one, and the one used for `centres` itself — would hand them the
 * hazard register and the drill log. `caller_staff_centre_ids()` excludes the parent
 * role by construction, and nothing but this notices the difference.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.drills) = 0
  and (select count(*) from public.hazards) = 0
  and (select count(*) from public.safety_checks) = 0,
  'a PARENT at the same centre reads no drill, hazard or safety check'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.hazards (centre_id, description, risk)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Filed by a parent.', 'low');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and cannot file one');
end $$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.drills) = 0 and (select count(*) from public.hazards) = 0,
  'and another centre reads nothing at all'
);

-- The interval is null until a centre states one, exactly as with sleep checks.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select drill_interval_days from public.centres
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is null,
  'a centre has NO drill interval until it states one — none is assumed'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- ROOMS, TASKS AND CHECKLISTS — 0066, 0067, 0068, 0069
--
-- The 1Place replacement (docs/replacing-1place.md). Three boundaries are being
-- asserted here and only one of them is the usual one.
--
--  1. `tasks` and the whole checklist chain are staff-only, the 0034 boundary.
--  2. `rooms` is DELIBERATELY NOT — a parent reads it, and that difference is the
--     single most reviewable decision in these four migrations, so it gets an
--     assertion that fails loudly if somebody "fixes" it to match its neighbours.
--  3. Two boundaries that are about TIME rather than about people: a published
--     template version stops being editable, and a completed run stops being
--     editable. Neither is expressible as a grant, both are in USING clauses, and
--     nothing but this notices if one is dropped.
-- ===========================================================================

set local role postgres;

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.rooms (id, centre_id, name, sort)
values ('0d111111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS Toddler Room', 10);

select pg_temp.expect(
  (select count(*) from public.rooms where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'an owner can create a room'
);

-- Two live rooms with the same name in one centre make every picker ambiguous.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.rooms (centre_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rls toddler room');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a second LIVE room with the same name is refused, case-insensitively');
end $$;

/*
 * An educator does not invent the floor plan mid-shift.
 *
 * `rooms` is the only table in these four migrations whose writes are narrower than
 * its reads, and the reason is that a room created by accident pollutes every picker
 * in the product until somebody notices.
 */
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.rooms (centre_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Filed by an educator');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'an EDUCATOR cannot create a room, got ' || code);
end $$;

select pg_temp.expect(
  (select count(*) from public.rooms where id = '0d111111-1111-4111-8111-111111111111') = 1,
  'but an educator reads the room list — they file hazards against it'
);

/*
 * THE ASSERTION THIS TABLE EXISTS TO PROTECT.
 *
 * Every other register in 0034 uses `caller_staff_centre_ids()` and a reviewer
 * copying that pattern onto `rooms` would break nothing visible — until a family
 * opens an incident about their own child and the place it happened is blank,
 * because `incidents.room_id` joins to a table the policy refuses them.
 *
 * A room name is a noun the family says every morning. The hazard register is a list
 * of risks the centre has recorded about itself. They are not the same disclosure.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.rooms where id = '0d111111-1111-4111-8111-111111111111') = 1,
  'a PARENT reads the room list — deliberately unlike every other centre register'
);

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.rooms (centre_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Filed by a parent');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'but cannot create one, got ' || code);
end $$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.rooms) = 0,
  'and another centre reads no room of this one'
);

-- Archived, never deleted: a closed room still holds last year's incidents.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    delete from public.rooms where id = '0d111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE a room — it is archived, not removed');
end $$;

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.tasks (id, centre_id, room_id, title, category, priority, created_by)
values ('0d222222-2222-4222-8222-222222222222',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '0d111111-1111-4111-8111-111111111111',
        'RLS test: the gate latch sticks', 'maintenance', 'high',
        '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.tasks where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'an educator can file a task — the person who finds it is the person who reports it'
);

/*
 * Finishing means saying how. The `hazards` constraint, moved one table across.
 *
 * A queue where "Closed" carries no account of what was done is a queue nobody
 * trusts, and the first time somebody asks whether the gate was actually fixed there
 * is no answer in the record.
 */
do $$
declare ok boolean := false;
begin
  begin
    update public.tasks set status = 'closed'
     where id = '0d222222-2222-4222-8222-222222222222';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a task cannot be closed without a resolution');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    -- A resolution with no timestamp is the same half-record from the other side.
    update public.tasks set status = 'resolved', resolution = 'Oiled the hinge.'
     where id = '0d222222-2222-4222-8222-222222222222';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor with a resolution and no resolved_at — both halves or neither');
end $$;

update public.tasks
   set status = 'resolved', resolution = 'Oiled the hinge and replaced the striker plate.',
       resolved_at = now()
 where id = '0d222222-2222-4222-8222-222222222222';

select pg_temp.expect(
  (select status = 'resolved' from public.tasks
    where id = '0d222222-2222-4222-8222-222222222222'),
  'and it CAN be resolved with both'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.tasks) = 0,
  'a PARENT reads no task — the queue is the centre''s account of what is broken'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.tasks) = 0,
  'and another centre reads none of them'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    delete from public.tasks where id = '0d222222-2222-4222-8222-222222222222';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and nobody can DELETE one — a filed task is a record that somebody saw something');
end $$;

-- ---------------------------------------------------------------------------
-- Checklists
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.checklist_templates (id, centre_id, name, folder, recur_days, created_by)
values ('0d333333-3333-4333-8333-333333333333',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'RLS Daily Playground Check', 'Daily', 1,
        '11111111-1111-4111-8111-111111111111');

insert into public.checklist_template_versions (id, template_id, version)
values ('0d444444-4444-4444-8444-444444444444',
        '0d333333-3333-4333-8333-333333333333', 1);

insert into public.checklist_items (id, version_id, sort, prompt, response_type, required)
values ('0d555555-5555-4555-8555-555555555555',
        '0d444444-4444-4444-8444-444444444444', 1, 'Is the gate latched?', 'yes_no', true),
       ('0d666666-6666-4666-8666-666666666666',
        '0d444444-4444-4444-8444-444444444444', 2, 'Anything else to note?', 'text', false);

select pg_temp.expect(
  (select count(*) from public.checklist_items
    where version_id = '0d444444-4444-4444-8444-444444444444') = 2,
  'a manager can build a draft checklist version and its items'
);

/*
 * A DRAFT VERSION CANNOT BE FILLED IN.
 *
 * A form somebody is still writing produces evidence against questions that were
 * never agreed. Enforced by the trigger, not a policy, because the fact being tested
 * lives two tables away from the row being written.
 */
do $$
declare ok boolean := false;
begin
  begin
    insert into public.checklist_runs (version_id, centre_id, client_uuid, created_by)
    values ('0d444444-4444-4444-8444-444444444444',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(),
            '11111111-1111-4111-8111-111111111111');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a run against an UNPUBLISHED version is refused');
end $$;

update public.checklist_template_versions
   set published_at = now(), published_by = '11111111-1111-4111-8111-111111111111'
 where id = '0d444444-4444-4444-8444-444444444444';

/*
 * AND ONCE PUBLISHED IT STOPS BEING EDITABLE.
 *
 * The USING clause removes the row from the update's view, so PostgREST reports zero
 * rows rather than an error — which every writer in `@ece/api` already treats as a
 * refusal. Asserted by reading the row back, because a silent no-op is exactly the
 * failure a behavioural test can miss.
 */
update public.checklist_template_versions
   set published_at = now() - interval '10 days'
 where id = '0d444444-4444-4444-8444-444444444444';
select pg_temp.expect(
  (select published_at > now() - interval '1 hour'
     from public.checklist_template_versions
    where id = '0d444444-4444-4444-8444-444444444444'),
  'a PUBLISHED version cannot be edited — the update matches no row'
);

update public.checklist_items set prompt = 'Rewritten after publication'
 where id = '0d555555-5555-4555-8555-555555555555';
select pg_temp.expect(
  (select prompt = 'Is the gate latched?' from public.checklist_items
    where id = '0d555555-5555-4555-8555-555555555555'),
  'nor can its items — a wording change must not rewrite completed evidence'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.checklist_items (version_id, prompt)
    values ('0d444444-4444-4444-8444-444444444444', 'Added after publication');
    -- The policy refuses this, so reaching here means the row went in.
    ok := not found;
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'and no item can be ADDED to it — that would make every completed run retroactively incomplete');
end $$;

/*
 * A RUN'S DENORMALISED CENTRE MUST MATCH ITS TEMPLATE'S.
 *
 * Written as `postgres` on purpose. As an ordinary caller the insert policy refuses a
 * foreign centre_id first, so the trigger never runs and the assertion would pass for
 * the wrong reason — the mistake the `security_invoker` note further down describes.
 * Bypassing RLS isolates the trigger, which is the thing under test.
 */
set local role postgres;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.checklist_runs (version_id, centre_id, client_uuid)
    values ('0d444444-4444-4444-8444-444444444444',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'a run whose centre_id disagrees with its template''s centre is refused, even bypassing RLS');
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.checklist_runs (id, version_id, centre_id, room_id, client_uuid, created_by)
values ('0d777777-7777-4777-8777-777777777777',
        '0d444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '0d111111-1111-4111-8111-111111111111',
        '0d999999-9999-4999-8999-999999999999',
        '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.checklist_runs
    where id = '0d777777-7777-4777-8777-777777777777') = 1,
  'an educator can start a run against a published version — they walk the playground, not the manager'
);

/*
 * A "NO" MUST SAY WHAT WAS WRONG.
 *
 * The direct descendant of `safety_checks_failure_has_note`, which 0034 called the
 * single most useful constraint in that file. Without it a run reads "gate latch: no"
 * and the next person learns nothing, which destroys the only reason to keep the form.
 */
do $$
declare ok boolean := false;
begin
  begin
    insert into public.checklist_answers (run_id, item_id, value)
    values ('0d777777-7777-4777-8777-777777777777',
            '0d555555-5555-4555-8555-555555555555', 'no');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an answer of NO with no note is refused — the note is the point of the row');
end $$;

/*
 * COMPLETING WITH A REQUIRED ITEM UNANSWERED IS REFUSED.
 *
 * The trigger's reason for existing. Without it "complete" means the person pressed
 * the button, and a signed checklist with blank required lines is exactly the
 * confidently-wrong artefact that makes a manager stop counting.
 */
do $$
declare ok boolean := false;
begin
  begin
    update public.checklist_runs
       set completed_at = now(), signed_by = '55555555-5555-4555-8555-555555555555'
     where id = '0d777777-7777-4777-8777-777777777777';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a run cannot be COMPLETED while a required item is unanswered');
end $$;

insert into public.checklist_answers (run_id, item_id, value, note)
values ('0d777777-7777-4777-8777-777777777777',
        '0d555555-5555-4555-8555-555555555555', 'no', 'Striker plate bent, coned off.');

-- The optional item stays blank on purpose: `required = false` has to mean something.
update public.checklist_runs
   set completed_at = now(), signed_by = '55555555-5555-4555-8555-555555555555'
 where id = '0d777777-7777-4777-8777-777777777777';

select pg_temp.expect(
  (select completed_at is not null from public.checklist_runs
    where id = '0d777777-7777-4777-8777-777777777777'),
  'and CAN be completed once every REQUIRED item is answered — the optional one stays blank'
);

/*
 * A COMPLETED RUN IS FROZEN, AND SO ARE ITS ANSWERS.
 *
 * Same mechanism as a published version and the same reasoning as `incidents`: an
 * amendment is a new record, never an edit to the one that was signed.
 */
update public.checklist_runs set note = 'Edited after signing'
 where id = '0d777777-7777-4777-8777-777777777777';
select pg_temp.expect(
  (select note is null from public.checklist_runs
    where id = '0d777777-7777-4777-8777-777777777777'),
  'a COMPLETED run cannot be edited'
);

update public.checklist_answers set value = 'yes', note = null
 where run_id = '0d777777-7777-4777-8777-777777777777';
select pg_temp.expect(
  (select value = 'no' from public.checklist_answers
    where run_id = '0d777777-7777-4777-8777-777777777777'),
  'and neither can an answer inside it'
);

do $$
declare ok boolean := false;
begin
  begin
    delete from public.checklist_runs where id = '0d777777-7777-4777-8777-777777777777';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE a run — an abandoned one is itself a fact about the day');
end $$;

-- An educator may fill a form in and may not invent one.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.checklist_templates (centre_id, name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Written by an educator');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'an EDUCATOR cannot create a template, got ' || code);
end $$;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.checklist_templates) = 0
  and (select count(*) from public.checklist_template_versions) = 0
  and (select count(*) from public.checklist_items) = 0
  and (select count(*) from public.checklist_runs) = 0
  and (select count(*) from public.checklist_answers) = 0,
  'a PARENT reads no template, version, item, run or answer'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.checklist_templates) = 0
  and (select count(*) from public.checklist_runs) = 0
  and (select count(*) from public.checklist_answers) = 0,
  'and another centre reads nothing of this one''s checklists'
);

-- ---------------------------------------------------------------------------
-- Hazard assessment (0069)
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

insert into public.hazards (id, centre_id, description, risk, likelihood, consequence, identified_by)
values ('0d888888-8888-4888-8888-888888888888',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'RLS test hazard with an assessment.', 'medium', 4, 3,
        '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select risk_score = 12 from public.hazards
    where id = '0d888888-8888-4888-8888-888888888888'),
  'risk_score is generated from likelihood x consequence'
);

/*
 * AND NOTHING BANDS IT.
 *
 * `risk` is what a person decided; `risk_score` is arithmetic over two other
 * judgements. The row above is 12 out of 25 and its risk is 'medium' because somebody
 * said so, not because 12 falls in a band — no sourced grid exists for this product
 * (unverified-claims). This assertion fails the day somebody derives one from the
 * other, which is the change that would quietly turn an unsourced convention into a
 * compliance threshold.
 */
select pg_temp.expect(
  (select risk = 'medium' from public.hazards
    where id = '0d888888-8888-4888-8888-888888888888'),
  'and does NOT override the risk a person recorded — no band is applied anywhere'
);

do $$
declare ok boolean := false;
begin
  begin
    update public.hazards set likelihood = 9
     where id = '0d888888-8888-4888-8888-888888888888';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a likelihood outside 1-5 is refused');
end $$;

update public.hazards set likelihood = null
 where id = '0d888888-8888-4888-8888-888888888888';
select pg_temp.expect(
  (select risk_score is null from public.hazards
    where id = '0d888888-8888-4888-8888-888888888888'),
  'and a score derived from one number is no score at all'
);

set local role postgres;
do $$
declare ok boolean := false;
begin
  begin
    insert into public.hazards (centre_id, description, risk, risk_score)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Written score.', 'low', 25);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'nobody can write risk_score directly, service_role included — it is generated');
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- EVIDENCE PHOTOS (0075)
--
-- Staff-only documentation on incidents and checklist runs, frozen with the
-- parent. Ed builds his own fixtures — a fresh DRAFT incident for Ana and a fresh
-- run against the published version from the checklists section — because the
-- freeze is the thing under test and the earlier fixtures are already final or
-- signed. Nothing here touches consent: that is the point of the table.
-- ===========================================================================

insert into public.incidents
  (id, centre_id, child_id, kind, occurred_at, description, reported_by)
values
  ('ee751111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a1111111-1111-4111-8111-111111111111',
   'near_miss', now() - interval '30 minutes',
   'Gate found unlatched. Nobody through it.',
   '55555555-5555-4555-8555-555555555555');

insert into public.checklist_runs (id, version_id, centre_id, client_uuid, created_by)
values ('ee752222-2222-4222-8222-222222222222',
        '0d444444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', gen_random_uuid(),
        '55555555-5555-4555-8555-555555555555');

insert into public.evidence_photos (id, centre_id, incident_id, storage_path, uploaded_by)
values ('ee753333-3333-4333-8333-333333333333',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'ee751111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-1.jpg',
        '55555555-5555-4555-8555-555555555555');

insert into public.evidence_photos (id, centre_id, run_id, storage_path, uploaded_by)
values ('ee754444-4444-4444-8444-444444444444',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'ee752222-2222-4222-8222-222222222222',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-2.jpg',
        '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.evidence_photos
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 2,
  'an educator can attach photos to a draft incident and to an open run'
);

-- Exactly one parent — both is a photo claiming two records, neither is an orphan
-- the moment it is born.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.evidence_photos (centre_id, incident_id, run_id, storage_path)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'ee751111-1111-4111-8111-111111111111',
            'ee752222-2222-4222-8222-222222222222',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-both.jpg');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a photo cannot claim BOTH an incident and a run');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.evidence_photos (centre_id, storage_path)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-none.jpg');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor NEITHER');
end $$;

-- THE ONE for this table. Priya is Ana's guardian and the fixture incident is
-- about Ana; the store is staff-only whatever the report's status, so she reads
-- nothing — an asymmetry with the report itself that is deliberate and recorded
-- in incident-register.md.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.evidence_photos) = 0,
  'a parent CANNOT READ evidence photos, including of their own child''s incident'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.evidence_photos) = 0,
  'another centre cannot READ evidence photos'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.evidence_photos (centre_id, incident_id, storage_path)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'ee751111-1111-4111-8111-111111111111',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/rls-photo-cross.jpg');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'a photo cannot point at another centre''s incident, whatever centre_id it claims');
end $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- While the parent is working material, a wrong photo comes straight off.
delete from public.evidence_photos where id = 'ee753333-3333-4333-8333-333333333333';
select pg_temp.expect(
  (select count(*) from public.evidence_photos
    where id = 'ee753333-3333-4333-8333-333333333333') = 0,
  'a photo on a DRAFT incident can be removed by staff'
);

insert into public.evidence_photos (id, centre_id, incident_id, storage_path, uploaded_by)
values ('ee755555-5555-4555-8555-555555555555',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'ee751111-1111-4111-8111-111111111111',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-3.jpg',
        '55555555-5555-4555-8555-555555555555');

-- Finalise the report. Its photo freezes with it.
update public.incidents set status = 'final'
 where id = 'ee751111-1111-4111-8111-111111111111';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.evidence_photos (centre_id, incident_id, storage_path)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'ee751111-1111-4111-8111-111111111111',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-late.jpg');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'a photo cannot be ATTACHED to a finalised report — the evidence is what was there when it went final');
end $$;

-- The delete policy's USING clause excludes a frozen parent, so this is a silent
-- zero-row match rather than an error — asserted by the row surviving, the same
-- shape as the published-version assertions above.
delete from public.evidence_photos where id = 'ee755555-5555-4555-8555-555555555555';
select pg_temp.expect(
  (select count(*) from public.evidence_photos
    where id = 'ee755555-5555-4555-8555-555555555555') = 1,
  'nor REMOVED from one — the delete matches no row'
);

-- Same freeze on the run side. Answer the required item, sign the run, and its
-- photo is beyond both verbs.
insert into public.checklist_answers (run_id, item_id, value)
values ('ee752222-2222-4222-8222-222222222222',
        '0d555555-5555-4555-8555-555555555555', 'yes');

update public.checklist_runs
   set completed_at = now(), signed_by = '55555555-5555-4555-8555-555555555555'
 where id = 'ee752222-2222-4222-8222-222222222222';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.evidence_photos (centre_id, run_id, storage_path)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'ee752222-2222-4222-8222-222222222222',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/rls-photo-late-run.jpg');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a photo cannot be ATTACHED to a signed run');
end $$;

delete from public.evidence_photos where id = 'ee754444-4444-4444-8444-444444444444';
select pg_temp.expect(
  (select count(*) from public.evidence_photos
    where id = 'ee754444-4444-4444-8444-444444444444') = 1,
  'nor REMOVED from one'
);

-- No UPDATE exists at all — a photo is attached, not edited.
do $$
declare ok boolean := false;
begin
  begin
    update public.evidence_photos set caption = 'Rewritten'
     where id = 'ee755555-5555-4555-8555-555555555555';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a photo cannot be EDITED — the verb is revoked entirely');
end $$;

-- ===========================================================================
-- VISITORS (0035) AND IMMUNISATION (0036)
--
-- Two tables with two different boundaries, which is why they are two migrations.
-- The visitor book is centre-scoped and staff-only like the rest of Phase 9; an
-- immunisation record is about a child, so guardianship applies and the purge
-- cascade is back in play.
-- ===========================================================================

insert into public.visitors (id, centre_id, full_name, organisation, purpose, visiting, signed_in_at, recorded_by)
values ('c3333333-3333-4333-8333-333333333333',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Sam Plumber', 'Pipes Ltd', 'Fixing the tap in the bathroom', 'Alice',
        now() - interval '1 hour',
        '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.visitors where signed_out_at is null
    and centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'a visitor is on site until signed out — the question asked during an evacuation'
);

do $$
declare ok boolean := false;
begin
  begin
    update public.visitors set signed_out_at = signed_in_at - interval '1 hour'
     where id = 'c3333333-3333-4333-8333-333333333333';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a visitor cannot be signed out before they signed in');
end $$;

update public.visitors set signed_out_at = now()
 where id = 'c3333333-3333-4333-8333-333333333333';
select pg_temp.expect(
  (select signed_out_at is not null from public.visitors
    where id = 'c3333333-3333-4333-8333-333333333333'),
  'and CAN be signed out'
);

do $$
declare ok boolean := false;
begin
  begin
    delete from public.visitors where id = 'c3333333-3333-4333-8333-333333333333';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can remove a name from the visitor book');
end $$;

-- Immunisation. Ana is Priya's; Beau is Quinn's.
insert into public.immunisation_records
  (id, child_id, status, sighted_by, sighted_at, reference, recorded_by)
values ('c4444444-4444-4444-8444-444444444444',
        'a1111111-1111-4111-8111-111111111111',
        'up_to_date',
        '55555555-5555-4555-8555-555555555555', now(),
        'Well Child book, seen at enrolment',
        '55555555-5555-4555-8555-555555555555');

select pg_temp.expect(
  (select count(*) from public.immunisation_records
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'an educator can record what they were shown about a child''s immunisation'
);

-- A sighting cannot be attributed to somebody else, exactly as with consent.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.immunisation_records (child_id, status, sighted_by, sighted_at)
    values ('b2222222-2222-4222-8222-222222222222', 'up_to_date',
            '11111111-1111-4111-8111-111111111111', now());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a sighting CANNOT be recorded against a different person');
end $$;

-- Read: the child's own family, and nobody else's.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.immunisation_records
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'the child''s own parent CAN read it — there is no half-written state to withhold'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.immunisation_records (child_id, status)
    values ('a1111111-1111-4111-8111-111111111111', 'up_to_date');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'but CANNOT record one — the centre records what it saw');
end $$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.immunisation_records) = 0,
  'another family at the same centre reads nothing'
);

-- The visitor book is staff-only, like everything else in this phase.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.visitors) = 0,
  'a parent reads no visitor record'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- EXCURSIONS (0037)
--
-- The gate this migration exists for: an outing cannot depart while a child on the
-- list has no consent recorded FOR THAT OUTING. The standing `excursion` consent in
-- `consent_events` is a precondition and explicitly not a substitute — treating it
-- as one would take a child to a beach on a form signed two years earlier.
-- ===========================================================================

insert into public.excursions (id, centre_id, destination, departs_at, returns_at, recorded_by)
values ('c5555555-5555-4555-8555-555555555555',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Western Springs playground', now() + interval '1 day', now() + interval '1 day 3 hours',
        '55555555-5555-4555-8555-555555555555');

insert into public.excursion_children (excursion_id, child_id) values
  ('c5555555-5555-4555-8555-555555555555', 'a1111111-1111-4111-8111-111111111111'),
  ('c5555555-5555-4555-8555-555555555555', 'b2222222-2222-4222-8222-222222222222');

-- Ana has a STANDING excursion consent from 0004's fixtures. It must not be enough.
do $$
declare ok boolean := false;
begin
  begin
    update public.excursions set status = 'departed', departed_at = now()
     where id = 'c5555555-5555-4555-8555-555555555555';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'an outing CANNOT depart while a child on it has no consent for THAT outing'
  );
end $$;

-- Consent for this outing, for both children. Ana's from her mother, Beau's
-- transcribed by staff from a paper form — both paths are legitimate.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
insert into public.excursion_consents (excursion_id, child_id, granted, given_by, recorded_by)
values ('c5555555-5555-4555-8555-555555555555',
        'a1111111-1111-4111-8111-111111111111', true,
        'd1111111-1111-4111-8111-111111111111',
        '33333333-3333-4333-8333-333333333333');

-- A parent may record their own decision and nobody else's.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.excursion_consents (excursion_id, child_id, granted, given_by)
    values ('c5555555-5555-4555-8555-555555555555',
            'a1111111-1111-4111-8111-111111111111', true,
            'd2222222-2222-4222-8222-222222222222');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT give excursion consent as a different guardian');
end $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
insert into public.excursion_consents (excursion_id, child_id, granted, given_by, recorded_by, note)
values ('c5555555-5555-4555-8555-555555555555',
        'b2222222-2222-4222-8222-222222222222', true,
        'd2222222-2222-4222-8222-222222222222',
        '55555555-5555-4555-8555-555555555555',
        'Paper form returned Tuesday.');

update public.excursions set status = 'departed', departed_at = now()
 where id = 'c5555555-5555-4555-8555-555555555555';
select pg_temp.expect(
  (select status from public.excursions where id = 'c5555555-5555-4555-8555-555555555555') = 'departed',
  'and CAN depart once every child on it has one'
);

/*
 * Withdrawal is a new row, and the latest decision is the one that counts.
 *
 * Asserted by putting the outing back to planned, withdrawing Ana's consent, and
 * confirming it can no longer leave — which is the sequence that happens when a
 * family phones on the morning.
 */
update public.excursions set status = 'planned', departed_at = null
 where id = 'c5555555-5555-4555-8555-555555555555';
insert into public.excursion_consents (excursion_id, child_id, granted, given_by, recorded_by, note)
values ('c5555555-5555-4555-8555-555555555555',
        'a1111111-1111-4111-8111-111111111111', false,
        'd1111111-1111-4111-8111-111111111111',
        '55555555-5555-4555-8555-555555555555',
        'Mother phoned this morning.');

do $$
declare ok boolean := false;
begin
  begin
    update public.excursions set status = 'departed', departed_at = now()
     where id = 'c5555555-5555-4555-8555-555555555555';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a withdrawal is a new row, and the latest decision stops the outing');
end $$;

-- A headcount that does not match is RECORDED, not refused. Refusing it would
-- destroy the evidence that a child was briefly unaccounted for.
insert into public.excursion_headcounts (excursion_id, at, counted, expected, counted_by, client_uuid, note)
values ('c5555555-5555-4555-8555-555555555555', now(), 11, 12,
        '55555555-5555-4555-8555-555555555555', gen_random_uuid(),
        'One child in the toilets. Recounted at 11:05 and all present.');

select pg_temp.expect(
  (select count(*) from public.excursion_headcounts
    where excursion_id = 'c5555555-5555-4555-8555-555555555555' and counted <> expected) = 1,
  'a headcount that does not match is accepted — it is the record that matters'
);

do $$
declare ok boolean := false;
begin
  begin
    update public.excursion_headcounts set counted = 12
     where excursion_id = 'c5555555-5555-4555-8555-555555555555';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and cannot be rewritten afterwards — the verb is revoked');
end $$;

-- Guardianship again: Quinn is Beau's father and no relation to Ana.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.excursion_children
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0
  and (select count(*) from public.excursion_children
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 1,
  'a parent sees their own child on the outing list and not another family''s'
);

select pg_temp.expect(
  (select count(*) from public.excursion_headcounts) = 0,
  'and reads no headcount — those are about the outing, not about a child'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- STAFF MEMBERS (0038)
--
-- The person-of-record Phase 10 hangs off. Two properties worth pinning: an
-- educator may READ the staff list (they are rostered alongside it) but not change
-- it, and a second person record cannot be attached to one account — the ambiguity
-- that would surface as a ratio wrong by one.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.staff_members (id, centre_id, full_name, user_id, role_note, started_on)
values ('d5555555-5555-4555-8555-555555555555',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Ed Educator', '55555555-5555-4555-8555-555555555555',
        'Head teacher, over-2s', current_date - 400),
       -- A reliever: works here, appears on a roster, has no account. The row this
       -- table exists to be able to hold.
       ('d6666666-6666-4666-8666-666666666666',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Sam Reliever', null, 'Reliever, Tuesdays', null);

select pg_temp.expect(
  (select count(*) from public.staff_members
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 2,
  'an owner can add staff, including a reliever with no account'
);

-- Several NULL user_ids do not collide, which is what lets a centre hold a dozen
-- relievers. Postgres semantics, asserted rather than assumed.
insert into public.staff_members (centre_id, full_name, user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Another Reliever', null);
select pg_temp.expect(
  (select count(*) from public.staff_members
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id is null) = 2,
  'and two relievers with no account do not collide on the unique constraint'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_members (centre_id, full_name, user_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Ed Again',
            '55555555-5555-4555-8555-555555555555');
  exception when unique_violation then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'but one account CANNOT have two person records — that ambiguity is a ratio wrong by one'
  );
end $$;

-- An educator reads the list and cannot change it.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_members
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 3,
  'an educator CAN read the staff list — they are rostered alongside it'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_members (centre_id, full_name)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Self Appointed');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and CANNOT add to it');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.staff_members set role_note = 'Manager, actually'
     where id = 'd5555555-5555-4555-8555-555555555555';
    ok := (select role_note from public.staff_members
            where id = 'd5555555-5555-4555-8555-555555555555') <> 'Manager, actually';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor promote themselves on it');
end $$;

-- A parent reads nothing: the staff list is not theirs.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_members) = 0,
  'a parent at the centre reads no staff record'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_members) = 0,
  'and another centre reads nothing at all'
);

/*
 * Nobody deletes a person who worked here.
 *
 * They appear in ratio history, on shifts, and against attendance events once 0039
 * lands. Removing the row would leave those pointing at nothing and would rewrite
 * what the evidence binder can show. Departure is `finished_on`.
 */
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    delete from public.staff_members where id = 'd6666666-6666-4666-8666-666666666666';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE a staff member — departure is finished_on');
end $$;

/*
 * The link from licensing evidence to the person, and what happens without it.
 *
 * 0038 adds `staff_records.staff_member_id` and leaves every row null on purpose:
 * matching on `person_name` would merge two relievers sharing a first name, and a
 * vetting result attached to the wrong person is the worst row this schema could
 * hold. This asserts the column exists, is linkable, and that a staff record
 * survives the person record being unlinked — which is why `person_name` is
 * `not null` and the FK is `on delete set null`.
 */
insert into public.staff_records (id, centre_id, person_name, kind, expires_on)
values ('d7777777-7777-4777-8777-777777777777',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Sam Reliever', 'police_vetting', current_date + 300);

select pg_temp.expect(
  (select staff_member_id from public.staff_records
    where id = 'd7777777-7777-4777-8777-777777777777') is null,
  'a staff record starts unlinked — no migration guesses which Sam this is'
);

update public.staff_records
   set staff_member_id = 'd6666666-6666-4666-8666-666666666666'
 where id = 'd7777777-7777-4777-8777-777777777777';
select pg_temp.expect(
  (select staff_member_id from public.staff_records
    where id = 'd7777777-7777-4777-8777-777777777777')
    = 'd6666666-6666-4666-8666-666666666666',
  'and can be linked by hand once somebody knows'
);

-- ===========================================================================
-- STAFF ATTENDANCE (0039)
--
-- The table that exists separately from `attendance_events` precisely so that no
-- guardian branch can reach it. The assertion this section is for is the absence:
-- a parent must read nothing here, and the merged-table design would have made that
-- an OR of two unrelated boundaries.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- An educator signs themselves in, and signs in the reliever who has no account.
-- The second is the case the whole `staff_members` design exists for.
insert into public.staff_attendance_events (staff_member_id, kind, at, recorded_by, client_uuid)
values ('d5555555-5555-4555-8555-555555555555', 'in', pg_temp.today_at('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.1),
        '55555555-5555-4555-8555-555555555555', '0b111111-1111-4111-8111-111111111111'),
       ('d6666666-6666-4666-8666-666666666666', 'in', pg_temp.today_at('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.2),
        '55555555-5555-4555-8555-555555555555', '0b222222-2222-4222-8222-222222222222');

select pg_temp.expect(
  (select count(*) from public.staff_attendance_events) = 2,
  'an educator can sign themselves in AND a reliever who has no account'
);

-- Attribution: an event is always traceable to whoever tapped, even about somebody
-- else. Recording it as a colleague is refused.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_attendance_events (staff_member_id, kind, at, recorded_by, client_uuid)
    values ('d5555555-5555-4555-8555-555555555555', 'out', now(),
            '11111111-1111-4111-8111-111111111111', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a staff event CANNOT be attributed to somebody else''s account');
end $$;

-- The outbox contract, third table to carry it.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_attendance_events (staff_member_id, kind, at, recorded_by, client_uuid)
    values ('d5555555-5555-4555-8555-555555555555', 'in', now(),
            '55555555-5555-4555-8555-555555555555', '0b111111-1111-4111-8111-111111111111');
  exception when unique_violation then ok := true;
  end;
  perform pg_temp.expect(ok, 'a replayed key is refused, so a flaky flush cannot double-count an adult');
end $$;

-- Append-only, enforced by the absent grant.
do $$
declare ok boolean := false;
begin
  begin
    update public.staff_attendance_events set kind = 'out'
     where client_uuid = '0b111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can UPDATE a staff attendance event — the verb is revoked');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.staff_attendance_events
     where client_uuid = '0b111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor DELETE one — these become a payroll figure');
end $$;

/*
 * THE ASSERTION THIS TABLE EXISTS FOR.
 *
 * A parent reads their own child's attendance through `attendance_events`, because
 * `caller_may_see_child` includes guardians. Had staff hours shared that table, the
 * policy would have been an OR of two unrelated boundaries and a parent would be one
 * predicate away from reading when the manager arrived.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_attendance_events) = 0,
  'a parent reads NO staff attendance — the separate table is what guarantees it'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_attendance_events (staff_member_id, kind, at, client_uuid)
    values ('d5555555-5555-4555-8555-555555555555', 'out', now(), gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and cannot sign a staff member out');
end $$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_attendance_events) = 0,
  'and another centre reads nothing at all'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- THE TWO RATIO SOURCES (0040)
--
-- The rule is that they never blend and never fall back. Both halves are asserted,
-- and the second is the one that would be "fixed" by a well-meaning later change:
-- a derived centre with nobody signed in reports ZERO, not yesterday's typed count.
-- ===========================================================================

-- Two staff signed in above, and a typed count that disagrees with them.
insert into public.staff_count_events (centre_id, adults, at, recorded_by, client_uuid)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 7,
        pg_temp.today_at('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.3),
        '55555555-5555-4555-8555-555555555555', gen_random_uuid());

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 7,
  'a centre defaults to declared, so the typed count is the answer'
);

set local role postgres;
update public.centres set ratio_source = 'derived'
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 2,
  'switched to derived, it counts the people who signed in and IGNORES the typed 7'
);

-- Signing one out drops the count. The typed 7 is still sitting there and still
-- irrelevant, which is the no-blend rule doing its work.
insert into public.staff_attendance_events (staff_member_id, kind, at, recorded_by, client_uuid)
values ('d6666666-6666-4666-8666-666666666666', 'out', pg_temp.today_at('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.7),
        '55555555-5555-4555-8555-555555555555', gen_random_uuid());

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'and signing somebody out drops it — no blending with the typed count'
);

/*
 * A correction may carry an EARLIER timestamp than the row it fixes — somebody
 * signed in at 8:05 and corrects it to 7:50. Ordering by time alone would pick the
 * original and answer with the wrong state, so superseded rows are excluded first.
 *
 * Here: correct the sign-OUT back to a sign-IN, timestamped before it.
 */
insert into public.staff_attendance_events (staff_member_id, kind, at, recorded_by, client_uuid, corrects, note)
values ('d6666666-6666-4666-8666-666666666666', 'in', pg_temp.today_at('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 0.5),
        '55555555-5555-4555-8555-555555555555', gen_random_uuid(),
        (select id from public.staff_attendance_events
          where staff_member_id = 'd6666666-6666-4666-8666-666666666666'
            and kind = 'out' order by id desc limit 1),
        'Signed out by mistake — they were still here.');

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 2,
  'a correction timestamped BEFORE the row it fixes still wins — superseded rows are excluded, not out-sorted'
);

/*
 * 0095 — AN ADULT ON THEIR BREAK DOES NOT COUNT.
 *
 * Two people are signed in at this point. Putting one of them inside an off-floor
 * interval that spans the centre's current wall clock must drop the count to one, and
 * an interval that does NOT span it must leave the count alone.
 *
 * The clock is the centre's own, computed the way 0095 computes it, because PostgREST
 * connects as UTC and New Zealand is half a day ahead — a `current_time` here would put
 * the morning's breaks on the wrong side of midnight and this assertion would pass or
 * fail depending on the hour the suite is run.
 */
-- Recorded by the OWNER: `caller_may_roster` refuses an educator, which the section above
-- asserts directly. The educator remains the reader, and reads it through the function.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time, reason)
select 'd5555555-5555-4555-8555-555555555555',
       (now() at time zone ce.timezone)::date,
       greatest((now() at time zone ce.timezone)::time - interval '30 minutes', time '00:00:00'),
       least((now() at time zone ce.timezone)::time + interval '30 minutes', time '23:59:59'),
       'On a break right now'
  from public.centres ce
 where ce.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'somebody inside an off-floor interval RIGHT NOW does not count towards the ratio'
);

set local role postgres;
delete from public.staff_off_floor
 where staff_member_id = 'd5555555-5555-4555-8555-555555555555';
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 2,
  'and removing the interval puts them back'
);

/*
 * An interval on the same day that does NOT contain the current time changes nothing.
 * Without this, a bug that ignored the times entirely — excluding anybody with any
 * off-floor row today — would pass the assertion above.
 */
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time, reason)
select 'd5555555-5555-4555-8555-555555555555',
       (now() at time zone ce.timezone)::date,
       time '00:00:00', time '00:01:00',
       'A minute after midnight, long over'
  from public.centres ce
 where ce.id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   and (now() at time zone ce.timezone)::time > time '00:01:00';

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 2,
  'an off-floor interval that has already ended does NOT remove them'
);

set local role postgres;
delete from public.staff_off_floor;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

/*
 * THE ASSERTION MOST LIKELY TO BE "FIXED" LATER.
 *
 * A derived centre where nobody has signed in reports zero. It looks like a bug and
 * it is the entire point: falling back to the typed count would paper over exactly
 * the failure that switching to derived was meant to expose.
 */
set local role postgres;
delete from public.staff_attendance_events;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'a DERIVED centre with nobody signed in reports ZERO — it does not fall back to the typed count'
);

set local role postgres;
update public.centres set ratio_source = 'declared'
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  public.adults_present_now('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 7,
  'and switching back restores the typed count, unchanged'
);

-- ===========================================================================
-- STAFF OFF FLOOR (0094)
--
-- The hours an adult was present and NOT counted towards regulated staff. Two
-- boundaries matter here and they are different from each other: a colleague may
-- READ it, because the ratio surfaces need it and a person's presence is not
-- private from the people they work beside; but only owner or manager may WRITE
-- it, because marking somebody uncounted lowers a funding figure and a ratio
-- assessment. An educator marking themselves off the floor is the case the write
-- predicate exists to refuse.
--
-- And a parent reads none of it — the same absence `staff_attendance_events`
-- asserts, and for the same reason.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.staff_off_floor (id, staff_member_id, on_date, from_time, to_time, reason, recorded_by)
values ('e9111111-1111-4111-8111-111111111111',
        'd5555555-5555-4555-8555-555555555555',
        current_date, '12:00', '13:00', 'Lunch',
        '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.staff_off_floor
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555') = 1,
  'an owner can record that somebody was off the floor'
);

-- THE ASSERTION THIS SECTION EXISTS FOR. An educator may read the row and may not
-- write one — including about themselves. Marking yourself uncounted changes a
-- funding figure, so it is a management act.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.staff_off_floor) = 1,
  'an educator READS a colleague being off the floor — the ratio surfaces need it'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time)
    values ('d5555555-5555-4555-8555-555555555555', current_date, '15:00', '15:30');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'an educator CANNOT mark themselves off the floor — it lowers a funding figure'
  );
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.staff_off_floor set to_time = '14:00'
     where id = 'e9111111-1111-4111-8111-111111111111';
    ok := not found;
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor edit one somebody else recorded');
end $$;

-- The overlap constraint, which is why the interval is a row rather than a note.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time)
    values ('d5555555-5555-4555-8555-555555555555', current_date, '12:30', '13:30');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'one person CANNOT be off the floor twice over the same hours — the subtraction would double-count'
  );
end $$;

-- `[)`, so an interval starting exactly when another ends is adjacent. A break to
-- 13:00 and non-contact time from 13:00 are two facts about one afternoon.
insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time, reason)
values ('d5555555-5555-4555-8555-555555555555', current_date, '13:00', '13:30', 'Non-contact');
select pg_temp.expect(
  (select count(*) from public.staff_off_floor
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555') = 2,
  'but one starting exactly when another ends is adjacent, not a clash'
);

-- An inverted interval is refused. `to_time > from_time` — an interval that ends
-- before it starts would subtract a negative number of hours from a Crown return.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_off_floor (staff_member_id, on_date, from_time, to_time)
    values ('d5555555-5555-4555-8555-555555555555', current_date + 1, '14:00', '13:00');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an interval that ends before it starts is refused');
end $$;

-- THE TENANT BOUNDARY. A manager at the other centre reads none of it.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_off_floor) = 0,
  'another centre reads NO off-floor intervals'
);

-- And a parent reads none, which is the absence this table shares with staff attendance.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_off_floor) = 0,
  'a parent reads NO off-floor intervals'
);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
delete from public.staff_off_floor
 where staff_member_id = 'd5555555-5555-4555-8555-555555555555';

-- ===========================================================================
-- SHIFTS AND LEAVE (0041)
--
-- What is PLANNED, as opposed to what happened. The assertion this section exists
-- for is the overlap constraint: a double-booked person is counted twice in a
-- forecast, so the roster reads adequately staffed when it is not.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.shifts (id, staff_member_id, on_date, from_time, to_time, created_by)
values ('e1111111-1111-4111-8111-111111111111',
        'd5555555-5555-4555-8555-555555555555',
        current_date + 3, '08:00', '16:00',
        '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.shifts
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555') = 1,
  'an owner can roster somebody'
);

-- THE ASSERTION THIS SECTION EXISTS FOR.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.shifts (staff_member_id, on_date, from_time, to_time)
    values ('d5555555-5555-4555-8555-555555555555', current_date + 3, '12:00', '18:00');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'one person CANNOT be rostered twice over the same hours — a forecast would count them twice'
  );
end $$;

-- Touching shifts are fine: `[)` means a shift ending at 16:00 does not collide with
-- one starting at 16:00, which is a handover rather than a conflict.
insert into public.shifts (staff_member_id, on_date, from_time, to_time)
values ('d5555555-5555-4555-8555-555555555555', current_date + 3, '16:00', '18:00');
select pg_temp.expect(
  (select count(*) from public.shifts
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555') = 2,
  'but a shift starting exactly when another ends is a handover, not a clash'
);

-- A cancelled shift must not block its own replacement.
update public.shifts set status = 'cancelled'
 where id = 'e1111111-1111-4111-8111-111111111111';
insert into public.shifts (staff_member_id, on_date, from_time, to_time)
values ('d5555555-5555-4555-8555-555555555555', current_date + 3, '09:00', '15:00');
select pg_temp.expect(
  (select count(*) from public.shifts
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555'
      and status <> 'cancelled') = 2,
  'and a cancelled shift does not block the replacement that replaces it'
);

-- Leave has no overlap constraint, on purpose: sick leave declared during booked
-- annual leave is a real situation, and refusing it pushes the correction out of the
-- system.
insert into public.staff_leave (staff_member_id, from_date, to_date, kind, status)
values ('d5555555-5555-4555-8555-555555555555', current_date + 10, current_date + 14, 'annual', 'approved'),
       ('d5555555-5555-4555-8555-555555555555', current_date + 12, current_date + 12, 'sick', 'approved');
select pg_temp.expect(
  (select count(*) from public.staff_leave
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555') = 2,
  'two leave records may cover the same day — sick leave during booked annual leave is real'
);

/*
 * An educator reads the roster and cannot write it.
 *
 * Reading is the point of having a roster: somebody who cannot see next week cannot
 * plan around it. Writing decides the forecast, which is a compliance figure, so it
 * is owner and manager only.
 */
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.shifts) >= 2
  and (select count(*) from public.staff_leave) = 2,
  'an educator CAN read the roster and the leave'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.shifts (staff_member_id, on_date, from_time, to_time)
    values ('d5555555-5555-4555-8555-555555555555', current_date + 20, '08:00', '16:00');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and CANNOT roster themselves');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.staff_leave (staff_member_id, from_date, to_date, kind, status)
    values ('d5555555-5555-4555-8555-555555555555', current_date + 30, current_date + 31, 'annual', 'approved');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor approve their own leave');
end $$;

-- Nothing here is deletable: a cancelled shift is a fact about what was planned, and
-- a roster somebody can erase cannot show that Tuesday was short before anybody
-- noticed.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    delete from public.shifts where id = 'e1111111-1111-4111-8111-111111111111';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nobody can DELETE a shift — cancelling is visible, deleting is not');
end $$;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.shifts) = 0 and (select count(*) from public.staff_leave) = 0,
  'a parent reads no roster and no leave'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.shifts) = 0,
  'and another centre reads nothing at all'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- THE STAFF CENSUS (0081) AND THE MINISTRY CODE SETS (0080)
--
-- The annual ECE Return asks for each person's gender, ethnicity, age band and
-- qualification. None of that is roster data, and that distinction is the whole
-- reason `staff_census_details` is its own table: `staff_members_select` is
-- centre-staff-wide, because everybody rostered may read the roster — so putting
-- these on `staff_members` would hand every educator every colleague's ethnicity,
-- and no policy could prevent it. A policy restricts rows; only a grant restricts
-- columns, and a column grant cannot tell an educator from a manager.
--
-- So the read follows `staff_records` (0011): owner or manager, OR the person
-- themselves, because IPP 6 gives somebody a right of access to their own
-- information. The pair of assertions in the middle of this section is the point of
-- the whole table.
-- ===========================================================================

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.staff_census_details
  (staff_member_id, gender_code, age_band, ethnic_group_codes, iwi_codes, role_kind,
   role_code, highest_qualification_code, is_paid, is_permanent, is_full_time, updated_by)
values
  -- Ed: an educational role, and the account is linked, so IPP 6 has somebody to apply to.
  ('d5555555-5555-4555-8555-555555555555', 'F', '31_35', array['E1'], array['IWI1'],
   'educational', 'R1', 'Q1', true, true, true,
   '11111111-1111-4111-8111-111111111111'),
  -- Sam the reliever: no account at all, so owner/manager is the only read path there
  -- can be. Not a gap — there is nobody to grant access to.
  ('d6666666-6666-4666-8666-666666666666', 'M', '46_50', array['E2'], '{}',
   'support', 'R9', null, true, false, false,
   '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.staff_census_details) = 2,
  'an owner can record census details for their own staff'
);

-- The audit trigger must actually have written something. 0059 exists because three
-- tables fired their triggers and inserted nothing for months, and both of these hang
-- off `staff_member_id` exactly as `shifts` does.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'staff_census_details' and action = 'insert') = 2,
  'and the census insert is audited — the 0059 failure mode, checked rather than assumed'
);

select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'staff_census_details'
      and detail ? 'changed') = 0,
  'and the audit row for an insert carries no column list, let alone an ethnicity'
);

-- ---------------------------------------------------------------------------
-- Centre against centre
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.staff_census_details) = 0,
  'another centre reads no census detail at all'
);

do $$
declare wrote boolean := false;
begin
  begin
    insert into public.staff_census_details (staff_member_id, gender_code)
    values ('d5555555-5555-4555-8555-555555555555', 'X');
    wrote := true;
  exception when insufficient_privilege or check_violation or unique_violation then
    wrote := false;
  end;
  perform pg_temp.expect(not wrote, 'nor can another centre write one for our staff');
end $$;

-- ---------------------------------------------------------------------------
-- A parent is a member of this centre, and this is not theirs
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.staff_census_details) = 0,
  'a parent at this centre reads no census detail'
);

-- ---------------------------------------------------------------------------
-- THE TWO ASSERTIONS THIS TABLE EXISTS FOR
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.staff_census_details
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555') = 1,
  'an educator CAN read their OWN census record — IPP 6, and the reason this predicate is not caller_is_staff_for_member'
);

select pg_temp.expect(
  (select count(*) from public.staff_census_details) = 1,
  'and reads EXACTLY their own — a colleague''s ethnicity and qualification are not roster data'
);

do $$
declare changed integer;
begin
  update public.staff_census_details set gender_code = 'Z'
   where staff_member_id = 'd5555555-5555-4555-8555-555555555555';
  changed := (select count(*) from public.staff_census_details
               where staff_member_id = 'd5555555-5555-4555-8555-555555555555'
                 and gender_code = 'Z');
  perform pg_temp.expect(
    changed = 0,
    'an educator CANNOT edit their own census record — reading your own record is not maintaining it'
  );
end $$;

/*
 * Anon is refused at the PRIVILEGE layer, not the policy layer, so the read raises
 * 42501 rather than returning no rows. Written as a caught exception for that reason:
 * `count(*) = 0` would not compile past the grant, and a suite that expected zero
 * would fail on the stronger outcome. Same distinction 0003 draws — the grant is the
 * first check and RLS is the second.
 */
set local role anon;
do $$
declare code text := 'none (the select SUCCEEDED)';
begin
  begin
    perform count(*) from public.staff_census_details;
  exception when insufficient_privilege then code := sqlstate;
  end;
  perform pg_temp.expect(
    code = '42501',
    'and anon cannot reach a census detail at all — refused by the grant, got ' || code
  );
end $$;
set local role authenticated;

-- ---------------------------------------------------------------------------
-- Contact hours: a contract, not a diary — and the overlap that matters
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.staff_contact_hours
  (staff_member_id, weekday, from_time, to_time, effective_from, created_by)
values ('d5555555-5555-4555-8555-555555555555', 1, '08:00', '12:00', current_date - 30,
        '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.staff_contact_hours) = 1,
  'an owner can contract weekday contact hours'
);

-- A split shift is ordinary in this sector and the schema's list is unbounded, so two
-- blocks on one weekday must be legal.
insert into public.staff_contact_hours
  (staff_member_id, weekday, from_time, to_time, effective_from, created_by)
values ('d5555555-5555-4555-8555-555555555555', 1, '13:00', '16:00', current_date - 30,
        '11111111-1111-4111-8111-111111111111');

select pg_temp.expect(
  (select count(*) from public.staff_contact_hours
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555' and weekday = 1) = 2,
  'and a split shift on the same weekday is allowed — two blocks, no overlap'
);

-- THE ASSERTION THIS PART EXISTS FOR. A double-booked weekday inflates the derived
-- return-week hours total for every ECE Return that reads it.
do $$
declare wrote boolean := false;
begin
  begin
    insert into public.staff_contact_hours
      (staff_member_id, weekday, from_time, to_time, effective_from)
    values ('d5555555-5555-4555-8555-555555555555', 1, '11:00', '14:00', current_date - 30);
    wrote := true;
  exception when exclusion_violation then wrote := false;
  end;
  perform pg_temp.expect(
    not wrote,
    'a contact block OVERLAPPING an existing one on the same weekday is refused'
  );
end $$;

/*
 * AN OPEN-ENDED CONTRACT BLOCKS AN OVERLAPPING LATER ONE UNTIL IT IS CLOSED, and this
 * pair of assertions exists because the first draft of them was wrong.
 *
 * The intuition "the same times in a LATER window must be accepted" is false while the
 * existing blocks have a null `effective_to`: null means infinity, so their range still
 * covers that later window and the constraint refuses — correctly. Superseding a
 * contract is therefore two statements, close then open, and a screen that offers only
 * "add hours" will produce this error in front of a manager.
 */
do $$
declare wrote boolean := false;
begin
  begin
    insert into public.staff_contact_hours
      (staff_member_id, weekday, from_time, to_time, effective_from, effective_to)
    values ('d5555555-5555-4555-8555-555555555555', 1, '11:00', '14:00',
            current_date + 100, current_date + 200);
    wrote := true;
  exception when exclusion_violation then wrote := false;
  end;
  perform pg_temp.expect(
    not wrote,
    'an overlapping block in a LATER window is still refused while the existing one is open-ended'
  );
end $$;

-- Close the open-ended blocks, which is what superseding actually means, and then the
-- same insert must succeed — otherwise the effective dating is decoration.
update public.staff_contact_hours
   set effective_to = current_date + 99
 where staff_member_id = 'd5555555-5555-4555-8555-555555555555'
   and weekday = 1;

insert into public.staff_contact_hours
  (staff_member_id, weekday, from_time, to_time, effective_from, effective_to)
values ('d5555555-5555-4555-8555-555555555555', 1, '11:00', '14:00',
        current_date + 100, current_date + 200);

select pg_temp.expect(
  (select count(*) from public.staff_contact_hours
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555' and weekday = 1) = 3,
  'and once the old blocks are closed, the same times in a later window are accepted'
);

-- A touching block is not an overlapping one: `[)` means a block ending at 12:00 does
-- not collide with one starting at 12:00. Same reasoning as shifts.
insert into public.staff_contact_hours
  (staff_member_id, weekday, from_time, to_time, effective_from)
values ('d5555555-5555-4555-8555-555555555555', 2, '08:00', '12:00', current_date - 30);
insert into public.staff_contact_hours
  (staff_member_id, weekday, from_time, to_time, effective_from)
values ('d5555555-5555-4555-8555-555555555555', 2, '12:00', '16:00', current_date - 30);

select pg_temp.expect(
  (select count(*) from public.staff_contact_hours
    where staff_member_id = 'd5555555-5555-4555-8555-555555555555' and weekday = 2) = 2,
  'and a block starting exactly when another ends does not collide'
);

-- Unlike the census, contact hours ARE roster data, so a colleague may read them.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_contact_hours) = 5,
  'an educator CAN read contact hours — a roster is not private, which is the distinction this pair of tables draws'
);

do $$
declare wrote boolean := false;
begin
  begin
    insert into public.staff_contact_hours
      (staff_member_id, weekday, from_time, to_time, effective_from)
    values ('d5555555-5555-4555-8555-555555555555', 6, '08:00', '12:00', current_date - 30);
    wrote := true;
  exception when insufficient_privilege then wrote := false;
  end;
  perform pg_temp.expect(not wrote, 'and CANNOT contract themselves any');
end $$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.staff_contact_hours) = 0,
  'and another centre reads no contact hours at all'
);

-- ---------------------------------------------------------------------------
-- The Ministry code sets: readable by everybody, writable by nobody with a JWT
--
-- 0080 ships EMPTY on purpose, so the assertions here seed a set as `postgres` and
-- then check the two properties that matter. Asserting the tables are empty was
-- rejected: it would be a claim about data rather than about policy, and it would
-- fail on the day somebody legitimately imports a published list, which is the day
-- this mechanism starts working.
-- ---------------------------------------------------------------------------

set local role postgres;
insert into public.code_sets (id, domain, name, source, version, is_current)
values ('f1111111-1111-4111-8111-111111111111', 'gender',
        'RLS test gender codes', 'rls_isolation.sql fixture', 'test', true);
insert into public.codes (set_id, code, label, effective_from)
values ('f1111111-1111-4111-8111-111111111111', 'F', 'Female', '2000-01-01');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.code_sets where source = 'rls_isolation.sql fixture') = 1
  and (select count(*) from public.codes where code = 'F') = 1,
  'any authenticated caller can read a Ministry code set — national reference data, not tenant data'
);

do $$
declare wrote boolean := false;
begin
  begin
    insert into public.code_sets (domain, name, source)
    values ('qualification', 'Invented', 'typed into a screen');
    wrote := true;
  exception when insufficient_privilege then wrote := false;
  end;
  perform pg_temp.expect(
    not wrote,
    'but CANNOT create one — a code set typed in by a manager is how an invented qualification reaches a Crown return'
  );
end $$;

do $$
declare wrote boolean := false;
begin
  begin
    insert into public.codes (set_id, code, label)
    values ('f1111111-1111-4111-8111-111111111111', 'ZZ', 'Invented');
    wrote := true;
  exception when insufficient_privilege then wrote := false;
  end;
  perform pg_temp.expect(not wrote, 'nor add a value to one');
end $$;

do $$
declare changed integer;
begin
  begin
    update public.codes set label = 'Rewritten' where code = 'F';
  exception when insufficient_privilege then null;
  end;
  changed := (select count(*) from public.codes where label = 'Rewritten');
  perform pg_temp.expect(changed = 0, 'nor rewrite what a published code means');
end $$;

/*
 * AND THE REFUSAL IS AT THE GRANT LAYER, ASKED OF THE CATALOGUE.
 *
 * This assertion exists because mutation testing found the three above could not see
 * the difference. Granting INSERT and UPDATE on these tables to `authenticated` left
 * the suite green at 631/631: with a grant but no policy, Postgres still raises 42501
 * — "new row violates row-level security policy" — and the `insufficient_privilege`
 * handler catches it either way.
 *
 * That is defence in depth working exactly as 0003 argues it should, and it is also a
 * test that cannot tell which of the two mechanisms is holding. So the claim gets made
 * precisely: `authenticated` holds no write privilege on either table at all, which is
 * the property that would have to be revoked deliberately.
 */
select pg_temp.expect(
  not has_table_privilege('authenticated', 'public.code_sets', 'INSERT')
  and not has_table_privilege('authenticated', 'public.code_sets', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.code_sets', 'DELETE')
  and not has_table_privilege('authenticated', 'public.codes', 'INSERT')
  and not has_table_privilege('authenticated', 'public.codes', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.codes', 'DELETE'),
  'and the refusal is at the GRANT layer too, not only the policy layer'
);

set local role anon;
do $$
declare code text := 'none (the select SUCCEEDED)';
begin
  begin
    perform count(*) from public.code_sets;
  exception when insufficient_privilege then code := sqlstate;
  end;
  perform pg_temp.expect(
    code = '42501',
    'and anon reaches no code set either — the read is for members, not the public, got ' || code
  );
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- THE KIOSK ROLE (0042) AND THE FOUR DOORS 0043 SHUT
--
-- `caller_centre_ids()` trusts a membership row without asking in what capacity, so
-- every policy reading it would hand a door tablet whatever a parent gets. This
-- section exists to prove that a kiosk membership is worth *nothing* beyond the
-- centre's own name.
--
-- Every negative below is paired with the positive that makes it mean something. A
-- narrowing that broke `caller_person_centre_ids()` outright — returning no rows to
-- anybody — would satisfy all four refusals perfectly, and this suite has already
-- been taught that lesson once by a view that threw 42501 for everyone.
-- ===========================================================================

set local role postgres;

insert into auth.users (id, email, instance_id, aud, role, created_at, updated_at)
values ('66666666-6666-4666-8666-666666666666', 'kiosk@rlstest.invalid',
        '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
on conflict (id) do nothing;

-- A device at centre A. Not a person: it has no guardian link and no staff record.
insert into public.memberships (centre_id, user_id, role) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666666', 'kiosk')
on conflict do nothing;

/*
 * A photograph on the published pānui, seeded here rather than reused from the media
 * section above — everything there is either deleted by the "staff can still delete
 * what they cannot read" test or hidden by the consent-withdrawal one, so an educator
 * legitimately sees none of it and it makes a useless control.
 *
 * This one has no `media_children`, so no consent gate stands between the reader and
 * the row. That isolates the thing under test: the pānui branch of `media_select`,
 * which is the branch 0043 narrowed.
 */
insert into public.media (id, centre_id, post_id, kind, audience, storage_path, uploaded_by)
values ('22222222-aaaa-4aaa-8aaa-0000000000aa', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-aaaa-4aaa-8aaa-000000000002', 'photo', 'journal',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/kiosk-panui.jpg',
        '55555555-5555-4555-8555-555555555555')
on conflict (id) do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';

-- Kept deliberately. A kiosk renders the centre's name on the screen.
select pg_temp.expect(
  (select count(*) from public.centres
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'a kiosk CAN read its own centre — it has to put the name on the screen'
);

select pg_temp.expect(
  (select count(*) from public.posts
    where id = '11111111-aaaa-4aaa-8aaa-000000000002') = 0,
  'a kiosk CANNOT read a published pānui, which a parent at the same centre can'
);

-- THE ONE THAT MATTERS. Media on a published pānui is photographs of children, and
-- the screen this role runs on faces the entrance.
select pg_temp.expect(
  (select count(*) from public.media
    where id = '22222222-aaaa-4aaa-8aaa-0000000000aa') = 0,
  'a kiosk CANNOT read the photograph on the pānui — the screen faces the entrance'
);

select pg_temp.expect(
  (select count(*) from public.memberships
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'a kiosk CANNOT read the membership list'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.message_threads (centre_id, child_id, subject, started_by)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', null, 'From the door',
            '66666666-6666-4666-8666-666666666666');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a kiosk CANNOT start a message thread as the centre');
end $$;

select pg_temp.expect(
  (select count(*) from public.children
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'and reads no children at all — 0042 grants a name on a door, not a roll'
);

/*
 * THE POSITIVE CONTROLS.
 *
 * Priya is a parent at the same centre. If any of these have gone dark, the four
 * refusals above are worthless and the narrowing has broken the product rather than
 * secured it.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.posts
    where id = '11111111-aaaa-4aaa-8aaa-000000000002') = 1,
  'a parent STILL reads the published pānui after the narrowing'
);

select pg_temp.expect(
  (select count(*) from public.memberships
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') > 0,
  'and STILL reads the membership list'
);

select pg_temp.expect(
  (select count(*) from public.media
    where id = '22222222-aaaa-4aaa-8aaa-0000000000aa') = 1,
  'and a parent STILL reads the photograph on that pānui — the branch 0043 narrowed'
);

-- ===========================================================================
-- THE DOOR TABLET (0044) — PINs, attestation, and what the kiosk still cannot do
--
-- The riskiest surface in the repo: an authentication factor, and a write into the
-- table a funding claim rests on. Everything below runs as the kiosk from 0042.
-- ===========================================================================

set local role postgres;

/*
 * Ana has two guardians, and the difference between them is the point.
 *
 * Priya is her mother and may collect. `d3333333` is her grandmother, on the record
 * with no app account — the ordinary case — and here she is NOT on the collection
 * list. That pairing is the assertion this section exists for, and it is a real
 * arrangement rather than a contrived one: a grandparent who may drop off but whom a
 * parenting order does not permit to take the child away.
 */
update public.child_guardians set can_collect = true
 where guardian_id = 'd1111111-1111-4111-8111-111111111111';
update public.child_guardians set can_collect = false
 where guardian_id = 'd3333333-3333-4333-8333-333333333333';

set local role authenticated;

-- A manager sets the PINs. The office is the only place a PIN is ever set.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_guardian_pin('d1111111-1111-4111-8111-111111111111', '4821');
select public.set_guardian_pin('d3333333-3333-4333-8333-333333333333', '9134');

select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'guardian_pins'
      and entity_id = 'd1111111-1111-4111-8111-111111111111') >= 1,
  'setting a PIN is AUDITED, and the audit names the guardian'
);

/*
 * THE ASSERTION THAT ALMOST WAS NOT WRITTEN.
 *
 * The class-level check further down asserts every table CARRIES the audit trigger.
 * `guardian_pins` carries no `centre_id`, `child_id` or `invoice_id`, and
 * `audit_trigger` gives up silently when it cannot attribute a row to a tenant — so
 * the trigger would have existed, the class check would have passed, and not one row
 * would ever have been written. The positive above is what makes the class check
 * mean anything here.
 */

-- Nobody reads a hash. Not staff, not the service role, not the kiosk.
do $$
declare ok boolean := false;
begin
  begin
    perform pin_hash from public.guardian_pins limit 1;
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an OWNER cannot read a PIN hash — the table has no policy at all');
end $$;

select pg_temp.expect(
  (select has_pin from public.guardian_pin_status('d1111111-1111-4111-8111-111111111111')),
  'but an owner CAN see that a PIN exists, which is the phone call the office takes'
);

-- ---------------------------------------------------------------------------
-- Now as the door tablet.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.kiosk_roll()) > 0,
  'a kiosk CAN read the roll through the function — three columns and no more'
);

select pg_temp.expect(
  (select count(*) from public.children) = 0,
  'while the children TABLE stays closed to it — the function is the only door'
);

select pg_temp.expect(
  (select count(*) from public.kiosk_guardians('a1111111-1111-4111-8111-111111111111')) > 0,
  'and CAN list the adults for a child it was asked about'
);

-- A wrong PIN is refused, and the refusal is COUNTED. This is the one that a
-- `raise exception` would have broken: the increment would roll back with the error
-- and the limiter would count to one forever.
select pg_temp.expect(
  public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'in', now(),
                          gen_random_uuid(), 'd1111111-1111-4111-8111-111111111111', '0000')
    = 'wrong_pin',
  'a wrong PIN is refused'
);

set local role postgres;
select pg_temp.expect(
  (select failed_attempts from public.guardian_pins
    where guardian_id = 'd1111111-1111-4111-8111-111111111111') = 1,
  'and the attempt SURVIVED the refusal — a raise here would have rolled the counter back'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';

-- The right PIN signs the child in, and the event names who attested it.
do $$
declare v_key uuid := gen_random_uuid();
begin
  perform pg_temp.expect(
    public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'in', now(),
                            v_key, 'd1111111-1111-4111-8111-111111111111', '4821') = 'recorded',
    'the right PIN signs the child in'
  );
  -- Same key again: reported as success, and does NOT write a second event. A parent
  -- told the write failed taps again.
  perform pg_temp.expect(
    public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'in', now(),
                            v_key, 'd1111111-1111-4111-8111-111111111111', '4821') = 'duplicate',
    'and repeating the same client key is a duplicate, not a second child in the room'
  );
end $$;

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.attendance_events
    where child_id = 'a1111111-1111-4111-8111-111111111111'
      and attested_by = 'd1111111-1111-4111-8111-111111111111') = 1,
  'exactly one event, and it records WHICH GUARDIAN attested it'
);
select pg_temp.expect(
  (select count(*) from public.guardian_pins
    where guardian_id = 'd1111111-1111-4111-8111-111111111111'
      and failed_attempts = 0) = 1,
  'and a correct PIN clears the failed attempts'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';

/*
 * THE SAFETY ASSERTION.
 *
 * `can_collect` has been data staff read off a screen since 0003; this is the first
 * thing in the repo to ENFORCE it, because a door has no human gatekeeper. Quinn may
 * bring Beau in and may not take him away.
 */
select pg_temp.expect(
  public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'in', now(),
                          gen_random_uuid(), 'd3333333-3333-4333-8333-333333333333', '9134')
    = 'recorded',
  'the grandmother who may NOT collect can still sign Ana IN — bringing a child is not taking one'
);

select pg_temp.expect(
  public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'out', now(),
                          gen_random_uuid(), 'd3333333-3333-4333-8333-333333333333', '9134')
    = 'not_permitted',
  'but CANNOT sign her OUT — can_collect is enforced at the door, not merely displayed'
);

-- And the mother, who may collect, can.
select pg_temp.expect(
  public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'out', now(),
                          gen_random_uuid(), 'd1111111-1111-4111-8111-111111111111', '4821')
    = 'recorded',
  'while the guardian who MAY collect signs her out — the refusal above is about the flag'
);

/*
 * Quinn is Beau's father and nothing to do with Ana. Refused before the PIN is even
 * looked at, which is why no PIN is set for Quinn anywhere in this suite.
 */
select pg_temp.expect(
  public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'in', now(),
                          gen_random_uuid(), 'd2222222-2222-4222-8222-222222222222', '4821')
    = 'not_permitted',
  'a guardian CANNOT attest for a child who is not theirs'
);

-- A guardian with no PIN is told so, rather than refused as though they were a stranger.
select pg_temp.expect(
  public.kiosk_sign_child('b2222222-2222-4222-8222-222222222222', 'in', now(),
                          gen_random_uuid(), 'd2222222-2222-4222-8222-222222222222', '4821')
    = 'no_pin',
  'and a guardian who has never been given a PIN gets no_pin, not a refusal'
);

-- And the kiosk still cannot write attendance directly. The definer function is the
-- only path; the policy was deliberately not widened.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_events (child_id, kind, at, recorded_by, client_uuid)
    values ('a1111111-1111-4111-8111-111111111111', 'in', now(),
            '66666666-6666-4666-8666-666666666666', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'a kiosk CANNOT insert attendance directly — attendance_insert was never widened'
  );
end $$;

-- The old attribution rule still holds for everybody else. 0044 must not have
-- loosened the table it added a column to.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_events (child_id, kind, at, recorded_by, client_uuid)
    values ('a1111111-1111-4111-8111-111111111111', 'in', now(),
            '11111111-1111-4111-8111-111111111111', gen_random_uuid());
  exception when others then ok := true;
  end;
  perform pg_temp.expect(
    ok,
    'and an educator STILL cannot attribute an event to somebody else — 0009''s rule is intact'
  );
end $$;

-- A person is not a kiosk, whatever else they are.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  public.caller_kiosk_centre_id() is null and (select count(*) from public.kiosk_roll()) = 0,
  'a parent is not a kiosk and the roll function tells them nothing'
);

select pg_temp.expect(
  public.kiosk_sign_child('a1111111-1111-4111-8111-111111111111', 'in', now(),
                          gen_random_uuid(), 'd1111111-1111-4111-8111-111111111111', '4821')
    = 'not_permitted',
  'and a parent CANNOT use the kiosk write path from their own phone'
);

-- Setting a PIN is the office's job, not a parent's.
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_guardian_pin('d1111111-1111-4111-8111-111111111111', '1111');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT set their own PIN — the office does it');
end $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

-- ===========================================================================
-- RETENTION AND PURGING
--
-- `purge_child` is the most destructive thing in the product and it is SECURITY
-- DEFINER, so it bypasses every policy above. Every one of its guards is therefore
-- the only thing standing between a caller and another centre's records.
-- ===========================================================================

-- An educator, who must not be able to purge anything.
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

do $$
declare msg text := 'none (the purge SUCCEEDED)';
begin
  begin
    perform public.purge_child('b2222222-2222-4222-8222-222222222222', 'testing whether this is allowed');
  exception when others then msg := sqlstate;
  end;
  perform pg_temp.expect(msg <> 'none (the purge SUCCEEDED)',
    'an educator CANNOT purge a child record');
end $$;

-- A parent, on their own child.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare msg text := 'none (the purge SUCCEEDED)';
begin
  begin
    perform public.purge_child('a1111111-1111-4111-8111-111111111111', 'a parent asking for erasure');
  exception when others then msg := sqlstate;
  end;
  perform pg_temp.expect(msg <> 'none (the purge SUCCEEDED)',
    'a parent CANNOT purge their own child''s record');
end $$;

-- The owner of the OTHER centre. security definer means the function itself has to
-- check this; nothing else would.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare msg text := 'none (the purge SUCCEEDED)';
begin
  begin
    perform public.purge_child('a1111111-1111-4111-8111-111111111111', 'purging another centre''s child');
  exception when others then msg := sqlstate;
  end;
  perform pg_temp.expect(msg <> 'none (the purge SUCCEEDED)',
    'an owner of another centre CANNOT purge this centre''s child');
end $$;

-- The right owner, but the child is still enrolled. This is the guard against
-- removing a record that has become inconvenient while the child still attends.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare msg text := 'none';
begin
  begin
    perform public.purge_child('a1111111-1111-4111-8111-111111111111', 'no longer needed, please remove');
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.expect(msg like '%still enrolled%',
    'an owner CANNOT purge a child who is still enrolled');
end $$;

-- NOTE ON PLACEMENT: this block sits ABOVE the purge and offboarding sections on
-- purpose. `caller_ward_ids()` requires a LIVE membership, and those sections revoke
-- Priya's and archive Ana. Placed after them, every assertion here fails with a policy
-- violation that looks like a broken policy and is actually a revoked parent — which is
-- what happened on the first attempt.

-- ===========================================================================
-- POST COMMENTS — 0076
--
-- The delegation is the thing under test. `post_comments_select` says
-- `post_id in (select id from public.posts)` and nothing about guardianship, so if that
-- subquery did not carry `posts_select`'s rules, Quinn would read a comment on a
-- learning moment about Priya's child. That is the assertion this section exists for;
-- the moderation states are the rest.
--
-- Priya (33333333) and Quinn (44444444) are both parents at centre A with different
-- children — the boundary *inside* a tenant. Ed (55555555) is an educator there.
--
-- PLACEMENT: above the purge and offboarding sections, for the reason the note directly
-- above this one gives. Those revoke Priya's membership and archive Ana, and every
-- assertion here needs both alive. Appended to the end of the file first, where the
-- fixture insert failed on a foreign key to a purged child.
-- ===========================================================================

set local role postgres;

-- A published pānui: the whole centre may read it, so both parents may comment.
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
values ('e0760000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'Comment test panui', 'Body', '11111111-1111-4111-8111-111111111111', now());

-- A published learning moment naming ANA ONLY. Priya may read it; Quinn may not.
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
values ('e0760000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'learning_moment', 'Ana at the easel', 'Body', '11111111-1111-4111-8111-111111111111', now());
insert into public.post_children (post_id, child_id)
values ('e0760000-0000-4000-8000-000000000002', 'a1111111-1111-4111-8111-111111111111');

-- A draft, an auto-approving post, and one with comments off.
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at, comment_mode)
values ('e0760000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'Comment test draft', 'Body', '11111111-1111-4111-8111-111111111111', null, 'approved_first'),
       ('e0760000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'Auto approve panui', 'Body', '11111111-1111-4111-8111-111111111111', now(), 'auto'),
       ('e0760000-0000-4000-8000-000000000005', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'Comments off panui', 'Body', '11111111-1111-4111-8111-111111111111', now(), 'disabled');

select pg_temp.expect(
  (select comment_mode from public.posts
    where id = 'e0760000-0000-4000-8000-000000000001') = 'approved_first',
  'a post defaults to approved_first — a comment does not appear before somebody reads it'
);

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Priya comments on the pānui. It is pending, and pending is nearly private.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

insert into public.post_comments (id, post_id, author_id, body)
values ('c0760000-0000-4000-8000-000000000001', 'e0760000-0000-4000-8000-000000000001',
        '33333333-3333-4333-8333-333333333333', 'Lovely, thank you.');

select pg_temp.expect(
  (select approved_at is null and declined_at is null and moderated_by is null
     from public.post_comments where id = 'c0760000-0000-4000-8000-000000000001'),
  'a comment on an approved_first post arrives pending, with nobody recorded as having decided'
);

select pg_temp.expect(
  (select count(*) from public.post_comments
    where id = 'c0760000-0000-4000-8000-000000000001') = 1,
  'the author reads her own pending comment — otherwise she types into a void'
);

-- The author cannot approve herself. `post_comments_moderate` excludes her in USING, so
-- this filters to zero rows rather than raising.
do $$
declare still_pending boolean;
begin
  begin
    update public.post_comments set approved_at = now()
     where id = 'c0760000-0000-4000-8000-000000000001';
  exception when others then null;
  end;
  still_pending := (select approved_at is null from public.post_comments
                     where id = 'c0760000-0000-4000-8000-000000000001');
  perform pg_temp.expect(coalesce(still_pending, false),
    'a parent CANNOT approve her own comment — that is the queue with an opt-out');
end $$;

-- ---------------------------------------------------------------------------
-- Quinn: same centre, same pānui, and he must not see it while it is pending.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.post_comments
    where id = 'c0760000-0000-4000-8000-000000000001') = 0,
  'another parent at the same centre does NOT see a pending comment'
);

-- ---------------------------------------------------------------------------
-- Ed moderates. The stamp is the trigger's, not the client's.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.post_comments
    where id = 'c0760000-0000-4000-8000-000000000001') = 1,
  'an educator at the centre sees the pending comment — somebody has to moderate it'
);

-- Approve it, and deliberately leave `moderated_by` alone: the trigger must fill it.
update public.post_comments set approved_at = now()
 where id = 'c0760000-0000-4000-8000-000000000001';

select pg_temp.expect(
  (select moderated_by = '55555555-5555-4555-8555-555555555555'
     from public.post_comments where id = 'c0760000-0000-4000-8000-000000000001'),
  'approving stamps the moderator from auth.uid(), though the UPDATE never set it'
);

-- The column grant is the boundary on what a moderator may touch. Rewriting a parent's
-- words while leaving her name on them is what this refuses.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.post_comments set body = 'Something Priya never said'
     where id = 'c0760000-0000-4000-8000-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'an educator CANNOT rewrite the body of a comment, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.post_comments where id = 'c0760000-0000-4000-8000-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'nobody deletes a comment — append-only, like messages, got ' || code);
end $$;

-- ---------------------------------------------------------------------------
-- Approved, so now Quinn sees it.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.post_comments
    where id = 'c0760000-0000-4000-8000-000000000001') = 1,
  'once approved, the comment is visible to everyone who can read the pānui'
);

-- ---------------------------------------------------------------------------
-- THE ONE THIS SECTION EXISTS FOR: the delegated subquery carries guardianship.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

insert into public.post_comments (id, post_id, author_id, body)
values ('c0760000-0000-4000-8000-000000000002', 'e0760000-0000-4000-8000-000000000002',
        '33333333-3333-4333-8333-333333333333', 'She loves painting at home too.');

set local role postgres;
update public.post_comments
   set approved_at = now(), moderated_by = '11111111-1111-4111-8111-111111111111'
 where id = 'c0760000-0000-4000-8000-000000000002';
set local role authenticated;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.post_comments
    where id = 'c0760000-0000-4000-8000-000000000002') = 1,
  'Ana''s mother reads an APPROVED comment on a post about Ana'
);

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.post_comments
    where id = 'c0760000-0000-4000-8000-000000000002') = 0,
  'Beau''s father does NOT read a comment on a learning moment about Ana — the delegated subquery carries guardianship'
);

-- And he cannot write one there either: the INSERT policy delegates the same way.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.post_comments (post_id, author_id, body)
    values ('e0760000-0000-4000-8000-000000000002',
            '44444444-4444-4444-8444-444444444444', 'Who is this?');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT comment on a post about somebody else''s child');
end $$;

-- ---------------------------------------------------------------------------
-- The three modes, and the draft.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

insert into public.post_comments (id, post_id, author_id, body)
values ('c0760000-0000-4000-8000-000000000003', 'e0760000-0000-4000-8000-000000000004',
        '33333333-3333-4333-8333-333333333333', 'Noted, thanks.');

select pg_temp.expect(
  (select approved_at is not null and moderated_by is null
     from public.post_comments where id = 'c0760000-0000-4000-8000-000000000003'),
  'auto mode approves on insert and records NO moderator — nobody read it, and that stays true'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.post_comments (post_id, author_id, body)
    values ('e0760000-0000-4000-8000-000000000005',
            '33333333-3333-4333-8333-333333333333', 'Hello?');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a post with comments disabled refuses one');
end $$;

-- A parent cannot see the draft at all, so the INSERT policy stops this before the
-- trigger does. The educator below is the case where the trigger is the only guard left.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.post_comments (post_id, author_id, body)
    values ('e0760000-0000-4000-8000-000000000003',
            '33333333-3333-4333-8333-333333333333', 'Early bird');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a parent CANNOT comment on a draft — they cannot see it');
end $$;

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.post_comments (post_id, author_id, body)
    values ('e0760000-0000-4000-8000-000000000003',
            '55555555-5555-4555-8555-555555555555', 'Starting the thread early');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'an educator CAN see the draft and still CANNOT comment on it — here the trigger is the only guard left');
end $$;

-- Nobody comments as somebody else. Sharper than the same rule on a post: a comment
-- attributed to the wrong parent is a sentence in their mouth about a child.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.post_comments (post_id, author_id, body)
    values ('e0760000-0000-4000-8000-000000000001',
            '33333333-3333-4333-8333-333333333333', 'Signed, Priya');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an educator CANNOT post a comment attributed to a parent');
end $$;

-- ---------------------------------------------------------------------------
-- The tenant boundary, which must never depend on a subquery being clever.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.post_comments) = 0,
  'centre B sees none of centre A''s comments'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.post_comments (post_id, author_id, body)
    values ('e0760000-0000-4000-8000-000000000001',
            '22222222-2222-4222-8222-222222222222', 'Hello from the other centre');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'centre B CANNOT comment on centre A''s post');
end $$;

-- ---------------------------------------------------------------------------
-- Pinning: a column on `posts`, so the only new question is who may set it.
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
update public.posts set pinned_at = now()
 where id = 'e0760000-0000-4000-8000-000000000001';

select pg_temp.expect(
  (select pinned_at is not null from public.posts
    where id = 'e0760000-0000-4000-8000-000000000001'),
  'an owner pins a post to the top of the feed'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare still_pinned boolean;
begin
  begin
    update public.posts set pinned_at = null
     where id = 'e0760000-0000-4000-8000-000000000001';
  exception when others then null;
  end;
  still_pinned := (select pinned_at is not null from public.posts
                    where id = 'e0760000-0000-4000-8000-000000000001');
  perform pg_temp.expect(coalesce(still_pinned, false),
    'a parent CANNOT unpin a post — posts_write_update excludes them');
end $$;

-- ===========================================================================
-- THE 14-DAY RULE — 0078, moved from CHECK to trigger
--
-- Six tables refuse a row whose timestamp is more than a fortnight old. Until 0078 that
-- was a CHECK constraint, which made the operational core unrestorable: a CHECK is
-- pre-data in a dump and is enforced while the rows land, so a backup of the roll, sleep,
-- medication or staff attendance older than two weeks could not be loaded. `drill:restore`
-- found it and stayed red for eleven days.
--
-- WHY THESE ASSERTIONS AND NOT JUST A GREEN DRILL. The drill builds its shadow tables
-- with `like … including all`, and LIKE does not copy triggers. So after 0078 the drill
-- passes whether the guard was moved or simply deleted, and it cannot tell the two apart.
-- These four blocks are where "the guard still works" is actually proved.
--
-- THE MUTATION THAT WOULD BE SILENT. `reject_ancient_row` reads its column name from
-- `tg_argv[0]` through `to_jsonb(new) ->> …`. A wrong name yields NULL, the null branch
-- returns early, and the trigger accepts everything on that table for ever — no error,
-- no failing test, a guard that is only decoration. Five of the six pass 'at' and
-- medication_administrations passes 'given_at', so the wiring is asserted from the
-- catalogue rather than assumed.
--
-- PLACEMENT: above the purge and offboarding sections, per the note earlier in this file.
-- Nothing here needs a live membership — it runs as `postgres` and touches only a centre
-- — but the convention is worth keeping so the next section does not have to think.
-- ===========================================================================

set local role postgres;

do $$
declare
  msg text := '';
  v_id bigint;
begin
  -- 1. The guard still refuses. This is the behaviour 0009 through 0039 shipped and the
  --    whole point of not simply dropping the six constraints.
  begin
    insert into public.staff_count_events (centre_id, adults, at, client_uuid)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3,
            now() - interval '30 days', gen_random_uuid());
    msg := 'accepted';
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.expect(msg like '%14 day window%',
    'a row older than fourteen days is still REFUSED — the guard survived the move');

  -- 2. A current row is unaffected. A guard that refuses everything would also pass (1).
  insert into public.staff_count_events (centre_id, adults, at, client_uuid)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3, now(), gen_random_uuid())
  returning id into v_id;
  perform pg_temp.expect(v_id is not null,
    'a row recorded now is still accepted');

  -- 3. The boundary. Thirteen days is inside the window and fifteen is not, so the
  --    interval itself is asserted rather than "something old was refused".
  insert into public.staff_count_events (centre_id, adults, at, client_uuid)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3,
          now() - interval '13 days', gen_random_uuid())
  returning id into v_id;
  perform pg_temp.expect(v_id is not null,
    'thirteen days old is inside the window');
end $$;

do $$
declare
  v_id bigint;
begin
  -- 4. The escape hatch opens. This is the half that makes a real recovery from the
  --    JSON extract possible at all: recreate the schema, set the flag, load the rows.
  --    Deliberately NOT a security control — anyone who can insert can set it — because
  --    the rule it relaxes is a typo guard and the tenant boundary is RLS.
  set local app.restoring = 'on';
  insert into public.staff_count_events (centre_id, adults, at, client_uuid)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3,
          now() - interval '400 days', gen_random_uuid())
  returning id into v_id;
  perform pg_temp.expect(v_id is not null,
    'app.restoring = on lets a four-hundred-day-old row load');
end $$;

do $$
declare
  msg text := '';
begin
  -- And it closes again. `set local` ends with the transaction, but the flag must not
  -- leak across statements within one either — a restore flag that stays on after the
  -- restore is a guard that is off in production and nobody notices.
  reset app.restoring;
  begin
    insert into public.staff_count_events (centre_id, adults, at, client_uuid)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 3,
            now() - interval '400 days', gen_random_uuid());
    msg := 'accepted';
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.expect(msg like '%14 day window%',
    'and the guard closes again once app.restoring is reset');
end $$;

do $$
declare
  v_wrong text;
  v_count int;
begin
  -- 5. The wiring, from the catalogue. tgargs is a null-separated bytea; the column name
  --    is everything before the first null byte.
  select string_agg(c.relname || ' passes ' || coalesce(a.col, '(nothing)'), ', ' order by c.relname)
    into v_wrong
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral (
      select split_part(encode(g.tgargs, 'escape'), '\000', 1) as col
    ) a
   where n.nspname = 'public'
     and g.tgname like '%\_not\_ancient'
     and not g.tgisinternal
     and a.col is distinct from (case c.relname when 'medication_administrations'
                                                then 'given_at' else 'at' end);
  perform pg_temp.expect(v_wrong is null,
    'every 14-day trigger reads the right timestamp column — a wrong one is a silent no-op');

  select count(*) into v_count
    from pg_trigger g
    join pg_class c on c.oid = g.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and g.tgname like '%\_not\_ancient' and not g.tgisinternal;
  perform pg_temp.expect(v_count = 6,
    'all six tables carry the trigger');

  select count(*) into v_count
    from pg_constraint where contype = 'c' and conname like '%\_not\_ancient';
  perform pg_temp.expect(v_count = 0,
    'and no time-relative CHECK survives to break the next restore');
end $$;

-- ---------------------------------------------------------------------------
-- CONSENT REQUESTS (0073) — asking, and the third state
--
-- The mechanism for a parent to record consent has existed since 0004. What 0073 adds is
-- the record that the centre ASKED, which is what separates "nobody has answered" from
-- "we asked and nobody has answered". Everything below is about who may write that record,
-- who may read it, and that nobody may change it.
--
-- Ana (a1111111) is the case that matters: she has TWO guardians, Priya (d1111111, account
-- 33333333) and Ana Other-Guardian (d3333333, NO account). One ask must reach both, and
-- must notify only the one who can be notified.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

/*
 * The kinds here are chosen, not arbitrary. Ana's `photo_internal` is granted and then
 * withdrawn earlier in this file, and a withdrawal IS an answer — offering it here would
 * produce two rows rather than four and the failure would read as a broken cross product
 * rather than as the skip rule working. Which is exactly what it did on the first run.
 */
do $$
declare n integer;
begin
  n := public.request_consent(
    'a1111111-1111-4111-8111-111111111111',
    array['sunscreen', 'medical_emergency']::public.consent_kind[],
    'Before the trip on the 12th.');
  -- Two guardians times two kinds. The cross product is the point: an ask that reached one
  -- guardian would leave the other able to say nobody asked them.
  perform pg_temp.expect(n = 4, 'an OWNER asks, and both of Ana''s guardians are asked for both kinds');
end $$;

select pg_temp.expect(
  (select count(distinct guardian_id) from public.consent_requests
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 2,
  'the guardian with no app account is asked too — the ask is a fact about the centre, not about who has a login'
);

/*
 * ONE NOTIFICATION PER GUARDIAN, NEVER ONE PER KIND.
 *
 * 0063's lesson and the reason it is asserted rather than trusted: four required consents
 * across two guardians is eight letters for one enrolment, which is a muted inbox — and a
 * muted inbox takes 0057's emergency channel with it. Two kinds were asked; Priya gets one
 * letter.
 */
-- Read as PRIYA, not as the owner. `notifications_own` scopes the inbox to its owner, so
-- asserting this as Alice counts zero and would have read as "the notification was never
-- sent" — which is what it did on the first run. Reading it as the recipient also proves
-- the thing that actually matters: it reached somebody who can open it.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.notifications
    where kind = 'reminder'
      and route = '/children/a1111111-1111-4111-8111-111111111111/documents') = 1,
  'the guardian with an account gets exactly ONE notification for a two-kind ask'
);

/*
 * AND EXACTLY ONE LETTER LEFT THE BUILDING IN TOTAL.
 *
 * Counted as postgres because it spans every inbox, which is the only way to prove a
 * negative about somebody else's: Ana's other guardian has no account, so there is nowhere
 * to send to and nothing should have been attempted. One ask, two guardians, two kinds,
 * one letter.
 */
set local role postgres;

select pg_temp.expect(
  (select count(*) from public.notifications
    where route = '/children/a1111111-1111-4111-8111-111111111111/documents') = 1,
  'and the guardian with no account gets none, because there is nowhere to send it'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

/*
 * A KIND THAT ALREADY HAS AN ANSWER IS NOT ASKED FOR.
 *
 * Re-asking a granted consent is noise; re-asking a refused one is pressure, and a product
 * should not automate that. `excursion` is answered first, then offered alongside an
 * unanswered kind — only the unanswered one produces rows.
 */
do $$
declare n integer;
begin
  insert into public.consent_events (child_id, kind, granted, given_by)
  values ('a1111111-1111-4111-8111-111111111111', 'excursion', true,
          'd1111111-1111-4111-8111-111111111111');

  n := public.request_consent(
    'a1111111-1111-4111-8111-111111111111',
    array['excursion', 'transport']::public.consent_kind[]);
  -- Two guardians times ONE still-unanswered kind. `excursion` is dropped.
  perform pg_temp.expect(n = 2, 'an answered kind is skipped; only the unanswered one is asked');
end $$;

select pg_temp.expect(
  (select count(*) from public.consent_requests
    where child_id = 'a1111111-1111-4111-8111-111111111111' and kind = 'excursion') = 0,
  'and no row was written for the kind that already had a decision'
);

/*
 * A PARENT MAY NOT ASK.
 *
 * Asking is the centre's act. This is the assertion that matters most in this block: the
 * function is SECURITY DEFINER because it writes into other people's inboxes, so the staff
 * check inside it is the ONLY thing standing between `authenticated` and an arbitrary
 * notification to another family. If that check is ever dropped, this is the row that says so.
 */
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    perform public.request_consent(
      'a1111111-1111-4111-8111-111111111111',
      array['photo_public']::public.consent_kind[]);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a PARENT cannot ask — even about their own child');
end $$;

-- But she can see that she was asked. A request the family cannot read has not been made.
select pg_temp.expect(
  (select count(*) from public.consent_requests
    where child_id = 'a1111111-1111-4111-8111-111111111111'
      and guardian_id = 'd1111111-1111-4111-8111-111111111111') = 3,
  'a PARENT reads the asks addressed to them'
);

-- And the guardianship boundary holds inside the centre: Quinn is Beau's father.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.consent_requests
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'another family at the SAME centre reads none of Ana''s asks'
);

/*
 * APPEND-ONLY IS A GRANT, NOT A POLICY — AGENTS.md §4.4.
 *
 * There is no UPDATE or DELETE policy, and more to the point no grant, so these fail at the
 * privilege check before RLS is consulted. Asserted for the owner rather than a parent
 * because the owner is the caller most likely to have been given a way round it by accident.
 */
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    update public.consent_requests set requested_at = now() - interval '1 year';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'NOBODY can edit an ask — not even the owner');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    delete from public.consent_requests;
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and nobody can delete one');
end $$;

-- Cross-centre: Bob owns centre B and has no business asking about a centre A child.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    perform public.request_consent(
      'a1111111-1111-4111-8111-111111111111',
      array['photo_public']::public.consent_kind[]);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an owner of ANOTHER centre cannot ask about this centre''s child');
end $$;

select pg_temp.expect(
  (select count(*) from public.consent_requests) = 0,
  'and reads none of them'
);

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- DETAIL CONFIRMATIONS (0055)
--
-- A family says their details are right. The interesting properties are that a guardian
-- can only confirm for their OWN child and only as THEMSELVES, and that nobody at all can
-- edit the result — a confirmation that could be rewritten answers nothing.
-- ---------------------------------------------------------------------------

-- Priya (guardian d1111111, account 33333333) confirms for Ana (a1111111), her ward.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.detail_confirmations (child_id, guardian_id)
  values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a guardian confirms their own child''s details are current');
end $$;

select pg_temp.expect(
  (select count(*) from public.detail_confirmations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'and reads it back'
);

/*
 * NOT FOR SOMEBODY ELSE'S CHILD.
 *
 * The boundary inside a centre: Beau is at the same service and is not Priya's ward.
 * `caller_ward_ids` is guardianship rather than visibility, which is what makes this
 * refusal different from the educator case below.
 */
do $$
declare ok boolean := false;
begin
  begin
    insert into public.detail_confirmations (child_id, guardian_id)
    values ('b2222222-2222-4222-8222-222222222222', 'd1111111-1111-4111-8111-111111111111');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a guardian CANNOT confirm for a child who is not theirs');
end $$;

/*
 * NOR IN SOMEBODY ELSE'S NAME.
 *
 * `d3333333` is Ana's grandmother — a real guardian of this child, with no app account.
 * Priya may confirm for Ana, but not *as* the grandmother: a confirmation filed on
 * somebody's behalf is a record of an assurance they never gave.
 */
do $$
declare ok boolean := false;
begin
  begin
    insert into public.detail_confirmations (child_id, guardian_id)
    values ('a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a guardian CANNOT confirm in another guardian''s name');
end $$;

/*
 * APPEND-ONLY, ASSERTED ON THE SQLSTATE.
 *
 * The verb is withheld by GRANT, so Postgres raises 42501 rather than filtering to zero
 * rows. "The update changed nothing" would also be true of a policy that simply did not
 * match, and the distinction is the design: a missing policy can be added by a later
 * migration without anybody noticing, a revoked grant cannot.
 */
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.detail_confirmations set confirmed_at = now() - interval '1 year'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'NOBODY can back-date a confirmation — an editable one answers nothing, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.detail_confirmations
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'and nobody can remove one, got ' || code);
end $$;

-- Including service_role, which is the branch that matters: the web app's server actions
-- hold that key.
set local role service_role;
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.detail_confirmations set confirmed_at = now() - interval '1 year';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'SERVICE_ROLE cannot rewrite a confirmation either, got ' || code);
end $$;
set local role authenticated;

-- Staff who can see the child can read it: "when did this family last check" is a question
-- the office and an educator planning a trip both have.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.detail_confirmations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'an educator can SEE when a family last confirmed'
);

-- But has nothing to confirm. Visibility is not guardianship, and this is the pair to the
-- refusal above: same table, different reason, and only one of them is about the child.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.detail_confirmations (child_id, guardian_id)
    values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an educator CANNOT confirm on a family''s behalf');
end $$;

-- Another centre sees nothing, through the child rather than through a centre_id column —
-- this table deliberately has none.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.detail_confirmations) = 0,
  'and another centre''s owner sees no confirmation at all'
);

-- ---------------------------------------------------------------------------
-- 0061 — the family's signature on the attendance record
--
-- Same shape as the block above and one predicate harder. `detail_confirmations` asks "is
-- this your ward"; this asks "is this your ward AND are you the person the centre named to
-- sign for it" — ECE Funding Handbook 6-3 criterion 4. Quinn is the reason the second half
-- of that sentence is testable: he is a real guardian of Beau, with an account and a parent
-- membership, and he is not a signatory.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.attendance_verifications
    (child_id, guardian_id, period_start, period_end, outcome, method)
  values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
          date '2026-08-03', date '2026-08-09', 'approved', 'portal');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'a named signatory verifies their own child''s week');
end $$;

/*
 * THE ASSERTION THIS TABLE EXISTS FOR.
 *
 * Quinn is Beau's father. He has an account, a parent membership, and Beau is his ward —
 * `caller_ward_ids()` returns Beau for him, so the policy `detail_confirmations` uses would
 * let this through. The centre has not named him an authorised signatory, so 6-3 says he
 * may not verify, and `caller_signatory_ward_ids()` is the difference.
 *
 * If the signatory predicate is ever dropped from the policy, or the column ever defaults
 * to true, this is the line that fails.
 */
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_verifications
      (child_id, guardian_id, period_start, period_end, outcome, method)
    values ('b2222222-2222-4222-8222-222222222222', 'd2222222-2222-4222-8222-222222222222',
            date '2026-08-03', date '2026-08-09', 'approved', 'portal');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok,
    'a guardian who is NOT a named signatory CANNOT verify, though the child is his own');
end $$;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- Not for somebody else's child, and not in another guardian's name. The same two refusals
-- the block above makes, because a signature filed on a family's behalf is a record of an
-- assurance nobody gave — and here it is evidence under a funding claim.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_verifications
      (child_id, guardian_id, period_start, period_end, outcome, method)
    values ('b2222222-2222-4222-8222-222222222222', 'd1111111-1111-4111-8111-111111111111',
            date '2026-08-03', date '2026-08-09', 'approved', 'portal');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a signatory CANNOT verify a week for a child who is not theirs');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_verifications
      (child_id, guardian_id, period_start, period_end, outcome, method)
    values ('a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333',
            date '2026-08-03', date '2026-08-09', 'approved', 'portal');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'and CANNOT verify in another guardian''s name');
end $$;

-- The two integrity rules, which are constraints rather than policies. A dispute nobody
-- explained can never be resolved, and a paper verification with no pointer to the paper is
-- the exact assertion this table exists to stop the product making.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_verifications
      (child_id, guardian_id, period_start, period_end, outcome, method)
    values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
            date '2026-07-27', date '2026-08-02', 'disputed', 'portal');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a dispute with no reason is refused');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_verifications
      (child_id, guardian_id, period_start, period_end, outcome, method)
    values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
            date '2026-07-27', date '2026-08-02', 'approved', 'paper');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a paper verification with no filed paper is refused');
end $$;

/*
 * APPEND-ONLY, ASSERTED ON THE SQLSTATE.
 *
 * Criterion 5 requires that any alteration to the record is evident. The cheapest way to
 * make an alteration evident is to make it impossible — so the verb is withheld by GRANT
 * and Postgres raises 42501 rather than filtering to zero rows. "The update changed
 * nothing" would also be true of a policy that merely failed to match.
 */
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.attendance_verifications set outcome = 'disputed'
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'NOBODY can turn a family''s approval into something else, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.attendance_verifications
     where child_id = 'a1111111-1111-4111-8111-111111111111';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'and nobody can remove a signature, got ' || code);
end $$;

-- Including service_role, which is the branch that matters: the web app's server actions
-- hold that key, so a policy alone would leave the evidence editable by the application
-- that renders it.
set local role service_role;
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.attendance_verifications set verified_at = now() - interval '1 year';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'SERVICE_ROLE cannot back-date a signature either, got ' || code);
end $$;
set local role authenticated;

-- Staff read it, because "has this family signed off last week" is the question the office
-- asks before preparing a funding claim. But an educator has nothing to sign.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.attendance_verifications
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'an educator can SEE that a family has verified a week'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.attendance_verifications
      (child_id, guardian_id, period_start, period_end, outcome, method)
    values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
            date '2026-07-27', date '2026-08-02', 'approved', 'portal');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an educator CANNOT verify on a family''s behalf');
end $$;

-- Another centre sees nothing, through the child rather than through a centre_id column —
-- this table deliberately has none either.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.attendance_verifications) = 0,
  'and another centre''s owner sees no signature at all'
);

-- ---------------------------------------------------------------------------
-- 0062 — the PIN becomes a signature: §6-3 verification from the door tablet
--
-- The portal block above proves the POLICY. A kiosk session never reaches that policy —
-- auth.uid() is the tablet — so 0062's definer functions restate every condition in
-- their own bodies, and a restated condition is a condition that can quietly diverge.
-- This block holds the two texts to the same answers, against the same people:
-- Priya may sign, Quinn may not, and — the sharpest case — Ana's own grandmother, a
-- real guardian of the RIGHT child holding a live PIN, may not either, because the
-- centre never named her a signatory.
-- ---------------------------------------------------------------------------

-- A completed week with real attendance, relative to now() so this block cannot rot:
-- attendance_not_ancient refuses anything older than a fortnight, and the most recent
-- fully-ended week is at worst thirteen days old.
set local role postgres;
do $$
declare
  v_tz    text;
  v_today date;
  v_end   date;
begin
  select timezone into v_tz from public.centres where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_today := (now() at time zone v_tz)::date;
  -- isodow: Mon=1..Sun=7, which is exactly the distance back to the last Sunday that
  -- has fully ended — the same rule lastCompletedWeek() applies in @ece/core.
  v_end := v_today - extract(isodow from v_today)::int;

  insert into public.attendance_events (child_id, kind, at, client_uuid)
  values
    ('a1111111-1111-4111-8111-111111111111', 'in',
     ((v_end - 2)::timestamp + interval '8 hours 5 minutes') at time zone v_tz, gen_random_uuid()),
    ('a1111111-1111-4111-8111-111111111111', 'out',
     ((v_end - 2)::timestamp + interval '15 hours 12 minutes') at time zone v_tz, gen_random_uuid());
end $$;

set local role authenticated;
set local request.jwt.claims = '{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}';

-- The gate itself is callable by NOBODY — not even the kiosk it exists for. As a public
-- function it would be a PIN oracle unscoped by caller_kiosk_centre_id(), so EXECUTE is
-- granted to no role and only another definer body can reach it.
do $$
declare code text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.kiosk_pin_gate('d1111111-1111-4111-8111-111111111111', '4821');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'kiosk_pin_gate is callable by NOBODY — an open gate is a PIN oracle, got ' || code);
end $$;

-- The week view refuses a wrong PIN, and the counter machinery is live behind it.
do $$
declare
  v_tz  text; v_end date; v jsonb;
begin
  select timezone into v_tz from public.centres where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_end := (now() at time zone v_tz)::date - extract(isodow from (now() at time zone v_tz)::date)::int;

  v := public.kiosk_week_attendance('a1111111-1111-4111-8111-111111111111',
                                    'd1111111-1111-4111-8111-111111111111',
                                    v_end - 6, v_end, '0000');
  perform pg_temp.expect(v->>'status' = 'wrong_pin',
    'the week view refuses a wrong PIN, got ' || (v->>'status'));

  -- With the right PIN it shows the week: both events, and the centre's own timezone
  -- riding along so no tablet renders these instants in the hardware's locale.
  v := public.kiosk_week_attendance('a1111111-1111-4111-8111-111111111111',
                                    'd1111111-1111-4111-8111-111111111111',
                                    v_end - 6, v_end, '4821');
  perform pg_temp.expect(v->>'status' = 'ok',
    'a named signatory with the right PIN is shown the week, got ' || (v->>'status'));
  perform pg_temp.expect(jsonb_array_length(v->'events') = 2,
    'and the week holds exactly the two events the fixture wrote');
  perform pg_temp.expect(v->>'timezone' = v_tz,
    'and the centre''s timezone rides along for the rendering');

  -- A week still running is refused for SHOWING, not just for signing — the door
  -- agrees with summariseVerification about what not-yet-due means.
  v := public.kiosk_week_attendance('a1111111-1111-4111-8111-111111111111',
                                    'd1111111-1111-4111-8111-111111111111',
                                    v_end + 1, v_end + 7, '4821');
  perform pg_temp.expect(v->>'status' = 'not_ended',
    'a week still running is not even shown, got ' || (v->>'status'));
end $$;

/*
 * THE GRANDMOTHER, WHO IS THE WHOLE OF CRITERION 4.
 *
 * d3333333 is a live guardian of THIS child with a working PIN ('9134') — she signs Ana
 * in at the door every day this suite pretends to have. The centre has not named her an
 * authorised signatory, and §6-3 criterion 4 draws the line exactly there. Quinn (below)
 * proves the wrong-child case; she proves the right-child-wrong-authority case, which is
 * the one a lazy predicate — "is a guardian, has a PIN" — would let through.
 *
 * The refusal must also arrive BEFORE the PIN gate: a not_permitted that varied by PIN
 * correctness would leak whether a PIN exists to whoever taps names at an unattended
 * tablet.
 */
do $$
declare
  v_tz  text; v_end date; v jsonb; r text;
begin
  select timezone into v_tz from public.centres where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_end := (now() at time zone v_tz)::date - extract(isodow from (now() at time zone v_tz)::date)::int;

  v := public.kiosk_week_attendance('a1111111-1111-4111-8111-111111111111',
                                    'd3333333-3333-4333-8333-333333333333',
                                    v_end - 6, v_end, '9134');
  perform pg_temp.expect(v->>'status' = 'not_permitted',
    'a guardian of the RIGHT child with a LIVE PIN who is not a named signatory sees nothing, got ' || (v->>'status'));

  r := public.kiosk_verify_attendance('a1111111-1111-4111-8111-111111111111',
                                      'd3333333-3333-4333-8333-333333333333',
                                      v_end - 6, v_end, 'approved', null, '9134');
  perform pg_temp.expect(r = 'not_permitted',
    'and cannot sign it either, got ' || r);

  -- Quinn: the wrong-child case, PIN correctness irrelevant and unprobed.
  r := public.kiosk_verify_attendance('a1111111-1111-4111-8111-111111111111',
                                      'd2222222-2222-4222-8222-222222222222',
                                      v_end - 6, v_end, 'approved', null, '4821');
  perform pg_temp.expect(r = 'not_permitted',
    'a guardian of a DIFFERENT child is refused before the PIN is even considered, got ' || r);
end $$;

-- The signature itself: a dispute must say why (front door, before the constraint), and
-- an approval lands as a kiosk-method row the portal block's policy work then governs.
do $$
declare
  v_tz  text; v_end date; r text;
begin
  select timezone into v_tz from public.centres where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_end := (now() at time zone v_tz)::date - extract(isodow from (now() at time zone v_tz)::date)::int;

  r := public.kiosk_verify_attendance('a1111111-1111-4111-8111-111111111111',
                                      'd1111111-1111-4111-8111-111111111111',
                                      v_end - 6, v_end, 'disputed', '   ', '4821');
  perform pg_temp.expect(r = 'comment_required',
    'a dispute with no reason is turned back at the door, got ' || r);

  r := public.kiosk_verify_attendance('a1111111-1111-4111-8111-111111111111',
                                      'd1111111-1111-4111-8111-111111111111',
                                      v_end - 6, v_end, 'approved', null, '4821');
  perform pg_temp.expect(r = 'recorded',
    'a named signatory approves the week at the door, got ' || r);
end $$;

-- The kiosk cannot READ what it just wrote — caller_may_see_child answers for people,
-- and a tablet is not one. The write landed; postgres confirms that below, with the
-- method recorded so the §6-3 export can say HOW each signature was given.
do $$
begin
  perform pg_temp.expect(
    (select count(*) from public.attendance_verifications where method = 'kiosk') = 0,
    'the tablet cannot read back the signature it carried');
end $$;

set local role postgres;
do $$
begin
  perform pg_temp.expect(
    (select count(*) from public.attendance_verifications
      where child_id = 'a1111111-1111-4111-8111-111111111111'
        and guardian_id = 'd1111111-1111-4111-8111-111111111111'
        and method = 'kiosk'
        and outcome = 'approved') = 1,
    'and the signature is there: one kiosk-method approval, attributed to the signatory');
end $$;
set local role authenticated;

-- A real person who is not a kiosk gets nothing from these functions, whatever their
-- standing — the portal is their path, and it identifies them properly.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare v jsonb;
begin
  v := public.kiosk_week_attendance('a1111111-1111-4111-8111-111111111111',
                                    'd1111111-1111-4111-8111-111111111111',
                                    date '2026-08-03', date '2026-08-09', '4821');
  perform pg_temp.expect(v->>'status' = 'not_permitted',
    'a signed-in PARENT cannot use the kiosk functions — the portal is their path, got ' || (v->>'status'));
end $$;

-- ---------------------------------------------------------------------------
-- 0063 — the absence the centre now hears about
--
-- The 0051 block above proves a guardian can flip a booked day to absent. This block
-- proves the three things 0063 added: the reason lands on the row and nowhere it should
-- not, the office is told exactly ONCE per submission however many days it covers, and
-- the private helpers are callable by nobody — the kiosk_pin_gate arrangement, because
-- `notify_absence` writes into other people's inboxes.
-- ---------------------------------------------------------------------------

-- Fixtures: three future booked days for Beau, with a hole at +42 so the range has a
-- no-booking day in the middle — the case that must not stop the days around it.
set local role postgres;
insert into public.bookings (centre_id, child_id, on_date, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222', current_date + 40, 'booked'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222', current_date + 41, 'booked'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'b2222222-2222-4222-8222-222222222222', current_date + 43, 'booked');

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- The helpers first: callable by nobody, not even the guardian the public functions serve.
do $$
declare code text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.report_absence_core('b2222222-2222-4222-8222-222222222222', current_date + 40, null);
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'report_absence_core is callable by NOBODY directly, got ' || code);
end $$;

do $$
declare code text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.notify_absence('b2222222-2222-4222-8222-222222222222',
                                  array[current_date + 40], 'forged');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'notify_absence is callable by NOBODY — an open version writes into every inbox, got ' || code);
end $$;

-- One day, with a reason.
select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date + 40, '  chickenpox  ')
    = 'recorded',
  'a guardian reports one day away with a reason'
);

/*
 * The reporter cannot see the letter their report produced — it sits in the OWNER's
 * inbox, and the notifications policy shows a person their own rows only. The first
 * version of this block counted the queue as Quinn and read 0, which was the policy
 * working, not the feature failing. So every count below runs as postgres.
 *
 * The counts are absolute and START AT ONE, not zero — a second wrong premise the first
 * version had. The 0051 block far above reports a day absent, and as of 0063 that call
 * notifies: an old test became a writer the moment the migration added the telling.
 * Which is itself worth keeping visible, because it proves existing two-argument callers
 * resolve against the new three-argument function unchanged.
 */
select pg_temp.expect(
  (select count(*) from public.notifications where kind = 'attendance') = 0,
  'the reporter sees no attendance notification at all — the inbox is the office''s, not theirs'
);

set local role postgres;
do $$
begin
  perform pg_temp.expect(
    (select absence_reason from public.bookings
      where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 40)
      = 'chickenpox',
    'the reason lands on the booking, trimmed');

  -- Exactly one letter for THIS report (the second overall — the 0051 block's own
  -- report is the first, see the note above). To the owner of this centre: the educator
  -- meets the absence on the attendance screen's own strip; the reporting guardian
  -- needs no letter about their own message; centre B is another tenant.
  perform pg_temp.expect(
    (select count(*) from public.notifications where kind = 'attendance') = 2,
    'ONE notification exists for this report — two overall, counting 0051''s');
  perform pg_temp.expect(
    (select count(*) from public.notifications
      where kind = 'attendance'
        and user_id = '11111111-1111-4111-8111-111111111111'
        and body like '%chickenpox%') = 1,
    'it reaches the owner, and carries the reason');
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- A reason with no sentence limit would be a free-text channel into the office inbox;
-- 500 characters is refused in words, not with an error screen.
select pg_temp.expect(
  public.report_absence('b2222222-2222-4222-8222-222222222222', current_date + 41, repeat('x', 501))
    = 'reason_too_long',
  'a 501-character reason is refused in words'
);

-- The range: per-day honest. The +42 hole answers no_booking without stopping +41 and
-- +43 from recording — all-or-nothing was rejected in 0063's header, and this is the
-- assertion that keeps it rejected.
do $$
declare v jsonb;
begin
  v := public.report_absence_range('b2222222-2222-4222-8222-222222222222',
                                   current_date + 41, current_date + 43, 'away with whānau');
  perform pg_temp.expect(v->>'status' = 'ok', 'a range submission is accepted, got ' || (v->>'status'));
  perform pg_temp.expect(v->'days'->>((current_date + 41)::text) = 'recorded',
    'the first day records');
  perform pg_temp.expect(v->'days'->>((current_date + 42)::text) = 'no_booking',
    'the unbooked day in the middle says so');
  perform pg_temp.expect(v->'days'->>((current_date + 43)::text) = 'recorded',
    'and the day after the hole still records — never all-or-nothing');
end $$;

-- ONE letter for the whole range, not one per day — five letters for one sick week is a
-- muted inbox. Counted as postgres for the reason above: the reporter cannot see any of
-- them, so a delta from their seat proves nothing.
set local role postgres;
select pg_temp.expect(
  (select count(*) from public.notifications where kind = 'attendance') = 3,
  'three days, ONE more notification — three in total across all submissions'
);
select pg_temp.expect(
  (select count(*) from public.notifications
    where kind = 'attendance'
      and user_id in ('55555555-5555-4555-8555-555555555555',
                      '44444444-4444-4444-8444-444444444444',
                      '22222222-2222-4222-8222-222222222222')) = 0,
  'and still nothing to any educator, any reporter, or anybody at another centre'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- A malformed or over-month range is refused whole.
do $$
declare v jsonb;
begin
  v := public.report_absence_range('b2222222-2222-4222-8222-222222222222',
                                   current_date + 43, current_date + 41, null);
  perform pg_temp.expect(v->>'status' = 'bad_period', 'a backwards range is refused, got ' || (v->>'status'));
  v := public.report_absence_range('b2222222-2222-4222-8222-222222222222',
                                   current_date + 1, current_date + 40, null);
  perform pg_temp.expect(v->>'status' = 'bad_period', 'a range past a month is refused, got ' || (v->>'status'));
end $$;

-- The boundary inside the centre, again: Priya is a parent at the same service and Beau
-- is not hers. Every day refuses, and — the part that matters for the inbox — nothing is
-- sent, because a notification about a refusal would tell the office a stranger tried.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare v jsonb;
begin
  v := public.report_absence_range('b2222222-2222-4222-8222-222222222222',
                                   current_date + 40, current_date + 41, null);
  perform pg_temp.expect(v->'days'->>((current_date + 40)::text) = 'not_permitted',
    'another family''s guardian is refused per-day');
end $$;
set local role postgres;
select pg_temp.expect(
  (select count(*) from public.notifications where kind = 'attendance') = 3,
  'and no notification marks the refused attempt — still three'
);
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 0065 — the chase's ledger: written by the scheduler, read by staff, edited by nobody
--
-- The table has NO insert policy on purpose — the only writer holds the service key and
-- bypasses RLS, so the grant is the boundary. These assertions prove the grant is doing
-- that job: an authenticated caller cannot write a notice however they are placed, staff
-- can read the ledger, a family cannot, and nobody at all can rewrite one.
-- ---------------------------------------------------------------------------

set local role postgres;
-- Seeded as the scheduler would write it: one release notice for Ana's fixed 0061 week.
insert into public.verification_notices (child_id, guardian_id, period_start, period_end, sent_on)
values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
        date '2026-08-03', date '2026-08-09', date '2026-08-10');

set local role authenticated;

-- The owner cannot write into the ledger — the scheduler is its only author, and a
-- hand-written row would corrupt the one-per-week arithmetic the planner runs on.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.verification_notices (child_id, guardian_id, period_start, period_end, sent_on)
    values ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111',
            date '2026-08-03', date '2026-08-09', date '2026-08-11');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'even the OWNER cannot hand-write a chase notice, got ' || code);
end $$;

-- Staff read it: "what have we already sent this family" is office work.
select pg_temp.expect(
  (select count(*) from public.verification_notices
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'the owner reads the ledger'
);

-- The family does not: a ledger of how many times the centre nudged you is the centre''s
-- operational record, not part of the child''s file — Priya sees her child everywhere
-- else in this suite, and nothing here.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.verification_notices) = 0,
  'the signatory being chased reads NO ledger rows, though the child is hers'
);

-- Append-only against everybody, service_role included: an editable input to a send
-- decision is how a family gets three notices in a morning.
set local role service_role;
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.verification_notices set sent_on = date '2026-01-01';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'SERVICE_ROLE cannot rewrite the chase ledger, got ' || code);
end $$;
do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.verification_notices;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'nor erase it, got ' || code);
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- ---------------------------------------------------------------------------
-- 0064 — the overview is SECURITY INVOKER, and these assertions are why that is safe
--
-- The function restates no boundary: the tables' policies decide who sees which child.
-- That is a claim, and the arrears view taught this repo what happens to boundary claims
-- nothing is checking — so the three scopings are asserted directly, against the same
-- relative week the kiosk block seeded (two events for Ana), which keeps this block
-- honest on any date.
-- ---------------------------------------------------------------------------

-- An educator: every child at the centre, one row per child per week.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare
  v_tz  text; v_end date; v_start date;
begin
  select timezone into v_tz from public.centres where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_end   := (now() at time zone v_tz)::date - extract(isodow from (now() at time zone v_tz)::date)::int;
  v_start := v_end - 6;

  perform pg_temp.expect(
    (select count(*) from public.verification_overview(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start, v_start)) = 2,
    'an educator''s overview holds one row per child at the centre');

  perform pg_temp.expect(
    (select jsonb_array_length(o.events)
       from public.verification_overview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start, v_start) o
      where o.child_id = 'a1111111-1111-4111-8111-111111111111') = 2,
    'and carries the week''s two events for the child who has them');

  perform pg_temp.expect(
    (select jsonb_array_length(o.verifications)
       from public.verification_overview('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start, v_start) o
      where o.child_id = 'a1111111-1111-4111-8111-111111111111') >= 1,
    'and the kiosk signature from the block above rides along');

  -- A week grid not anchored on a Monday is refused as empty rather than silently
  -- shifted: a Tuesday-to-Monday "week" misfiling events would be worse than no rows.
  perform pg_temp.expect(
    (select count(*) from public.verification_overview(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start + 1, v_start + 1)) = 0,
    'a non-Monday start returns nothing, not a shifted week');
end $$;

-- A guardian: exactly their wards, through the same call, with no branch saying so.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
do $$
declare
  v_tz  text; v_end date; v_start date;
begin
  select timezone into v_tz from public.centres where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_end   := (now() at time zone v_tz)::date - extract(isodow from (now() at time zone v_tz)::date)::int;
  v_start := v_end - 6;

  perform pg_temp.expect(
    (select count(*) from public.verification_overview(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start, v_start)) = 1,
    'a guardian''s overview holds their ward and nobody else''s child');

  perform pg_temp.expect(
    (select o.child_id from public.verification_overview(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start, v_start) o)
      = 'a1111111-1111-4111-8111-111111111111',
    'and the one row is her own child');
end $$;

-- Another centre: nothing, through the children policy rather than through a parameter
-- check — passing the foreign centre id is exactly what an attacker would do.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare
  v_tz  text; v_end date; v_start date;
begin
  select timezone into v_tz from public.centres where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  v_end   := (now() at time zone v_tz)::date - extract(isodow from (now() at time zone v_tz)::date)::int;
  v_start := v_end - 6;

  perform pg_temp.expect(
    (select count(*) from public.verification_overview(
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', v_start, v_start)) = 0,
    'another centre''s owner gets an empty overview of centre A, not an error and not a row');
end $$;

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- The CHECK that keeps a reason honest: a reason on a row that is not absent is
-- misinformation with a timestamp, refused by the schema whoever writes it.
set local role postgres;
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.bookings set absence_reason = 'stale reason'
     where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 43
       and status = 'absent';
    -- flip it back to booked WITHOUT clearing the reason: must refuse
    update public.bookings set status = 'booked'
     where child_id = 'b2222222-2222-4222-8222-222222222222' and on_date = current_date + 43;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a booking cannot leave absent while keeping its reason, got ' || code);
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';


-- A blank reason is refused, because the reason is what makes the audit row mean
-- anything at all.
do $$
declare msg text := 'none';
begin
  begin
    perform public.purge_child('a1111111-1111-4111-8111-111111111111', 'ok');
  exception when others then msg := sqlerrm;
  end;
  perform pg_temp.expect(msg like '%reason%', 'a purge without a stated reason is refused');
end $$;

-- Archive first, then it works — and the audit trail survives the record.
set local role postgres;
update public.children set archived_at = now() - interval '8 years'
 where id = 'a1111111-1111-4111-8111-111111111111';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.children_due_for_purge(7)
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'a child archived eight years ago is listed as due for purge'
);

do $$
begin
  perform public.purge_child('a1111111-1111-4111-8111-111111111111',
                             'retention period expired, seven years since leaving');
  perform pg_temp.expect(
    (select count(*) from public.children where id = 'a1111111-1111-4111-8111-111111111111') = 0,
    'an owner CAN purge an archived child past retention'
  );
end $$;

-- The cascade reached everything hanging off the child.
select pg_temp.expect(
  (select count(*) from public.health_conditions
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and the purge took the health record with it'
);

select pg_temp.expect(
  (select count(*) from public.consent_events
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and the consent history'
);

/*
 * And the two tables 0030 and 0032 added — which is the assertion the new-table
 * checklist has never had.
 *
 * A child-linked table declared `on delete set null`, or `restrict`, breaks the
 * purge in one of two ways: it survives as an orphan holding the description of a
 * child's injury and the medicines they were given (a privacy failure that nothing
 * would report), or it blocks the purge outright (an operational one). Neither is
 * visible in any other test, and both are one word in a migration away.
 *
 * `incidents` is the interesting half. DELETE is revoked on it for every role
 * including `service_role`, and it is still gone — because a referential action runs
 * as the table owner and does not consult grants. That is the same mechanism that
 * lets a child be purged out of `attendance_events`, asserted here rather than
 * believed.
 */
select pg_temp.expect(
  (select count(*) from public.incidents
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and the incident register, from which nobody holds DELETE'
);

select pg_temp.expect(
  (select count(*) from public.medication_administrations
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and every record of what medicine that child was given'
);

select pg_temp.expect(
  (select count(*) from public.sleep_checks
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and every sleep check made on them'
);

select pg_temp.expect(
  (select count(*) from public.immunisation_records
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and what the centre was shown about their immunisation'
);

-- 0037's two child-linked tables. `excursion_consents` is append-only with DELETE
-- revoked from every role, so this is the second place proving a cascade reaches a
-- table nobody holds the verb for.
select pg_temp.expect(
  (select count(*) from public.excursion_children
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0
  and (select count(*) from public.excursion_consents
    where child_id = 'a1111111-1111-4111-8111-111111111111') = 0,
  'and their place on an outing, and the consents given for it'
);

-- The outing itself survives: it is a record about the centre, and the other child
-- on it still has a place. A cascade that took the excursion with the child would
-- delete another family's record.
select pg_temp.expect(
  (select count(*) from public.excursions
    where id = 'c5555555-5555-4555-8555-555555555555') = 1
  and (select count(*) from public.excursion_children
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 1,
  'while the outing itself and the other child''s place on it are untouched'
);

-- The other child's records are untouched. Without this the three assertions above
-- are satisfied by a purge that deleted the whole table, which is not the property
-- being claimed.
select pg_temp.expect(
  (select count(*) from public.sleep_checks
    where child_id = 'b2222222-2222-4222-8222-222222222222') = 1,
  'while the child who was not purged keeps theirs'
);

-- The payoff from 0005 keeping values out of `detail`: the evidence that a record
-- existed and was destroyed survives, and contains nothing about the child.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where action = 'purge' and entity = 'children'
      and entity_id = 'a1111111-1111-4111-8111-111111111111') = 1,
  'the purge itself is recorded in the audit log'
);

select pg_temp.expect(
  (select detail ->> 'reason' from public.audit_events
    where action = 'purge' and entity = 'children' limit 1) like '%retention period expired%',
  'with the stated reason'
);

/*
 * And with `was_under_two` actually decided.
 *
 * Added with 0029, which moved that expression off `current_date` and onto the centre's own
 * timezone — reached by a join `purge_child` did not previously make. The refusal assertions
 * above cannot catch a broken join: every one of them passes on *any* exception, so a join
 * that returned no row would raise "No such child" and leave the suite green. The
 * "still enrolled" case does prove the row comes back, and this proves the expression that
 * depends on the joined column produced a value rather than a null.
 *
 * Asserted as "is a boolean", not as true or false: the answer depends on the fixture's date
 * of birth relative to the run date, and an assertion that has to be revisited every birthday
 * is one that gets deleted. Nothing reads this field yet — it is an annotation on the record
 * that outlives the data it describes, which is exactly why a null would go unnoticed.
 */
select pg_temp.expect(
  (select detail -> 'was_under_two' from public.audit_events
    where action = 'purge' and entity = 'children' limit 1) in ('true'::jsonb, 'false'::jsonb),
  'and with was_under_two decided rather than left null by a failed join'
);

select pg_temp.expect(
  not exists (
    select 1 from public.audit_events
     where entity_id = 'a1111111-1111-4111-8111-111111111111'
       and (detail::text like '%Ana%' or detail::text like '%Peanuts%')
  ),
  'and no name or medical detail survives in the audit trail'
);

-- ===========================================================================
-- INVITATIONS
--
-- An invitation is a grant of access to children's records, so who may issue one
-- is as consequential as who may read the roster. And the token hash must not be
-- readable by anybody through the API — the whole point of storing only a hash is
-- that a database read yields nothing usable.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare n integer;
begin
  insert into public.invitations (centre_id, email, role, token_hash, invited_by, expires_at)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'newkaiako@rlstest.invalid', 'educator',
          repeat('a', 64), '11111111-1111-4111-8111-111111111111', now() + interval '7 days');
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an owner CAN issue an invitation');
end $$;

-- Column-level: the manager who created it cannot read the hash back out.
do $$
declare code text := 'none (the select SUCCEEDED)';
begin
  begin
    perform token_hash from public.invitations limit 1;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'token_hash is NOT readable by authenticated, got ' || code);
end $$;

select pg_temp.expect(
  (select count(*) from public.invitations where email = 'newkaiako@rlstest.invalid') = 1,
  'but the rest of the invitation is'
);

-- Attribution cannot be forged: "who let them in" has to be answerable.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.invitations (centre_id, email, role, token_hash, invited_by, expires_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'forged@rlstest.invalid', 'educator',
            repeat('b', 64), '22222222-2222-4222-8222-222222222222', now() + interval '7 days');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'an invitation CANNOT be attributed to somebody else, got ' || code);
end $$;

-- An educator runs the room and does not decide who else gets access to it.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.invitations) = 0,
  'an educator CANNOT read invitations'
);

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.invitations (centre_id, email, role, token_hash, invited_by, expires_at)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'byeducator@rlstest.invalid', 'manager',
            repeat('c', 64), '55555555-5555-4555-8555-555555555555', now() + interval '7 days');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code in ('42501', '23514'),
    'an educator CANNOT issue an invitation, got ' || code);
end $$;

-- Staff at the other centre must not see who Mt Albert is hiring.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.invitations) = 0,
  'centre B cannot read centre A''s invitations'
);

-- ---------------------------------------------------------------------------
-- Revoking a parent's membership closes their own child's record.
--
-- The access predicates all join to a live membership specifically for this. It
-- reads as obviously true and is easy to get wrong, because guardianship is
-- recorded on the guardian row and would otherwise outlive the access.
-- ---------------------------------------------------------------------------

set local role postgres;
update public.memberships set revoked_at = now()
 where user_id = '33333333-3333-4333-8333-333333333333';

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.children) = 0,
  'a revoked parent loses access to their own child immediately'
);

select pg_temp.expect(
  (select count(*) from public.health_conditions) = 0,
  'and to the health record'
);

select pg_temp.expect(
  not public.has_consent('a1111111-1111-4111-8111-111111111111', 'photo_internal'),
  'has_consent fails closed for a caller who can no longer see the child'
);

-- ---------------------------------------------------------------------------
-- A revoked membership must end access immediately.
-- ---------------------------------------------------------------------------

set local role postgres;
update public.memberships
   set revoked_at = now()
 where user_id = '22222222-2222-4222-8222-222222222222';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';

select pg_temp.expect(
  (select count(*) from public.centres where slug like 'rls-test-%') = 0,
  'a revoked member loses access immediately'
);

select pg_temp.expect(
  (select count(*) from public.centre_members) = 0,
  'a revoked member sees no roster'
);

-- ---------------------------------------------------------------------------
-- Anonymous callers see nothing at all.
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- 0001 revokes everything on centres from anon, so this is refused before RLS is
-- consulted at all. Accepting both outcomes because "returns no rows" and "is not
-- permitted to ask" are both correct, and the stronger one should not read as a
-- test failure.
do $$
declare code text := 'none'; n integer := -1;
begin
  begin
    select count(*) into n from public.centres;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501' or n = 0,
    'anon sees no centres (sqlstate ' || code || ', rows ' || n || ')');
end $$;

-- EXECUTE was revoked from anon in 0002. Asserted because the failure mode is
-- silent: a grant restored by a later migration would not break anything
-- visible, it would just publish an email lookup to the internet.
do $$
declare allowed boolean := false;
begin
  begin
    perform public.member_email('11111111-1111-4111-8111-111111111111');
    allowed := true;
  exception when insufficient_privilege then
    allowed := false;
  end;
  perform pg_temp.expect(not allowed, 'anon CANNOT execute member_email');
end $$;

-- ---------------------------------------------------------------------------
-- 0021: an issued invoice freezes, and the audit log keeps up with the schema
--
-- Both of these were CLAIMED before they were true. The README said an issued invoice
-- freezes; the line policy required draft, and nothing stopped the status going back to
-- it. And the audit trigger covered ten tables while the schema had grown to
-- twenty-two, so a police vetting expiry date could be edited with no trace.
--
-- These assertions exist because both failures were invisible: the code read correctly
-- in each case. The only thing that could have caught them was asking the database.
-- ---------------------------------------------------------------------------

set local role postgres;

-- A guardian and an invoice at centre A, so Alice (owner of A) can act on it.
insert into public.guardians (id, centre_id, full_name)
values ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Invoice Recipient');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.invoices (id, centre_id, guardian_id, reference, status, period_from, period_to)
values ('55555555-5555-4555-8555-555555555555', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '44444444-4444-4444-8444-444444444444', 'RLS-FREEZE-1', 'draft',
        current_date, current_date);

-- A line, while it is still a draft. This must work — the freeze is about *after* issue.
insert into public.invoice_lines (invoice_id, description, quantity, unit_cents)
values ('55555555-5555-4555-8555-555555555555', 'Five days', 5, 5000);

select pg_temp.expect(
  (select count(*) from public.invoice_lines
    where invoice_id = '55555555-5555-4555-8555-555555555555') = 1,
  'a line can be added to a DRAFT invoice'
);

/*
 * And removed from one, which is the positive half of the DELETE assertion below.
 *
 * Without this, 0025 could have been "revoke DELETE on invoice_lines" and the negative
 * assertion would still pass — while making a draft invoice uneditable, which is the opposite
 * of what draft means. A negative-only pair of assertions cannot tell those two apart.
 */
insert into public.invoice_lines (invoice_id, description, quantity, unit_cents)
values ('55555555-5555-4555-8555-555555555555', 'Typed by mistake', 1, 100);

delete from public.invoice_lines
 where invoice_id = '55555555-5555-4555-8555-555555555555' and description = 'Typed by mistake';

select pg_temp.expect(
  (select count(*) from public.invoice_lines
    where invoice_id = '55555555-5555-4555-8555-555555555555') = 1,
  'a line CAN be removed while the invoice is still a DRAFT'
);

update public.invoices set status = 'issued', issued_at = now()
 where id = '55555555-5555-4555-8555-555555555555';

-- 1. The line policy. This was the half that already worked.
do $$
declare blocked boolean := false;
begin
  begin
    update public.invoice_lines set unit_cents = 1
     where invoice_id = '55555555-5555-4555-8555-555555555555';
    -- The policy filters the row out rather than raising, so zero rows updated is the
    -- refusal. Checking the value, not the row count, because a silent no-op and a
    -- successful edit look identical from the client.
    blocked := (select unit_cents from public.invoice_lines
                 where invoice_id = '55555555-5555-4555-8555-555555555555') = 5000;
  exception when insufficient_privilege or check_violation then
    blocked := true;
  end;
  perform pg_temp.expect(blocked, 'a line CANNOT be changed once the invoice is ISSUED');
end $$;

/*
 * 1b. DELETE, which is the verb this file did not cover and the one that was open.
 *
 * `invoice_lines_write` was declared FOR ALL with `status = 'draft'` in its WITH CHECK only —
 * and PostgreSQL checks USING for DELETE, not WITH CHECK. So the condition never applied to
 * DELETE, and 0022 faithfully preserved that when it split the policy by verb. An owner could
 * remove a line from an issued invoice and change what a family had already been billed.
 *
 * Asserted on the row still being there rather than on an exception: a policy filters the row
 * out instead of raising, so a successful delete and a refused one are both "no error".
 * Checking the count is the only thing that distinguishes them. Fixed in 0025.
 */
do $$
declare blocked boolean := false;
begin
  begin
    delete from public.invoice_lines
     where invoice_id = '55555555-5555-4555-8555-555555555555';
    blocked := (select count(*) from public.invoice_lines
                 where invoice_id = '55555555-5555-4555-8555-555555555555') = 1;
  exception when insufficient_privilege then
    blocked := true;
  end;
  perform pg_temp.expect(blocked, 'a line CANNOT be DELETED once the invoice is ISSUED');
end $$;

-- 2. The half that did not. Reverting to draft would have re-opened the lines.
do $$
declare blocked boolean := false;
begin
  begin
    update public.invoices set status = 'draft'
     where id = '55555555-5555-4555-8555-555555555555';
  exception when check_violation then
    blocked := true;
  end;
  perform pg_temp.expect(blocked, 'an ISSUED invoice CANNOT be returned to draft');
end $$;

-- 3. The identifying facts. A changed reference after issue means a family holds a
--    document that no longer matches the one in the system, and `payments` is
--    append-only, so a receipt already recorded cannot follow it.
do $$
declare blocked boolean := false;
begin
  begin
    update public.invoices set reference = 'RLS-FREEZE-CHANGED'
     where id = '55555555-5555-4555-8555-555555555555';
  exception when check_violation then
    blocked := true;
  end;
  perform pg_temp.expect(blocked, 'an ISSUED invoice CANNOT have its reference changed');
end $$;

do $$
declare blocked boolean := false;
begin
  begin
    update public.invoices set period_to = current_date + 30
     where id = '55555555-5555-4555-8555-555555555555';
  exception when check_violation then
    blocked := true;
  end;
  perform pg_temp.expect(blocked, 'an ISSUED invoice CANNOT have its period changed');
end $$;

-- 4. And an ordinary edit still has to work, or the rule is just breakage.
update public.invoices set note = 'phoned about this one'
 where id = '55555555-5555-4555-8555-555555555555';
select pg_temp.expect(
  (select note from public.invoices where id = '55555555-5555-4555-8555-555555555555')
    = 'phoned about this one',
  'an ISSUED invoice can still take a note'
);

-- 5. Void is terminal. Reinstating one puts a reference a family was told is void back
--    into circulation.
update public.invoices
   set status = 'void', voided_at = now(), void_reason = 'wrong period'
 where id = '55555555-5555-4555-8555-555555555555';

do $$
declare blocked boolean := false;
begin
  begin
    update public.invoices set status = 'issued'
     where id = '55555555-5555-4555-8555-555555555555';
  exception when check_violation then
    blocked := true;
  end;
  perform pg_temp.expect(blocked, 'a VOID invoice CANNOT be reinstated');
end $$;

-- 6. Every one of those operations is in the audit log, and the count is exact.
--    insert + issue + note + void = 4. If the reversion or the reference change had
--    succeeded there would be more, so this assertion is a second, independent check on
--    all of the above.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'invoices'
      and entity_id = '55555555-5555-4555-8555-555555555555') = 4,
  'the audit log holds exactly the four permitted invoice operations'
);

-- 7. And it records column NAMES, never values. The whole retention design rests on
--    this: it is why a child can be purged while the evidence survives.
select pg_temp.expect(
  not exists (
    select 1 from public.audit_events
     where entity = 'invoices'
       and entity_id = '55555555-5555-4555-8555-555555555555'
       and detail::text like '%phoned about this one%'
  ),
  'the audit log records which columns changed and NOT what they changed to'
);

select pg_temp.expect(
  exists (
    select 1 from public.audit_events
     where entity = 'invoices'
       and entity_id = '55555555-5555-4555-8555-555555555555'
       and detail -> 'changed' ? 'note'
  ),
  'the audit log names the column that changed'
);

-- ---------------------------------------------------------------------------
-- 0024: job applications, and the only write an unauthenticated caller may perform
--
-- This is the first public write path in the schema, so it gets the most assertions of
-- anything here. Before 0024 the honest one-line summary of `anon` was "reaches nothing at
-- all", and that sentence is now false — which means the exact shape of what it CAN do has
-- to be pinned, or the next person reads the old summary and believes it.
--
-- The positive cases are asserted alongside the negative ones on purpose. A policy that
-- returns nothing to anybody satisfies every "cannot read" assertion perfectly, and the first
-- run of this suite proved that failure mode in the least ambiguous way available.
-- ---------------------------------------------------------------------------

set local role postgres;

insert into public.job_applications (id, centre_id, applicant_name, email, position_sought, source)
values ('c0ffee00-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'Applicant At A', 'applicant-a@rlstest.invalid', 'Qualified kaiako', 'email');

-- An application at B too, so "Alice sees one row" is a real filter rather than a count of
-- everything that happens to exist.
insert into public.job_applications (centre_id, applicant_name, email, source)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Applicant At B', 'applicant-b@rlstest.invalid', 'email');

set local role authenticated;

-- The owner of A sees A's application and only A's.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.job_applications) = 1
  and (select applicant_name from public.job_applications) = 'Applicant At A',
  'an owner reads their own centre''s applications, and only those'
);

-- The tenant boundary, in the direction that matters: another centre's owner.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.job_applications
    where id = 'c0ffee00-0000-4000-8000-000000000001') = 0,
  'the owner of another centre cannot read this centre''s applications'
);

-- An educator is excluded, and not because of the tenant boundary — they are a member of A.
-- An application names a stranger AND records who was declined, which may be a colleague's
-- replacement. That is not a staffroom document.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.job_applications) = 0,
  'an educator at the same centre CANNOT read applications'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.job_applications) = 0,
  'and a parent cannot either'
);

-- Reading is not the only thing to close off. An educator who could file an application could
-- put a name and a phone number into a table they cannot read back.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.job_applications (centre_id, applicant_name, email)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Educator Filed This', 'x@rlstest.invalid');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'an educator CANNOT file an application, got ' || code);
end $$;

-- Cross-tenant write, which the read assertion above does not cover: an UPDATE that matches no
-- visible row reports success and changes nothing, so this checks the row instead of the verb.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
update public.job_applications set status = 'declined'
 where id = 'c0ffee00-0000-4000-8000-000000000001';

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select status from public.job_applications
    where id = 'c0ffee00-0000-4000-8000-000000000001') = 'new',
  'another centre''s owner cannot decline this centre''s applicant'
);

-- And the owner can, which is the positive half.
update public.job_applications
   set status = 'interview',
       status_changed_by = '11111111-1111-4111-8111-111111111111',
       status_changed_at = now()
 where id = 'c0ffee00-0000-4000-8000-000000000001';

select pg_temp.expect(
  (select status from public.job_applications
    where id = 'c0ffee00-0000-4000-8000-000000000001') = 'interview',
  'the owner can move an application to interview'
);

/*
 * The status-change record is ONE-DIRECTIONAL, and 0026 changed which direction.
 *
 * 0024 required both-or-neither, on the reasoning that "a row saying somebody was declined with no
 * record of who decided is unreadable a year later". That made it impossible to delete a staff
 * account: `status_changed_by` is `on delete set null`, the referential action is an UPDATE, CHECK
 * constraints are enforced on it, and the delete failed with a 23514 naming a recruitment
 * constraint — which is the last place anybody offboarding somebody would look. Measured against
 * the live database, not guessed.
 *
 * It was also wrong about the domain. `(at set, by null)` is not half a record; it is the honest
 * description of a move made by somebody whose account has since been removed. The useless state is
 * the reverse — a name with no time — so that is what is refused.
 */
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.job_applications set status_changed_by = '11111111-1111-4111-8111-111111111111',
           status_changed_at = null
     where id = 'c0ffee00-0000-4000-8000-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '23514',
    'a named mover with no time is refused, got ' || code);
end $$;

-- And the state that `on delete set null` produces is legal, so offboarding works.
update public.job_applications set status_changed_at = now(), status_changed_by = null
 where id = 'c0ffee00-0000-4000-8000-000000000001';

select pg_temp.expect(
  (select status_changed_by is null and status_changed_at is not null
     from public.job_applications where id = 'c0ffee00-0000-4000-8000-000000000001'),
  'a move by an account that has since been deleted keeps its time and loses its name'
);

/*
 * DELETE is granted here and is not granted on `waitlist`. The difference is deliberate: a
 * service has no reason to keep the employment history of somebody it did not employ.
 *
 * The claim that rests on this is "we removed your application", and that claim is only true
 * if the audit log kept no copy — so both halves are asserted.
 */
delete from public.job_applications where id = 'c0ffee00-0000-4000-8000-000000000001';
select pg_temp.expect(
  (select count(*) from public.job_applications
    where id = 'c0ffee00-0000-4000-8000-000000000001') = 0,
  'an owner can delete an application, unlike a waitlist entry'
);

set local role postgres;
select pg_temp.expect(
  exists (
    select 1 from public.audit_events
     where entity = 'job_applications'
       and entity_id = 'c0ffee00-0000-4000-8000-000000000001'
       and action = 'delete'
  )
  and not exists (
    select 1 from public.audit_events
     where entity = 'job_applications'
       and entity_id = 'c0ffee00-0000-4000-8000-000000000001'
       and (detail ? 'email' or detail ? 'applicant_name')
  ),
  'the audit log records the deletion and keeps no copy of the applicant'
);

-- ---------------------------------------------------------------------------
-- The public path, as `anon` holding nothing but the anon key
-- ---------------------------------------------------------------------------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- Unchanged and load-bearing: there is still no table grant. This is refused before RLS is
-- ever consulted, which is the order AGENTS rule 2 is about.
do $$
declare code text := 'none (the select SUCCEEDED)';
begin
  begin
    perform count(*) from public.job_applications;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'anon still has no grant on job_applications, got ' || code);
end $$;

-- The one thing it may do.
select public.submit_job_application(
  'rls-test-a', '  Anon Applicant  ', '  ANON@rlstest.invalid  ',
  '021 555 0001', 'Reliever', false, '2026-10-01', 'Sent from the public website.'
);

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.job_applications
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and lower(email) = 'anon@rlstest.invalid') = 1
  -- Trimmed, and stamped as coming from the website rather than typed in by staff.
  and (select applicant_name from public.job_applications
        where lower(email) = 'anon@rlstest.invalid') = 'Anon Applicant'
  and (select source from public.job_applications
        where lower(email) = 'anon@rlstest.invalid') = 'website',
  'anon can file an application, trimmed and marked as coming from the website'
);

-- A forged centre. The caller sends a slug and never an id, so the worst a hand-made call
-- achieves is the wrong one of this centre's own sites — and an unknown slug achieves nothing.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare code text := 'none (it SUCCEEDED)';
begin
  begin
    perform public.submit_job_application('not-a-centre', 'Forger', 'forge@rlstest.invalid');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = 'P0001', 'an unknown centre slug is refused, got ' || code);
end $$;

/*
 * Repeat submission while an application is open: one row, and no error.
 *
 * The quiet return is the security property, not a convenience. Raising "you have already
 * applied" would answer the question "has this address applied to this centre" for anybody who
 * asked — the same oracle the password recovery flow exists to avoid. Asserted on the row
 * count AND on the absence of an error, because either one alone passes for the wrong reason.
 */
select public.submit_job_application('rls-test-a', 'Anon Applicant', 'anon@rlstest.invalid');

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.job_applications
    where lower(email) = 'anon@rlstest.invalid') = 1,
  'a repeat submission while the application is open creates no second row and raises nothing'
);

-- ...and once it is closed, the same person may apply again. Somebody declined last year is
-- entitled to a second try, which is why the duplicate check is scoped to open statuses rather
-- than being a unique index.
update public.job_applications set status = 'declined',
       status_changed_by = '11111111-1111-4111-8111-111111111111', status_changed_at = now()
 where lower(email) = 'anon@rlstest.invalid';

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select public.submit_job_application('rls-test-a', 'Anon Applicant', 'anon@rlstest.invalid');

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.job_applications
    where lower(email) = 'anon@rlstest.invalid') = 2,
  'somebody previously declined can apply again'
);

/*
 * The flood guard, which is in the database rather than in the website process.
 *
 * An in-process limiter does not survive a restart and does not see a second instance, and
 * this function is reachable by anybody holding the anon key — which is public by design. Ten
 * a minute at one small centre is automation, not a busy afternoon.
 *
 * Distinct addresses on purpose: the duplicate check would otherwise absorb them and this
 * would pass while measuring nothing.
 */
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare
  i    int;
  code text := 'none (the 11th SUCCEEDED)';
begin
  for i in 1..20 loop
    begin
      perform public.submit_job_application(
        'rls-test-a', 'Flood ' || i, 'flood-' || i || '@rlstest.invalid');
    exception when others then
      code := sqlstate;
      exit;
    end;
  end loop;
  perform pg_temp.expect(code = 'P0001',
    'the flood guard stops a script before it fills the table, got ' || code);
end $$;

-- ---------------------------------------------------------------------------
-- 0025: DELETE is the verb a FOR ALL policy checks with USING, not WITH CHECK
--
-- The asymmetry that hid a hole in `invoice_lines` for five phases. A `FOR ALL` policy
-- applies USING to DELETE and WITH CHECK to INSERT, so a narrowing condition written only
-- into WITH CHECK was never enforced on DELETE — and 0022 faithfully preserved that when it
-- split the policies by verb, because it re-issued the expressions exactly as it found them.
--
-- Two assertions here, and the second is the one worth having: the first covers the instance,
-- the second covers the class, so the next policy written this way fails the suite instead of
-- being found by a later audit.
-- ---------------------------------------------------------------------------

set local role postgres;

-- A post authored by Alice, so the educator below is a *colleague* of the author rather than a
-- stranger. Both are members of centre A, so this is not the tenant boundary being tested.
insert into public.posts (id, centre_id, author_id, kind, title, body)
values ('d0570000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '11111111-1111-4111-8111-111111111111', 'panui', 'Colleague post', 'Body');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

/*
 * An educator could destroy a colleague's write-up of a child's day, while being correctly
 * refused permission to *edit* it — the author condition sat in WITH CHECK only. 0025 removed
 * the verb rather than picking a predicate, because nothing in this product deletes a post:
 * `publishPost` and `archivePost` are the whole vocabulary, and a pānui a family has already
 * read should not be able to vanish.
 *
 * 42501 here rather than a silent no-op, because this is a missing GRANT and not a policy
 * filtering rows — Postgres tests the table privilege first.
 */
do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.posts where id = 'd0570000-0000-4000-8000-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'an educator CANNOT delete a colleague''s post — nobody can, the verb is revoked, got ' || code);
end $$;

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.posts where id = 'd0570000-0000-4000-8000-000000000001') = 1,
  'and the post is still there, so the refusal was real rather than a filtered no-op'
);

/*
 * 0028: who may publish or archive a post.
 *
 * `posts_write` put the author condition in WITH CHECK only, and publishing is an UPDATE whose check
 * runs against the resulting row — whose `author_id` is still the colleague's. So **nobody but the
 * author could publish or archive**, including the centre's owner, while the screen offered both
 * buttons to every staff member. Offered by the UI, refused by the policy.
 *
 * Three assertions, because only the middle one was ever true and the other two are the point.
 */
set local role postgres;

insert into public.posts (id, centre_id, author_id, kind, title, body)
values ('d0570000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        '55555555-5555-4555-8555-555555555555', 'panui', 'Educator draft', 'Body');

set local role authenticated;

-- The author publishes their own. This always worked.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
update public.posts set published_at = now()
 where id = 'd0570000-0000-4000-8000-000000000002';

select pg_temp.expect(
  (select published_at is not null from public.posts
    where id = 'd0570000-0000-4000-8000-000000000002'),
  'an educator can publish their own post'
);

/*
 * And still cannot publish a colleague's. This is the case the widened policy must NOT admit:
 * 0028 added owners and managers, not every staff member.
 *
 * Wrapped for the same reason as the owner case below. The two policies refuse this in different
 * ways — the old one let the row through USING and then failed WITH CHECK, which RAISES, while the
 * new one excludes it in USING, which FILTERS. An unwrapped statement therefore aborted the suite
 * with a bare 42501 under the old policy instead of naming the property that had changed.
 */
do $$
declare still_draft boolean;
begin
  begin
    update public.posts set published_at = now()
     where id = 'd0570000-0000-4000-8000-000000000001';
  exception when others then null;
  end;
  still_draft := (select published_at is null from public.posts
                   where id = 'd0570000-0000-4000-8000-000000000001');
  perform pg_temp.expect(still_draft, 'an educator still CANNOT publish a colleague''s post');
end $$;

/*
 * The owner can, which is what was broken. A manager is accountable for what the centre publishes to
 * its whanau — they have to be able to hold back a draft naming a child whose consent is not in
 * place, and to archive something already sent.
 *
 * Asserted on the value rather than on an absent exception: a policy filters the row out instead of
 * raising, so "no error" is what a refusal looks like from the client.
 */
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

/*
 * Wrapped, so a regression reports by name.
 *
 * With the old policy this UPDATE **raises** 42501 rather than being filtered — a WITH CHECK
 * violation raises, a USING mismatch filters — so an unwrapped statement aborted the whole suite
 * with a bare "new row violates row-level security policy for table posts" and no indication of
 * which property had broken. Catching it turns that into a named failure.
 */
do $$
declare ok boolean := false;
begin
  begin
    update public.posts set archived_at = now()
     where id = 'd0570000-0000-4000-8000-000000000002';
    ok := (select archived_at is not null from public.posts
            where id = 'd0570000-0000-4000-8000-000000000002');
  exception when others then ok := false;
  end;
  perform pg_temp.expect(ok, 'an owner CAN archive an educator''s post, which 0028 fixed');
end $$;

-- ---------------------------------------------------------------------------
-- AI REQUESTS (0049) — the usage record for external model calls
--
-- The interesting properties are not who can read it, though that is asserted too. They
-- are that it CANNOT BE EDITED and CANNOT BE DELETED by anybody, including
-- `service_role`, because the month's spend cap is computed by summing this column. A
-- usage record somebody can rewrite is not a cap, it is a suggestion.
--
-- Deliberately carries no audit trigger — the row is its own record — which is why
-- `ai_requests` appears in the class assertion's exemption list further down. The
-- exemption is named here as well so a reader of either finds the other.
-- ---------------------------------------------------------------------------

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

insert into public.ai_requests
  (id, centre_id, feature, model, requested_by, input_tokens, output_tokens, cents_estimate, outcome)
values ('a1a1a1a1-aaaa-4aaa-8aaa-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'compliance-narrative', 'claude-opus-5', '11111111-1111-4111-8111-111111111111',
        1200, 400, 3, 'ok');

select pg_temp.expect(
  (select cents_estimate from public.ai_requests
    where id = 'a1a1a1a1-aaaa-4aaa-8aaa-000000000001') = 3,
  'an owner records a model call and its estimated cost'
);

-- A refusal and a block are both recorded. The block is the one that matters: a centre
-- whose feature was switched off finds that out from a run of zero-cost rows, and a
-- table holding only successes could not answer why nothing had happened all week.
insert into public.ai_requests
  (centre_id, feature, model, requested_by, outcome)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'accounts-narrative', 'claude-opus-5',
        '11111111-1111-4111-8111-111111111111', 'blocked');

select pg_temp.expect(
  (select count(*) from public.ai_requests where outcome = 'blocked' and cents_estimate = 0) = 1,
  'a call this product refused BEFORE sending anything is recorded, at zero cost'
);

-- An outcome outside the four is refused rather than stored. The column feeds a
-- discriminated union in TypeScript; a fifth value would be a runtime surprise there.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.ai_requests (centre_id, feature, model, outcome)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'compliance-narrative', 'claude-opus-5', 'timeout');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an unknown outcome is refused — the four are a closed set');
end $$;

-- An empty feature name would make the usage record unreadable at exactly the moment
-- somebody needs it: "something called the model 400 times" is not an answer.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.ai_requests (centre_id, feature, model, outcome)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '   ', 'claude-opus-5', 'ok');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a blank feature name is refused');
end $$;

-- Attribution, on the same terms as attendance: the row says who asked.
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.ai_requests (centre_id, feature, model, requested_by, outcome)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'compliance-narrative', 'claude-opus-5',
            '22222222-2222-4222-8222-222222222222', 'ok');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'an owner CANNOT attribute a call to somebody else, got ' || code);
end $$;

/*
 * THE ASSERTIONS THIS TABLE EXISTS FOR.
 *
 * The verb is withheld by GRANT, not merely unmatched by a policy, so Postgres raises
 * 42501 rather than filtering to zero rows. Asserted on the SQLSTATE for that reason:
 * "the update changed nothing" would also be true of a policy that simply did not match,
 * and the distinction is the whole design. A missing policy can be added by a later
 * migration without anybody noticing; a revoked grant cannot be re-granted silently,
 * because `review:security` reads the grants.
 */
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.ai_requests set cents_estimate = 0
     where id = 'a1a1a1a1-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'NOBODY can rewrite what a call cost — the spend cap sums this column, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.ai_requests
     where id = 'a1a1a1a1-aaaa-4aaa-8aaa-000000000001';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'and nobody can delete one either, got ' || code);
end $$;

/*
 * Including `service_role`, which is the branch that matters — the web app's server
 * actions hold that key, so a bug or a compromised deployment reaches this table with
 * it. Same treatment as `payments` and `attendance_events`.
 */
set local role service_role;
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.ai_requests set cents_estimate = 0;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'SERVICE_ROLE cannot rewrite a usage record either, got ' || code);
end $$;
set local role authenticated;

-- Nobody below the office. An educator has no reason to see the centre's model spend,
-- and a parent's answer to "what do you send" is the privacy statement, not a usage log.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.ai_requests) = 0,
  'an educator reads NO ai_requests'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.ai_requests) = 0,
  'and a parent reads none either'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.ai_requests (centre_id, feature, model, outcome)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'forged', 'claude-opus-5', 'ok');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor can a parent write one');
end $$;

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.ai_requests) = 0,
  'and another centre''s owner sees no model spend of ours at all'
);

do $$
declare ok boolean := false;
begin
  begin
    insert into public.ai_requests (centre_id, feature, model, outcome)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'compliance-narrative', 'claude-opus-5', 'ok');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'nor can they charge a call to our centre');
end $$;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';


-- ---------------------------------------------------------------------------
-- LICENSED PLACES (0050) — the denominator, and the fact that it may be absent
--
-- The interesting property is not who may write it. It is that a centre which has never
-- stated its licence reads NULL rather than a number, because every occupancy percentage
-- in the product is computed against this and a default would produce confident
-- percentages against a figure nobody gave.
--
-- The second assertion is the one 0047 taught: `centres` carries COLUMN-level UPDATE
-- grants, so a column added without its grant makes Postgres refuse the whole statement
-- before any policy runs — which breaks every other field on the settings form, not just
-- the new one. Asserted against `information_schema` rather than by attempting a write,
-- because a successful write proves the grant exists for the role doing the writing and
-- says nothing about the column being in the list.
-- ---------------------------------------------------------------------------

set local role postgres;

do $$
declare v_id uuid; v_places integer;
begin
  insert into public.centres (name, slug, timezone)
  values ('LICENCE PROBE', 'licence-probe', 'Pacific/Auckland')
  returning id, licensed_places into v_id, v_places;

  perform pg_temp.expect(
    v_places is null,
    'a centre created without stating a licence has NO licensed places, not a default'
  );

  delete from public.centres where id = v_id;
end $$;

select pg_temp.expect(
  (select count(*) from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'centres'
      and column_name = 'licensed_places' and privilege_type = 'UPDATE'
      and grantee = 'authenticated') = 1,
  'licensed_places carries its COLUMN-level UPDATE grant — without it the whole settings form fails'
);

-- Zero is not a licensed service and a negative one is a typo. Both would poison every
-- percentage derived from them, and zero would divide by itself.
do $$
declare ok boolean := false;
begin
  begin
    update public.centres set licensed_places = 0
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a licence of zero places is refused');
end $$;

set local role authenticated;

-- An owner states it, and reads it back.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
update public.centres set licensed_places = 40
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

select pg_temp.expect(
  (select licensed_places from public.centres
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 40,
  'an owner states the centre''s licensed places'
);

-- And an educator cannot. Filtered rather than raised: `centres_update` excludes them in
-- USING, so the statement affects no rows instead of erroring.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare still integer;
begin
  begin
    update public.centres set licensed_places = 999
     where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  exception when others then null;
  end;
  still := (select licensed_places from public.centres
             where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  perform pg_temp.expect(still = 40, 'an educator CANNOT change the licence, got ' || coalesce(still::text, 'null'));
end $$;

-- Put it back, so a later assertion about this centre is not reading a licence this
-- block invented. The audit-row assertions further down are order-sensitive for exactly
-- this reason — see the note added on 2026-08-09.
set local role postgres;
update public.centres set licensed_places = null
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';


-- ---------------------------------------------------------------------------
-- ENROLMENT APPLICATIONS (0052, 0053)
--
-- The second write an unauthenticated caller may perform in this schema, and the first
-- that concerns a named child. The assertions come in three parts: the function behaves,
-- the TABLE is closed to everyone below the office, and `anon` reaches the function and
-- nothing else.
-- ---------------------------------------------------------------------------

-- The public form. No JWT at all — this is the anon key in a browser.
set local role anon;
set local request.jwt.claims = '';

/*
 * A COARSE AGE BAND, AND NO CHILD'S NAME. See 0054.
 *
 * The first version of this suite passed 'Tama' as a required argument, because 0052
 * required one. The site's enrolment page had already decided otherwise — guardian
 * details and a coarse band, never a name or a date of birth — and the tenant doc it
 * cites holds this deployment to zero personal information until indemnity insurance is
 * in place. The schema was wrong, not the page.
 */
select public.submit_enrolment_application(
  'rls-test-a', 'Whaea Public', 'public.enquiry@example.test', 'under-2',
  '021 555 0000', current_date + 60, array[1,2,3]::smallint[],
  'We are moving to the area.'
);

/*
 * IT RETURNS VOID, SO IT CANNOT BE READ FROM — AND THE TABLE REFUSES ANYWAY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO BARRIERS, AND A BEHAVIOURAL TEST CANNOT TELL YOU WHICH ONE HELD.
 *
 * Found by mutation: granting `anon` SELECT on this table did **not** fail the suite.
 * The read still raised 42501 — but on `permission denied for function caller_has_role`,
 * not on the table. `enrolment_applications_select` calls that predicate, and `anon` has
 * no EXECUTE on it, so the policy cannot even be evaluated.
 *
 * That is real defence in depth and it is worth knowing about. It also means the
 * behavioural assertion below is **insensitive to the grant being widened**, which is
 * exactly the shape of a test that passes for a reason other than its label — the same
 * failure as the `security_invoker` assertion that passed because of a nested view.
 *
 * So the grant is asserted directly against the catalogue as well. That one IS sensitive:
 * it fails the moment somebody grants anon anything here, whatever the policies do.
 */
select pg_temp.expect(
  (select count(*) from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'enrolment_applications'
      and grantee = 'anon') = 0,
  'anon holds NO privilege of any kind on enrolment_applications'
);

do $$
declare code text := 'none (the select SUCCEEDED)';
begin
  begin
    perform 1 from public.enrolment_applications;
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'and a read as anon is refused outright rather than returning nothing, got ' || code);
end $$;

-- A forged centre. The caller sends a slug, never an id, so the set of writable centres is
-- the set that exists — and an unknown one is refused rather than silently filed somewhere.
do $$
declare ok boolean := false;
begin
  begin
    perform public.submit_enrolment_application(
      'no-such-centre', 'Forger', 'forge@example.test', 'under-2');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an unknown centre slug is refused, so a forged call cannot pick a tenant');
end $$;

-- Idempotent while the enquiry is open, and QUIET about it. An error saying "you have
-- already enquired" is an oracle: it tells anybody who asks whether a named family is
-- looking at a named service.
select public.submit_enrolment_application(
  'rls-test-a', 'Whaea Public', 'public.enquiry@example.test', 'under-2');

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.enrolment_applications
    where lower(email) = 'public.enquiry@example.test') = 1,
  'a repeated enquiry is a quiet no-op, not a second row and not an error'
);

/*
 * A SIBLING IS A DIFFERENT ENQUIRY.
 *
 * The idempotency key is the email AND the age band. Without a child's name (0054) the band
 * is what carries this: a family with a baby and a three-year-old sends two enquiries and
 * both land. Twins in one band collapse to one row, which 0054 states rather than hides.
 */
set local role anon;
select public.submit_enrolment_application(
  'rls-test-a', 'Whaea Public', 'public.enquiry@example.test', '2-and-over');

set local role postgres;
select pg_temp.expect(
  (select count(*) from public.enrolment_applications
    where lower(email) = 'public.enquiry@example.test') = 2,
  'a second child in a different age band is a second enquiry, not a swallowed duplicate'
);

-- The insert is audited with NO actor, which is the honest answer: the writer is anon and
-- there is no `auth.uid()` to name. 0053 records why that must not be "fixed".
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'enrolment_applications' and action = 'insert' and actor_id is null) >= 1,
  'a public enquiry is audited with no actor — nobody this product can name sent it'
);

-- Length caps are restated in the function, so a caller who is not the form gets a
-- sentence rather than a raw constraint violation. 0027 exists because that was once
-- true of only three fields out of six.
set local role anon;
do $$
declare ok boolean := false;
begin
  begin
    perform public.submit_enrolment_application(
      'rls-test-a', 'Whaea Public', 'long@example.test', 'under-2', repeat('9', 41));
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an over-long phone number is refused by the FUNCTION, not by the table');
end $$;

do $$
declare ok boolean := false;
begin
  begin
    perform public.submit_enrolment_application(
      'rls-test-a', 'Whaea Public', 'bad-address', 'under-2');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an address with no @ is refused');
end $$;

-- An age band outside the three is refused. The vocabulary is small on purpose: it answers
-- "which room, roughly when" and nothing else.
do $$
declare ok boolean := false;
begin
  begin
    perform public.submit_enrolment_application(
      'rls-test-a', 'Whaea Public', 'band@example.test', '2024-03-14');
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a date of birth in the age-band field is refused');
end $$;

/*
 * THE ASSERTION THAT PINS THE DECISION RATHER THAN THE BEHAVIOUR.
 *
 * `apps/site`'s enrolment page decided, before this schema existed, that a public enquiry
 * form "will not ask for a child's name or date of birth" — and `tenant-little-pearls.md`
 * holds this deployment to zero personal information until indemnity insurance is in place.
 * 0052 shipped a `child_name` that was NOT NULL and contradicted both; 0054 corrected it.
 *
 * A behavioural test cannot catch that coming back: somebody re-adding the parameter would
 * write a test that passes it. So this reads the catalogue. The public function takes eight
 * arguments and none of them is a child's name — if that changes, this fails, and whoever
 * changed it has to come and read this comment.
 */
select pg_temp.expect(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_enrolment_application'
      and pg_get_function_arguments(p.oid) ilike '%child_name%') = 0,
  'the public enquiry function cannot be given a child''s name — it does not take one'
);

set local role postgres;
select pg_temp.expect(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'enrolment_applications'
      and column_name = 'child_name') = 'YES',
  'and the column is nullable, so an enquiry with no child named is a complete row'
);
set local role anon;

-- Days outside 1..7 would corrupt every roster read that trusts the array.
do $$
declare ok boolean := false;
begin
  begin
    perform public.submit_enrolment_application(
      'rls-test-a', 'Whaea Public', 'days@example.test', 'under-2',
      null, null, array[0, 9]::smallint[]);
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'a day outside Monday..Sunday is refused');
end $$;

/*
 * `anon` REACHES THE FUNCTION AND NOTHING ELSE.
 *
 * The class-level check in `review:security` asserts no OTHER definer function carries an
 * anon grant. This is the behavioural half: the one thing anon may do to this table is
 * call the function, and every direct verb is refused by grant.
 */
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.enrolment_applications (centre_id, contact_name, email, child_age_band)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Direct', 'direct@example.test', 'under-2');
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'anon CANNOT insert directly — the function is the whole public write path, got ' || code);
end $$;

set local role authenticated;

-- The office reads and moves them.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_applications) = 2,
  'an owner reads the enquiries for their centre'
);

update public.enrolment_applications
   set status = 'contacted',
       moved_by = '11111111-1111-4111-8111-111111111111',
       moved_at = now()
 where lower(email) = 'public.enquiry@example.test' and child_age_band = 'under-2';

select pg_temp.expect(
  (select status from public.enrolment_applications
    where lower(email) = 'public.enquiry@example.test' and child_age_band = 'under-2') = 'contacted',
  'and moves one along'
);

-- A row cannot claim somebody acted without saying when.
do $$
declare ok boolean := false;
begin
  begin
    update public.enrolment_applications
       set moved_by = '11111111-1111-4111-8111-111111111111', moved_at = null
     where child_age_band = '2-and-over';
  exception when others then ok := true;
  end;
  perform pg_temp.expect(ok, 'an enquiry cannot record who moved it without recording when');
end $$;

-- Nobody below the office. It is a queue of other families' names and contact details, and
-- who is ahead of them — the same reasoning `waitlist` records.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_applications) = 0,
  'an educator reads NO enrolment enquiries'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_applications) = 0,
  'and a parent reads none either'
);

set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.enrolment_applications) = 0,
  'and another centre''s owner sees nothing at all'
);

-- Deletable by the office, which `waitlist` refuses. This table is written by strangers, so
-- it accumulates spam about named children, and IPP 9 says do not keep what is not needed.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare n integer;
begin
  delete from public.enrolment_applications where child_age_band = '2-and-over';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'the office CAN delete a junk enquiry about a named child');
end $$;

-- And the deletion is what survives it.
select pg_temp.expect(
  (select count(*) from public.audit_events
    where entity = 'enrolment_applications' and action = 'delete') = 1,
  'and the deletion is audited — afterwards the audit row is the only evidence it existed'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- ===========================================================================
-- EMERGENCY BROADCAST — 0057
--
-- `broadcast_emergency` is SECURITY DEFINER, exactly like `purge_child`: it bypasses every
-- policy below, so its own explicit role check is the only thing standing between a caller
-- and every family's inbox at a centre that is not theirs.
--
-- By this point in the suite, Priya (33333333) has been revoked (the parent-revocation
-- block above) and Bob (22222222) has been revoked from centre B (the membership-revocation
-- block after it). Centre A's ACTIVE, non-kiosk membership is therefore Alice (owner),
-- Quinn (parent) and Ed (educator) — three, not four — which is why the recipient count
-- below is computed rather than hard-coded: a fixture this large should not need a reader
-- to recount who is still active by hand.
-- ===========================================================================

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

do $$
declare
  v_expected integer;
  v_returned integer;
begin
  select count(*) into v_expected
    from public.memberships
   where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     and revoked_at is null
     and role <> 'kiosk';

  select public.broadcast_emergency(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'Evacuation drill',
    'The building is being evacuated. Please make your way to the car park.'
  ) into v_returned;

  perform pg_temp.expect(v_returned = v_expected,
    'an owner sends an emergency broadcast, reaching every active non-kiosk member (' ||
      v_returned || ' of ' || v_expected || ')');
end $$;

-- As service_role: `notifications_own` means Alice herself can see only her OWN row
-- through ordinary RLS, which is not what this is checking. The total fan-out is a fact
-- only the elevated role (or the function that just ran as it) can see in one query.
set local role service_role;
select pg_temp.expect(
  (select count(*) from public.notifications
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and kind = 'emergency' and title = 'Evacuation drill') =
  (select count(*) from public.memberships
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and revoked_at is null and role <> 'kiosk'),
  'and a notifications row lands for every one of them, no more and no fewer'
);
set local role authenticated;

select pg_temp.expect(
  (select count(*) from public.emergency_broadcasts
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      and title = 'Evacuation drill') = 1,
  'and the send itself is recorded once in emergency_broadcasts'
);

-- The recipient reads her own copy — notifications_own has existed since 0017 with
-- nothing to read until this function existed to write to it.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.notifications where kind = 'emergency' and title = 'Evacuation drill') = 1,
  'a parent who received the broadcast reads it in their own notifications'
);

-- But not the staff-only history: visibility of one's own delivery is not the same
-- question as who is allowed to browse what a centre has sent.
select pg_temp.expect(
  (select count(*) from public.emergency_broadcasts) = 0,
  'and a parent reads NO emergency_broadcasts history'
);

set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.emergency_broadcasts) = 0,
  'nor can an educator, though they too received the notification'
);

do $$
declare msg text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.broadcast_emergency('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 'y');
  exception when others then msg := sqlstate;
  end;
  perform pg_temp.expect(msg <> 'none (the call SUCCEEDED)',
    'an educator CANNOT send an emergency broadcast, got ' || msg);
end $$;

set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare msg text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.broadcast_emergency('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 'y');
  exception when others then msg := sqlstate;
  end;
  perform pg_temp.expect(msg <> 'none (the call SUCCEEDED)',
    'nor can a parent, got ' || msg);
end $$;

-- Bob's own centre-B membership was itself revoked earlier in this suite, which is
-- immaterial here: `caller_has_role` checks for an active membership AT CENTRE A
-- specifically, and Bob has never held one there, revoked or otherwise.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
do $$
declare msg text := 'none (the call SUCCEEDED)';
begin
  begin
    perform public.broadcast_emergency('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 'y');
  exception when others then msg := sqlstate;
  end;
  perform pg_temp.expect(msg <> 'none (the call SUCCEEDED)',
    'an owner of another centre CANNOT broadcast to this one, got ' || msg);
end $$;

select pg_temp.expect(
  (select count(*) from public.emergency_broadcasts
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 0,
  'and reads none of this centre''s broadcast history either'
);

-- Append-only, asserted on the sqlstate — the verb is withheld by GRANT, not filtered to
-- zero rows, for the reason detail_confirmations' own block above already argues.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.emergency_broadcasts set title = 'edited' where title = 'Evacuation drill';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'NOBODY can edit a sent broadcast after the fact, got ' || code);
end $$;

do $$
declare code text := 'none (the delete SUCCEEDED)';
begin
  begin
    delete from public.emergency_broadcasts where title = 'Evacuation drill';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'nor delete one, got ' || code);
end $$;

set local role service_role;
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.emergency_broadcasts set title = 'edited';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'SERVICE_ROLE cannot rewrite a broadcast record either, got ' || code);
end $$;
set local role authenticated;

-- Not a public write path like the enrolment enquiry — anon holds no EXECUTE at all.
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
do $$
declare allowed boolean := false;
begin
  begin
    perform public.broadcast_emergency('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'x', 'y');
    allowed := true;
  exception when insufficient_privilege then allowed := false;
  when others then allowed := false;
  end;
  perform pg_temp.expect(not allowed, 'anon CANNOT call broadcast_emergency at all');
end $$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';

-- ===========================================================================
-- TE WHĀRIKI STRANDS — 0058
--
-- `curriculum_strands` is reference data, open to every signed-in role at every centre —
-- there is no tenant boundary to test on the table itself, only "does the app get to
-- change it" (no) and "can a stranger read it" (no). `post_strands` inherits its
-- visibility from `posts` via the delegated-subquery policy 0058's header explains, so the
-- interesting assertions are about the POST, not a second copy of the guardianship logic.
-- ===========================================================================

set local role postgres;

-- A published pānui at centre A — visible to every parent there regardless of
-- guardianship, so this does not need to thread through the child-linkage fixture.
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
values ('e1111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'RLS strand test panui', 'Body', '11111111-1111-4111-8111-111111111111', now());

-- A DRAFT at the same centre — nobody but staff should see this post, and therefore
-- nobody but staff should see a strand tagged on it either.
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
values ('e3333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'panui', 'RLS strand test draft', 'Body', '11111111-1111-4111-8111-111111111111', null);

-- A post at centre B, for the write-isolation check.
insert into public.posts (id, centre_id, kind, title, body, author_id, published_at)
values ('e2222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        'panui', 'Centre B notice', 'Body', '22222222-2222-4222-8222-222222222222', now());

-- Tag the draft directly, bypassing RLS for fixture setup — this is what proves the read
-- check below is a real filter and not just "nothing exists to see".
insert into public.post_strands (post_id, strand_id)
  select 'e3333333-3333-4333-8333-333333333333', id from public.curriculum_strands where code = 'wellbeing';

set local role authenticated;

-- Reference data: every role, every centre, no grant needed beyond SELECT.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.curriculum_strands) = 5,
  'a parent reads all five curriculum strands — reference data, not centre-scoped'
);

do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.curriculum_strands (code, name_en, name_reo, source, sort_order)
    values ('x', 'x', 'x', 'x', 99);
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'nobody can add a sixth strand from the app, got ' || code);
end $$;

-- `code` is both this block's sqlstate variable AND a real column on this table —
-- PL/pgSQL raises 42702 (ambiguous_column) on an unqualified reference inside the WHERE,
-- which is a real trap and not a typo: `curriculum_strands.code` resolves it explicitly
-- rather than renaming the file's usual sqlstate-capture variable.
do $$
declare code text := 'none (the update SUCCEEDED)';
begin
  begin
    update public.curriculum_strands set name_en = 'edited' where curriculum_strands.code = 'wellbeing';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'nor rename one, got ' || code);
end $$;

-- The educator can tag the pānui — staff-writable, the same condition posts_write uses.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare n integer;
begin
  insert into public.post_strands (post_id, strand_id)
    select 'e1111111-1111-4111-8111-111111111111', id
      from public.curriculum_strands where code = 'exploration';
  get diagnostics n = row_count;
  perform pg_temp.expect(n = 1, 'an educator tags a post with a Te Whāriki strand');
end $$;

-- A parent cannot tag anything — post_strands_write requires staff, the same as posts_write.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.post_strands (post_id, strand_id)
      select 'e1111111-1111-4111-8111-111111111111', id
        from public.curriculum_strands where curriculum_strands.code = 'belonging';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501', 'a parent CANNOT tag a post with a strand, got ' || code);
end $$;

-- Nor can staff tag a post that is not theirs.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
do $$
declare code text := 'none (the insert SUCCEEDED)';
begin
  begin
    insert into public.post_strands (post_id, strand_id)
      select 'e2222222-2222-4222-8222-222222222222', id
        from public.curriculum_strands where curriculum_strands.code = 'belonging';
  exception when others then code := sqlstate;
  end;
  perform pg_temp.expect(code = '42501',
    'an educator CANNOT tag another centre''s post, got ' || code);
end $$;

-- A parent sees the tag on a pānui she can read —
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.post_strands where post_id = 'e1111111-1111-4111-8111-111111111111') = 1,
  'and a parent reads the strand tagged on a pānui she can see'
);

-- — but not the one on the draft, even though a row genuinely exists there. This is the
-- assertion that would fail if post_strands_select forgot to delegate through posts at all.
select pg_temp.expect(
  (select count(*) from public.post_strands where post_id = 'e3333333-3333-4333-8333-333333333333') = 0,
  'but reads NO strand on a draft she cannot see, though the tag exists'
);

-- Centre B reads none of centre A's tags either.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select pg_temp.expect(
  (select count(*) from public.post_strands where post_id = 'e1111111-1111-4111-8111-111111111111') = 0,
  'another centre''s owner reads none of this centre''s strand tags'
);

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';


/*
 * The class. Every `_write_delete` policy's USING must equal its `_write_insert` counterpart's
 * WITH CHECK, so a condition cannot be enforced on one verb and quietly not the other.
 *
 * `bookings` and `enrolments` are exempt, and the exemption is the interesting part: their
 * extra condition is "this row's centre must match the child's centre", which constrains what
 * may be WRITTEN and says nothing about who may remove it. On DELETE the USING clause already
 * confines the caller to their own centre, and a row breaking that consistency rule could
 * never have been inserted — so adding it to DELETE would only make an inconsistent row
 * undeletable. Duplicated from 0025 on purpose: that assertion runs once at migration time,
 * this one runs on every suite run, and the second is what catches a policy added later.
 */
do $$
declare offenders text;
begin
  select string_agg(d.tablename, ', ' order by d.tablename)
    into offenders
    from pg_policies d
    join pg_policies i
      on i.schemaname = d.schemaname
     and i.tablename  = d.tablename
     and i.policyname = replace(d.policyname, '_delete', '_insert')
   where d.schemaname = 'public'
     and d.cmd = 'DELETE'
     and d.policyname like '%\_write\_delete'
     and d.qual is distinct from i.with_check
     and d.tablename not in ('bookings', 'enrolments');

  perform pg_temp.expect(
    offenders is null,
    'no DELETE policy is broader than its INSERT check'
      || coalesce(' — BROADER ON: ' || offenders, '')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Audit coverage, as a rule rather than as twelve separate assertions.
--
-- This is the assertion that would have caught the original gap. Any future table that
-- holds consequential state and is not append-only must carry the trigger, and this
-- fails when somebody adds one without it — which is exactly what happened three
-- phases running.
-- ---------------------------------------------------------------------------

set local role postgres;

do $$
declare
  missing text[];
begin
  select array_agg(c.relname order by c.relname) into missing
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     -- Append-only tables: the row is its own record, so an audit row would describe an
     -- insert that can never be followed by an edit. Reasoning from 0005.
     and c.relname not in ('attendance_events', 'staff_count_events', 'consent_events',
                           'messages', 'payments', 'audit_events',
                           'medication_administrations', 'sleep_checks',
                           'safety_checks', 'excursion_consents', 'excursion_headcounts',
                           'staff_attendance_events',
                           -- 0049: a usage record, and the row is its own record.
                           'ai_requests',
                           -- 0055: a confirmation IS the record.
                           'detail_confirmations',
                           -- 0073: the ask IS the record. "We asked on the 4th" is only
                           -- worth saying if nobody could have written it on the 20th.
                           'consent_requests',
                           -- 0057: a sent broadcast IS the record — see the header of 0057.
                           'emergency_broadcasts',
                           -- 0061: a family's signature IS the record. Named in
                           -- scripts/security-review.ts as well, in the same commit.
                           'attendance_verifications',
                           -- 0065: a sent chase notice IS the record.
                           'verification_notices')
     -- Reference data, and settings that belong to a person rather than a centre — the
     -- trigger could not attribute them to a tenant even if it fired.
     and c.relname not in ('criteria', 'criteria_sets', 'schema_migrations',
                           'push_tokens', 'notification_preferences', 'notifications',
                           'invitations',
                           -- 0058: the five Te Whāriki strands, national rather than
                           -- per-centre — same reasoning as criteria.
                           'curriculum_strands',
                           -- 0080: Ministry code lists. National, no centre_id, so the
                           -- trigger could not attribute a row to a tenant even if it
                           -- fired. Named in scripts/security-review.ts as well, in the
                           -- same commit — there are two exemption lists and they have
                           -- to agree.
                           'code_sets', 'codes')
     and not exists (
       select 1 from pg_trigger t
        where t.tgrelid = c.oid
          and not t.tgisinternal
          and t.tgname = c.relname || '_audit'
     );

  perform pg_temp.expect(
    missing is null,
    'every table that should carry the audit trigger has it'
      || coalesce(' — MISSING: ' || array_to_string(missing, ', '), '')
  );
end $$;

/*
 * AND EVERY ONE OF THEM CAN ACTUALLY BE ATTRIBUTED TO A CENTRE.
 *
 * The assertion above checks a trigger EXISTS. That is not the same claim as "this table is
 * audited", and for three tables the two disagreed from the day they shipped: `shifts` and
 * `staff_leave` (0041) and `post_strands` (0058) hang off `staff_member_id` and `post_id`, which
 * `audit_trigger()` could not resolve. It fell through to `if v_centre is null then return`, wrote
 * nothing, and this suite went on reporting audit coverage as complete — as did check 11 of
 * `review:security`, whose success message claims no consequential table can be changed without a
 * record of who changed it.
 *
 * So the trigger fired on every roster change and recorded none of them, while the roster feeds the
 * ratio forecast. Fixed in 0059; this is the assertion that stops it recurring, because the next
 * table to hang off something new will fail here rather than pass quietly.
 *
 * Catalogue-driven, for the same reason the `security_invoker` assertion below is: a behavioural
 * test can pass for a reason other than the one its label claims.
 */
do $$
declare
  unattributable text[];
begin
  select array_agg(c.relname order by c.relname) into unattributable
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and exists (
       select 1 from pg_trigger t
        where t.tgrelid = c.oid
          and not t.tgisinternal
          and t.tgname = c.relname || '_audit'
     )
     -- `centres` is attributed from its own `id`, which is the one branch not keyed on a column
     -- name shared with other tables.
     and c.relname <> 'centres'
     and not exists (
       select 1 from pg_attribute a
        where a.attrelid = c.oid
          and a.attnum > 0
          and not a.attisdropped
          and a.attname in ('centre_id', 'child_id', 'invoice_id', 'guardian_id',
                            -- 0090: `absence_exemptions` hangs off an enrolment agreement,
                            -- because §7-7 scopes an exemption to one. Added in the same
                            -- commit as the branch in `audit_trigger()`, and this assertion
                            -- is what reported `CANNOT: absence_exemptions` the day 0089
                            -- created the table without it.
                            'enrolment_id',
                            'staff_member_id', 'post_id',
                            -- 0068: the checklist chain. `checklist_template_versions`
                            -- hangs off a template, `checklist_items` off a version,
                            -- `checklist_answers` off a run. Added here in the same
                            -- commit as the branches in `audit_trigger()` — without
                            -- both halves this assertion passes and means nothing,
                            -- which is the 0059 failure exactly.
                            'template_id', 'version_id', 'run_id')
     );

  perform pg_temp.expect(
    unattributable is null,
    'every audited table can be attributed to a centre, so its trigger writes a row'
      || coalesce(' — CANNOT: ' || array_to_string(unattributable, ', '), '')
  );
end $$;

/*
 * EVERY VIEW RUNS AS ITS CALLER.
 *
 * A Postgres view runs as its OWNER unless declared `security_invoker`, and the owner
 * here is the migration runner, which bypasses RLS. One view declared without it hands
 * every centre's rows to anybody who can select from it.
 *
 * This is a class-level assertion because the behavioural version cannot be trusted.
 * Turning `security_invoker` OFF on `invoice_arrears` and running the whole suite
 * changed nothing: it joins `invoice_totals`, which is itself an invoker view, and the
 * nested view kept enforcing the boundary. The per-view assertion was therefore
 * passing for a reason other than the one its label claimed — and would have gone on
 * passing if somebody rewrote the join to read `invoice_lines` directly, at which point
 * the boundary would rest solely on the setting nothing was checking.
 *
 * So this reads the catalogue rather than the behaviour. It cannot be satisfied by
 * accident, and it covers every view that will ever be added.
 */
do $$
declare offenders text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into offenders
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'v'
     and coalesce(array_to_string(c.reloptions, ','), '') not like '%security_invoker=on%';

  perform pg_temp.expect(
    offenders is null,
    'every view declares security_invoker = on'
      || coalesce(' — RUNNING AS OWNER: ' || offenders, '')
  );
end $$;

-- schema_migrations is deny-by-default rather than relying on nobody having granted it.
select pg_temp.expect(
  (select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass),
  'schema_migrations has RLS enabled, so it does not depend on an absent grant'
);

-- ---------------------------------------------------------------------------
-- No calendar day may come from the UTC session, as a rule rather than per column.
--
-- Not an isolation property, and it lives here anyway for the same reason the audit
-- coverage assertion above does: this is where class assertions run on every change,
-- and the rule is one nobody remembers. It has now been broken four times — twice
-- before 0006, once in `recordPayment`, and three column defaults plus a function
-- body that 0006 did not sweep and 0029 finished.
--
-- The pair to `packages/core/src/__tests__/localDates.test.ts`, which does the same
-- job for TypeScript. Between them, both spellings of the mistake are caught by
-- something that runs, instead of by a bullet point in AGENTS.md that four commits
-- have now walked past.
--
-- `::date` without `at time zone` is the general form: `current_date`, `now()::date`
-- and `current_timestamp::date` all read the session zone, and PostgREST's session is
-- UTC. `(now() at time zone ce.timezone)::date` is the correct shape and passes.
-- ---------------------------------------------------------------------------

do $$
declare offenders text;
begin
  select string_agg(table_name || '.' || column_name, ', ' order by table_name, column_name)
    into offenders
    from information_schema.columns
   where table_schema = 'public'
     and column_default is not null
     and (column_default ilike '%current_date%'
          or (column_default ilike '%::date%' and column_default not ilike '%at time zone%'));

  perform pg_temp.expect(
    offenders is null,
    'no column default takes a calendar day from the UTC session'
      || coalesce(' — UTC-DATED: ' || offenders, '')
  );
end $$;

do $$
declare offenders text;
begin
  select string_agg(p.proname, ', ' order by p.proname)
    into offenders
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     /*
       COMMENTS STRIPPED BEFORE SCANNING, ADDED 2026-08-09.

       The scan reads `prosrc`, which includes the function's own comments — so a body
       that EXPLAINS the hazard trips the guard for saying the words. `report_absence`
       did exactly that: its comment reads "never current_date, which is the session's",
       and the suite reported it as UTC-dated.

       That is a false positive with a bad failure mode. It names a real function, so a
       reader goes looking for a bug that is not there, and the obvious repair is an
       allowlist entry — which permanently exempts a function from the check that matters.
       Stripping comments keeps the guard blunt where it counts and truthful about what
       it found. Mutation-tested afterwards to confirm it still catches the real thing.
     */
     and (pg_temp.sql_code(p.prosrc) ilike '%current_date%'
          or (pg_temp.sql_code(p.prosrc) ilike '%::date%'
              and pg_temp.sql_code(p.prosrc) not ilike '%at time zone%'));

  perform pg_temp.expect(
    offenders is null,
    'no function body takes a calendar day from the UTC session'
      || coalesce(' — UTC-DATED: ' || offenders, '')
  );
end $$;

set local role postgres;
select pg_temp.expect(true, 'ALL RLS ISOLATION CHECKS PASSED');

-- Visible output for transports that return rows rather than notices.
select seq, case when ok then 'PASS' else 'FAIL' end as result, label
  from results order by seq;

-- Nothing is kept. Safe against a live project.
rollback;
