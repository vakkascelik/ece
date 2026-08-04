-- 0005 — audit by trigger, not by convention
--
-- 0003 gave the audit log its guarantees and a `record_audit()` helper for the
-- application to call. That is the weak part: an audit entry the application has
-- to remember to write is an audit entry that will eventually not be written, and
-- the omission is invisible — the screen works, the data saves, and only the log
-- is wrong. Which is discovered during a licensing review.
--
-- So the writes are recorded by the database. A trigger cannot be forgotten by
-- someone adding a mutation in `packages/api`, and it cannot be skipped by a
-- script that talks to Postgres directly.
--
-- WHAT GOES IN `detail`
--
-- Column NAMES, never values. 0003 says audit rows must not hold health, custody
-- or contact detail, because they outlive the record they describe — and a generic
-- trigger that logged `to_jsonb(NEW)` would copy every allergy and every custody
-- order into a table nobody thinks of as holding them. "Who changed the severity,
-- and when" is the useful part and is safe to keep.

/**
 * Generic audit trigger.
 *
 * SECURITY DEFINER for two reasons: the centre lookup for a child-scoped table has
 * to work regardless of what the caller can read, and the audit write must not be
 * refusable by the caller's own policy. It only ever fires after an operation the
 * policies already allowed, so it cannot be used to write a row the caller could
 * not otherwise cause.
 */
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

  -- Which tenant does this row belong to? Either it carries centre_id, or it
  -- hangs off a child that does.
  if v_row ? 'centre_id' then
    v_centre := (v_row ->> 'centre_id')::uuid;
  elsif v_row ? 'child_id' then
    select c.centre_id into v_centre from public.children c
     where c.id = (v_row ->> 'child_id')::uuid;
  elsif tg_table_name = 'centres' then
    v_centre := (v_row ->> 'id')::uuid;
  end if;

  -- A row we cannot attribute to a centre is not auditable, and audit_events
  -- requires centre_id. Better to let the operation stand than to fail it.
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
    v_row ->> 'id',
    v_detail
  );

  return coalesce(new, old);
end $$;

comment on function public.audit_trigger() is
  'Records who changed what, by column name only. Never copies values — audit rows outlive the record they describe.';

-- ---------------------------------------------------------------------------
-- Which tables get one
-- ---------------------------------------------------------------------------
--
-- Everything consequential and low-volume. NOT `audit_events` itself, which would
-- recurse, and deliberately NOT the high-volume append-only tables Phase 2 adds:
-- an audit row per attendance event doubles the write volume of the busiest table
-- in the product to record something the table already records. Append-only data
-- is its own audit trail.

do $$
declare t text;
begin
  foreach t in array array[
    'centres', 'memberships',
    'children', 'guardians', 'child_guardians',
    'custody_arrangements', 'enrolments',
    'health_conditions', 'medication_authorities',
    'consent_events'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_trigger()',
      t || '_audit', t
    );
  end loop;
end $$;
