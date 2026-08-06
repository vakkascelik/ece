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

insert into public.child_guardians (child_id, guardian_id, relationship) values
  ('a1111111-1111-4111-8111-111111111111', 'd1111111-1111-4111-8111-111111111111', 'mother'),
  ('a1111111-1111-4111-8111-111111111111', 'd3333333-3333-4333-8333-333333333333', 'grandmother'),
  ('b2222222-2222-4222-8222-222222222222', 'd2222222-2222-4222-8222-222222222222', 'father');

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
                           'messages', 'payments', 'audit_events')
     -- Reference data, and settings that belong to a person rather than a centre — the
     -- trigger could not attribute them to a tenant even if it fired.
     and c.relname not in ('criteria', 'criteria_sets', 'schema_migrations',
                           'push_tokens', 'notification_preferences', 'notifications',
                           'invitations')
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

-- schema_migrations is deny-by-default rather than relying on nobody having granted it.
select pg_temp.expect(
  (select relrowsecurity from pg_class where oid = 'public.schema_migrations'::regclass),
  'schema_migrations has RLS enabled, so it does not depend on an absent grant'
);

set local role postgres;
select pg_temp.expect(true, 'ALL RLS ISOLATION CHECKS PASSED');

-- Visible output for transports that return rows rather than notices.
select seq, case when ok then 'PASS' else 'FAIL' end as result, label
  from results order by seq;

-- Nothing is kept. Safe against a live project.
rollback;
