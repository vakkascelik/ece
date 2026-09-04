-- ---------------------------------------------------------------------------
-- 0090 — `audit_trigger()` can attribute a row that hangs off an enrolment
--
-- WHY THIS EXISTS: 0089 CREATED A TABLE WITH A SILENT AUDIT TRIGGER
--
-- `absence_exemptions` (0089) keys on `enrolment_id`, because §7-7 scopes an exemption to a
-- specific enrolment agreement rather than to a child. But `audit_trigger()` resolves a
-- centre from a fixed list of column names and `enrolment_id` was not on it. The function's
-- fallback is deliberate and documented in 0005 — *"Better to let the operation stand than to
-- fail it"* — so the writes would have succeeded and the audit rows would silently not exist.
--
-- THAT IS THE 0059 DEFECT EXACTLY: three tables carried `*_audit` triggers that wrote nothing
-- for months, because the trigger was present and the attribution was not. 0059 added the
-- class assertion that catches it, and it caught this one the same day the table was created —
-- `test:rls` reported `CANNOT: absence_exemptions` before this migration existed.
--
-- AND 0085 HAD ALREADY WRITTEN THE WARNING DOWN, which is the part worth being honest about.
-- Its header says: *"`audit_trigger()` can only resolve a centre from a fixed column set …
-- `enrolment_id` is not in it, so keying on the enrolment would need a new branch in that
-- function AND a new entry in the attributability class assertion, in this migration."* Two
-- commits later I keyed a table on the enrolment without checking that note. The guard caught
-- what the reading should have.
--
-- `review:security` did NOT catch it and should not be expected to: it asserts every
-- consequential table CARRIES the trigger. Whether the trigger can resolve a tenant is a
-- different question, and the RLS suite is where it is asked.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- BOTH HALVES, IN ONE COMMIT
--
-- The assertion in `rls_isolation.sql` enumerates the same column names this function branches
-- on, and its own comment says why: *"Added here in the same commit as the branches in
-- `audit_trigger()` — without both halves this assertion passes and means nothing, which is
-- the 0059 failure exactly."* So `enrolment_id` goes into the function here and into the
-- assertion's list in the same commit.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- THE BODY IS 0070's, COPIED, WITH ONE BRANCH INSERTED
--
-- Not retyped, and that is not fastidiousness. The first draft of this migration reconstructed
-- the function from a grep of its branch list, and the diff against 0070 showed three material
-- differences: the changed-column detail came out as `{columns: {...}}` instead of
-- `{changed: [...]}`, which would have silently altered the audit format for every table in
-- the product; `entity_id` lost its `coalesce(id, guardian_id, post_id)`, which is the one
-- thing standing between `post_strands` and an audit row that says "a strand changed" without
-- saying on which post; and the `invoice_lines` fall-through was dropped. A definer function
-- that writes the audit trail is the last place to work from memory.
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
  -- 0090: `absence_exemptions`, which hangs off an enrolment agreement and nothing else.
  -- §7-7 scopes an exemption to a specific agreement rather than to a child, so that is the
  -- correct key — and 0085's header had already recorded that `enrolment_id` was missing from
  -- this list. Placed after `child_id` because both cost one join and the child is the more
  -- direct route for anything carrying both.
  elsif v_row ? 'enrolment_id' and (v_row ->> 'enrolment_id') is not null then
    select e.centre_id into v_centre from public.enrolments e
     where e.id = (v_row ->> 'enrolment_id')::uuid;
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

comment on function public.audit_trigger() is
  'Writes an audit_events row for any table carrying a <table>_audit trigger. Resolves the tenant from centre_id, or with one join from child_id, enrolment_id, invoice_id, guardian_id, staff_member_id, post_id, template_id, version_id or run_id. A row it cannot attribute is NOT audited and the write still stands (0005) - silent by design, so rls_isolation.sql asserts every audited table carries one of these columns. enrolment_id added by 0090 for 0089 absence_exemptions, which that assertion caught the same day.';
