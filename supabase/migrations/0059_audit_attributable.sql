/**
 * Three tables have carried an audit trigger that could never write a row.
 *
 * `shifts` and `staff_leave` (0041) and `post_strands` (0058) each have an `_audit` trigger
 * attached. `audit_trigger()` resolves the tenant from `centre_id`, then `child_id`, then
 * `invoice_id`, then `guardian_id`, then the `centres` table itself. None of those three tables
 * carries any of them — `shifts` and `staff_leave` hang off `staff_member_id`, `post_strands` off
 * `post_id` — so every call fell through to:
 *
 *     if v_centre is null then return coalesce(new, old); end if;
 *
 * and inserted nothing. `select count(*) from audit_events where entity = 'shifts'` has been 0
 * since 0041 shipped.
 *
 * WHY THIS WAS INVISIBLE, WHICH IS THE PART WORTH FIXING
 *
 * Both guards check that a trigger EXISTS. The class assertion in `rls_isolation.sql` looks for a
 * `pg_trigger` row named `<table>_audit`; check 11 in `scripts/security-review.ts` does the same.
 * Both passed. Worse, check 11's own success message reads "no consequential table can be changed
 * without a record of who changed which column, and when" — an assertion this repo was making
 * while it was false.
 *
 * 0044's header describes exactly this failure mode for `guardian_pins` and says the fix was
 * verified complete "by inspection of the catalogue". That inspection asked which tables carry
 * `guardian_id`. It did not ask which audited tables carry **none** of the keys, which is the
 * question that finds these three.
 *
 * So this migration does two things, and the second matters more than the first: it teaches the
 * function two more joins, and it makes the omission impossible to reintroduce silently.
 *
 * The roster is not a bookkeeping detail. `shifts` and `staff_leave` feed the ratio forecast, so
 * until now the staffing behind a compliance figure could be rewritten — UPDATE is granted on both
 * — with no record of who changed what. 0041's own comment says a roster somebody can erase
 * "cannot show that Tuesday was short before anybody noticed". It could not show it either way.
 *
 * NOT BACKFILLED. There is nothing to backfill from: the rows were never written and the history
 * is genuinely gone. Saying so here is better than a migration that invents plausible actors.
 */

-- ---------------------------------------------------------------------------
-- 1. Two more ways to reach a centre.
-- ---------------------------------------------------------------------------

create or replace function public.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row     jsonb;
  v_old     jsonb;
  v_centre  uuid;
  v_changed text[];
  v_detail  jsonb := '{}'::jsonb;
begin
  v_row := to_jsonb(coalesce(new, old));

  -- Which tenant does this row belong to? It carries centre_id, or it hangs off a child
  -- that does, or off an invoice that does, or off a guardian, staff member or post that does.
  if v_row ? 'centre_id' then
    v_centre := (v_row ->> 'centre_id')::uuid;
  elsif v_row ? 'child_id' and (v_row ->> 'child_id') is not null then
    select c.centre_id into v_centre from public.children c
     where c.id = (v_row ->> 'child_id')::uuid;
  elsif v_row ? 'invoice_id' then
    select i.centre_id into v_centre from public.invoices i
     where i.id = (v_row ->> 'invoice_id')::uuid;
  -- Added in 0044 for `guardian_pins`, the first table to hang off a guardian and
  -- nothing else. Unreachable for `child_guardians` and `invoices`, which match above.
  elsif v_row ? 'guardian_id' and (v_row ->> 'guardian_id') is not null then
    select g.centre_id into v_centre from public.guardians g
     where g.id = (v_row ->> 'guardian_id')::uuid;
  -- 0059: `shifts` and `staff_leave`, which hang off a staff member and nothing else.
  elsif v_row ? 'staff_member_id' and (v_row ->> 'staff_member_id') is not null then
    select s.centre_id into v_centre from public.staff_members s
     where s.id = (v_row ->> 'staff_member_id')::uuid;
  -- 0059: `post_strands`, which hangs off a post. Keyed (post_id, strand_id) with no `id`,
  -- so `entity_id` falls back below the same way `guardian_pins` does.
  elsif v_row ? 'post_id' and (v_row ->> 'post_id') is not null then
    select p.centre_id into v_centre from public.posts p
     where p.id = (v_row ->> 'post_id')::uuid;
  elsif tg_table_name = 'centres' then
    v_centre := (v_row ->> 'id')::uuid;
  end if;

  -- `child_id` present but null on a table that also has no centre_id: fall through to
  -- invoice_id rather than giving up, which is the invoice_lines case.
  if v_centre is null and v_row ? 'invoice_id' then
    select i.centre_id into v_centre from public.invoices i
     where i.id = (v_row ->> 'invoice_id')::uuid;
  end if;

  -- A row that cannot be attributed to a centre is not auditable, and audit_events
  -- requires centre_id. Better to let the operation stand than to fail it. The assertion at
  -- the foot of this migration is what stops that mercy from hiding a missing branch.
  if v_centre is null then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    select array_agg(key order by key) into v_changed
      from jsonb_each_text(v_row) e(key, value)
     where value is distinct from (v_old ->> e.key);
    -- An UPDATE that changed nothing is noise.
    if v_changed is null then
      return new;
    end if;
    v_detail := jsonb_build_object('changed', v_changed);
  end if;

  insert into public.audit_events (centre_id, actor_id, action, entity, entity_id, detail)
  values (
    v_centre,
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    -- `guardian_pins` is keyed on the guardian and has no `id`; `post_strands` is keyed
    -- (post_id, strand_id) and has none either. A null entity_id is permitted, so nothing
    -- would fail — the audit would just say "a strand changed at this centre" without saying
    -- on which post. That is worse than an error, because it looks like a record.
    coalesce(v_row ->> 'id', v_row ->> 'guardian_id', v_row ->> 'post_id'),
    v_detail
  );

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The assertion that would have caught it, run at migration time.
-- ---------------------------------------------------------------------------

/**
 * Every table carrying an `_audit` trigger must have a column the function can attribute.
 *
 * This is the check that was missing. "Has a trigger" and "is audited" are different claims, and
 * for three tables they disagreed for months. The list below must stay in step with the branches
 * above — if a future table hangs off something new, this fails loudly at migration time rather
 * than silently producing an unaudited table that every existing guard reports as covered.
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
     and c.relname <> 'centres'
     and not exists (
       select 1 from pg_attribute a
        where a.attrelid = c.oid
          and a.attnum > 0
          and not a.attisdropped
          and a.attname in ('centre_id', 'child_id', 'invoice_id', 'guardian_id',
                            'staff_member_id', 'post_id')
     );

  if unattributable is not null then
    raise exception
      'audit_trigger cannot attribute these tables to a centre, so their trigger would never write a row: %',
      array_to_string(unattributable, ', ');
  end if;
end $$;
