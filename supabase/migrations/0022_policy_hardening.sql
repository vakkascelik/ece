-- ---------------------------------------------------------------------------
-- 0022 — remove the class of defect that produced the Phase 4 consent leak,
--        rather than the instance of it.
--
-- In Phase 4 the media consent gate hid photos correctly from whānau and not at all
-- from educators. The cause was not the gate: it was that `media_write` was declared
-- `FOR ALL`, `FOR ALL` covers SELECT, and permissive policies are OR'd — so a second
-- permissive policy matching the same verb widened the read path. That one was fixed
-- with a RESTRICTIVE policy in 0015.
--
-- The security review found fourteen more tables with the same shape: an `x_select`
-- policy and an `x_write` policy declared `FOR ALL`. Every one of them was read on
-- 2026-08-04 and in every case the write policy is NARROWER than the select policy, so
-- nothing is currently leaking. That is luck about how they were written, not a property
-- of the design — and "we read all fourteen and they were fine" is a statement with a
-- shelf life of one commit.
--
-- So the shape goes away. A write policy declares the verbs it is for, and SELECT has
-- exactly one permissive policy per table. After this, adding a write policy cannot
-- widen a read, and the question does not have to be re-asked.
--
-- WHY THIS SPLITS THEM DYNAMICALLY INSTEAD OF RE-DECLARING FORTY-TWO POLICIES
--
-- Because the expressions are the security. Re-typing fourteen predicates — several of
-- which are three-way ORs over definer functions — is fourteen chances to change one
-- subtly while believing it was copied. Reading `qual` and `with_check` back out of the
-- catalogue and re-issuing them verbatim cannot make a transcription error.
--
-- It is deterministic on replay: the policies this reads were created by 0004, 0011,
-- 0012, 0013, 0018 and 0019, all of which run before it. The assertions at the bottom
-- fail the migration if the shape is not what this file expects, so a future migration
-- that changes those policies cannot silently change what this one does.
--
-- WHAT IS DELIBERATELY LEFT ALONE
--
-- Four `FOR ALL` policies have no separate select policy, because for those tables the
-- single policy IS the read path: `fee_schedules_all`, `waitlist_all` (owner and manager
-- only, and invisible to whānau — a waitlist is a list of who is ahead of them),
-- `push_tokens_own` and `notification_preferences_own` (a person's own device settings).
-- Splitting those would mean writing the same predicate four times.
-- ---------------------------------------------------------------------------

do $$
declare
  r         record;
  v_using   text;
  v_check   text;
  v_roles   text;
  v_count   int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.qual, p.with_check, p.roles
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd = 'ALL'
       and p.policyname like '%\_write'
       -- Only where a permissive SELECT policy already exists, so no table loses its
       -- read path. This is the condition that protects the four exceptions above.
       and exists (
         select 1 from pg_policies s
          where s.schemaname = 'public'
            and s.tablename = p.tablename
            and s.cmd = 'SELECT'
            and s.permissive = 'PERMISSIVE'
       )
     order by p.tablename
  loop
    v_using := r.qual;
    -- A FOR ALL policy with no explicit WITH CHECK uses its USING expression for the
    -- check. Making that implicit rule explicit here, because the split policies each
    -- need one or the other and an omission would silently permit any INSERT.
    v_check := coalesce(r.with_check, r.qual);
    v_roles := array_to_string(r.roles, ', ');

    if v_using is null then
      raise exception 'policy %.% has no USING expression; refusing to split it blindly',
        r.tablename, r.policyname;
    end if;

    execute format('drop policy %I on public.%I', r.policyname, r.tablename);

    execute format(
      'create policy %I on public.%I as permissive for insert to %s with check (%s)',
      r.policyname || '_insert', r.tablename, v_roles, v_check);

    execute format(
      'create policy %I on public.%I as permissive for update to %s using (%s) with check (%s)',
      r.policyname || '_update', r.tablename, v_roles, v_using, v_check);

    execute format(
      'create policy %I on public.%I as permissive for delete to %s using (%s)',
      r.policyname || '_delete', r.tablename, v_roles, v_using);

    v_count := v_count + 1;
  end loop;

  raise notice '0022: split % write policies into insert/update/delete', v_count;

  -- The assertion. Fourteen is what the review counted; a different number means the
  -- schema moved and this migration's reasoning needs re-reading rather than replaying.
  if v_count <> 14 then
    raise exception '0022 expected to split 14 policies, split % — the shape of the schema has changed', v_count;
  end if;
end;
$$;

-- No table may have more than one permissive SELECT-capable policy from here on. This is
-- the invariant the whole migration exists to establish, checked rather than asserted in
-- a comment.
do $$
declare
  offenders text;
begin
  select string_agg(tablename || ' (' || n || ')', ', ' order by tablename)
    into offenders
    from (
      select tablename, count(*) as n
        from pg_policies
       where schemaname = 'public'
         and permissive = 'PERMISSIVE'
         and cmd in ('SELECT', 'ALL')
       group by tablename
      having count(*) > 1
    ) x;

  if offenders is not null then
    raise exception
      '0022 did not achieve one permissive read path per table. Still multiple on: %',
      offenders;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Function privileges: stop granting EXECUTE to the world by default.
--
-- Postgres grants EXECUTE on a new function to PUBLIC, which includes `anon` — an
-- unauthenticated caller holding nothing but the anon key. Ten of the seventeen
-- SECURITY DEFINER functions here were still on that default.
--
-- Is it exploitable today? No. Every one of them resolves the caller through
-- `auth.uid()`, which is null without a JWT, so `anon` gets an empty set or false. The
-- reason to fix it anyway: these functions ARE the tenant boundary. `caller_centre_ids()`
-- decides which centre's children a caller can see, and a function that is reachable
-- before authentication is a function whose behaviour has to be reasoned about every time
-- it changes. Reasoning is what fails; a revoke does not.
--
-- The three trigger functions get no grant at all. A trigger fires with the privileges of
-- the table owner and PostgreSQL checks EXECUTE when the trigger is *created*, not when it
-- fires — so revoking here cannot break DML, and it does remove `select audit_trigger()`
-- as something a caller can attempt.
-- ---------------------------------------------------------------------------

-- The predicates. Needed by every policy, so `authenticated` must keep them, and
-- `service_role` uses them in scripts.
revoke all on function public.caller_centre_ids()                        from public;
revoke all on function public.caller_staff_centre_ids()                  from public;
revoke all on function public.caller_ward_ids()                          from public;
revoke all on function public.caller_guardian_ids()                      from public;
revoke all on function public.caller_has_role(uuid, public.member_role[]) from public;
revoke all on function public.caller_is_staff_for_child(uuid)            from public;
revoke all on function public.caller_may_see_child(uuid)                 from public;

grant execute on function public.caller_centre_ids()                        to authenticated, service_role;
grant execute on function public.caller_staff_centre_ids()                  to authenticated, service_role;
grant execute on function public.caller_ward_ids()                          to authenticated, service_role;
grant execute on function public.caller_guardian_ids()                      to authenticated, service_role;
grant execute on function public.caller_has_role(uuid, public.member_role[]) to authenticated, service_role;
grant execute on function public.caller_is_staff_for_child(uuid)            to authenticated, service_role;
grant execute on function public.caller_may_see_child(uuid)                 to authenticated, service_role;

-- Trigger functions. Nobody calls these directly, including the roles that benefit from
-- them firing.
revoke all on function public.audit_trigger()                 from public;
revoke all on function public.enforce_media_consent()         from public;
revoke all on function public.enforce_media_audience_change() from public;

comment on function public.caller_centre_ids() is
  'Every live membership of the caller. The tenant boundary itself, which is why 0022 '
  'revoked the default PUBLIC execute: it returns nothing without a JWT, and a boundary '
  'function reachable before authentication is one whose behaviour has to be re-reasoned '
  'about at every change.';
