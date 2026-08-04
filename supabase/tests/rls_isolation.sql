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

select pg_temp.expect(
  (select count(*) from public.audit_events
    where centre_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = 0,
  'alice CANNOT READ centre B audit events'
);

select pg_temp.expect(
  (select count(*) from public.audit_events
    where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') = 1,
  'alice CAN read her own centre audit events'
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
   where centre_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
  (select count(*) from public.audit_events) = 2,
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
