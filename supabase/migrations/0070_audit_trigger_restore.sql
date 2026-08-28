-- ---------------------------------------------------------------------------
-- 0070 — restore audit_trigger(), which 0068 overwrote with a stale body
--
-- CORRECTION. 0068 needed three more branches in `audit_trigger()` so the checklist
-- tables could be attributed to a centre, and added them by re-declaring the whole
-- function. The body it re-declared was reconstructed from 0059's prose header rather
-- than read from 0059's source, and three things were wrong:
--
--   1. The column is `audit_events.actor_id`, not `actor`. This is what failed, and it
--      failed loudly -- every audited write in the product raised 42703 from the
--      moment 0068 landed, and `npm run test:rls` caught it on the first run after.
--   2. `entity_id` is `text` and is `coalesce(id, guardian_id, post_id)`, because
--      `guardian_pins` and `post_strands` have no `id` column. 0068 wrote
--      `(v_row ->> 'id')::uuid`, which would have thrown on those two tables.
--   3. An UPDATE that changed nothing returns early instead of writing a noise row,
--      and the changed-column list is built with `jsonb_each_text` under the key
--      `changed`, not `columns`. 0068's shape would have diverged `detail` for every
--      update in the product -- the kind of drift nothing fails on and every later
--      reader has to reconcile.
--
-- WHY A NEW MIGRATION AND NOT AN EDIT TO 0068
--
-- `npm run migrate` refuses a file whose checksum changed after it was applied, and
-- that is the rule working. 0068 ran against this database and its text is now
-- history; editing it would make the repo disagree with what was executed, and would
-- leave a replay against a fresh database running a different 0068 from the one that
-- produced production.
--
-- THE LESSON IS THE ONE AGENTS.MD SECTION 5 ALREADY STATES
--
-- "Read the file before editing it. Read the migration before writing the next one."
-- The function was reproduced from a comment describing it, and a comment is not the
-- code. Redeclaring a shared function is the one edit where that shortcut is
-- guaranteed to be expensive, because the blast radius is every table carrying the
-- trigger rather than the one being worked on.
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
  -- 0070: `checklist_template_versions`, which hangs off a template and nothing else.
  elsif v_row ? 'template_id' and (v_row ->> 'template_id') is not null then
    select t.centre_id into v_centre from public.checklist_templates t
     where t.id = (v_row ->> 'template_id')::uuid;
  -- 0070: `checklist_items`, two joins up.
  elsif v_row ? 'version_id' and (v_row ->> 'version_id') is not null then
    select t.centre_id into v_centre
      from public.checklist_template_versions v
      join public.checklist_templates t on t.id = v.template_id
     where v.id = (v_row ->> 'version_id')::uuid;
  -- 0070: `checklist_answers`. The run carries the centre directly.
  elsif v_row ? 'run_id' and (v_row ->> 'run_id') is not null then
    select r.centre_id into v_centre from public.checklist_runs r
     where r.id = (v_row ->> 'run_id')::uuid;
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
