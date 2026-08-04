-- ---------------------------------------------------------------------------
-- 0023 — remove policies that permit something no grant allows.
--
-- Splitting the `FOR ALL` policies in 0022 was mechanical, and it produced six policies
-- for verbs that are deliberately not granted:
--
--   evidence                DELETE      archive, never delete: what was filed and when is
--                                       the evidence, and removing it removes the trail
--   invoices                DELETE      void, never delete: a deleted invoice takes its
--                                       reference with it and the next one reuses the number
--   medication_authorities  DELETE      revoked in 0006 — an authority that existed is a
--                                       fact about what a child was given
--   staff_records           DELETE      archive only: licensing evidence outlives employment
--   media_children          UPDATE      a photo is of a child or it is not; changing which
--                                       child would change who may see it
--   post_children           UPDATE      same reasoning
--
-- None of them is exploitable — Postgres checks the table privilege *before* any policy,
-- so a policy with no grant behind it can never fire. They are removed because of what
-- they say. A policy reading "owner and manager may delete evidence" is a documented
-- permission, and the next person to find the feature not working has an obvious fix
-- available: add the grant. At which point the design decision is gone and the reasoning
-- for it is in a migration comment nobody is reading.
--
-- The rule this establishes, and the reason the security review now checks for it: A
-- POLICY IS A STATEMENT ABOUT WHAT IS ALLOWED. If the answer is never, the policy should
-- not exist — the absence is the design.
-- ---------------------------------------------------------------------------

do $$
declare
  r       record;
  v_verb  text;
  v_count int := 0;
begin
  for r in
    select p.tablename, p.policyname, p.cmd
      from pg_policies p
     where p.schemaname = 'public'
       and p.cmd in ('UPDATE', 'DELETE')
       -- No grant for this verb, at table level or on any column. Column level matters:
       -- most write access in this schema is column-scoped, and a check that ignored it
       -- would delete working policies. (That mistake was made once already, in the first
       -- version of the review script.)
       and not exists (
         select 1 from information_schema.role_table_grants g
          where g.table_schema = 'public'
            and g.table_name = p.tablename
            and g.grantee = 'authenticated'
            and g.privilege_type = p.cmd
       )
       and not exists (
         select 1 from information_schema.column_privileges c
          where c.table_schema = 'public'
            and c.table_name = p.tablename
            and c.grantee = 'authenticated'
            and c.privilege_type = p.cmd
       )
     order by p.tablename, p.policyname
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
    raise notice '0023: dropped %.% (% with no grant)', r.tablename, r.policyname, r.cmd;
    v_count := v_count + 1;
  end loop;

  raise notice '0023: dropped % unreachable policies', v_count;

  if v_count <> 6 then
    raise exception
      '0023 expected 6 unreachable policies, found % — the grants or the policies have moved',
      v_count;
  end if;
end;
$$;

-- And the invariant, so this cannot silently regress: every policy that exists is backed
-- by a grant that lets it fire.
do $$
declare
  offenders text;
begin
  select string_agg(tablename || '.' || policyname || ' (' || cmd || ')', ', ' order by tablename)
    into offenders
    from pg_policies p
   where p.schemaname = 'public'
     and p.cmd in ('UPDATE', 'DELETE')
     and not exists (
       select 1 from information_schema.role_table_grants g
        where g.table_schema = 'public' and g.table_name = p.tablename
          and g.grantee = 'authenticated' and g.privilege_type = p.cmd)
     and not exists (
       select 1 from information_schema.column_privileges c
        where c.table_schema = 'public' and c.table_name = p.tablename
          and c.grantee = 'authenticated' and c.privilege_type = p.cmd);

  if offenders is not null then
    raise exception '0023 left policies that can never fire: %', offenders;
  end if;
end;
$$;
