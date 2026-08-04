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

set local role postgres;
select pg_temp.expect(true, 'ALL RLS ISOLATION CHECKS PASSED');

-- Visible output for transports that return rows rather than notices.
select seq, case when ok then 'PASS' else 'FAIL' end as result, label
  from results order by seq;

-- Nothing is kept. Safe against a live project.
rollback;
