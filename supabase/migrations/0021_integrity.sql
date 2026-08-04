-- ---------------------------------------------------------------------------
-- 0021 — three findings from the security review, in order of how wrong they were.
--
-- The review was written as SQL against the live schema rather than as a reading of
-- these files, which is the only reason any of this surfaced: all three would pass a
-- code review, because in each case the code says the right thing and the database
-- does not enforce it.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. AN ISSUED INVOICE DID NOT FREEZE. The README said it did.
--
-- The Phase 5 commit message and the README both state: "An issued invoice freezes —
-- the line policy requires status = 'draft', because changing what a family was billed
-- after they were billed it is a different invoice."
--
-- The line policy does require draft. Nothing required the *status* to stay put. And
-- `invoices.status` carries a column-level UPDATE grant to `authenticated`, because an
-- owner has to be able to issue one. So the sequence was:
--
--     update invoices set status = 'draft' where id = …   -- allowed
--     update invoice_lines set unit_cents = …             -- now allowed, it is a draft
--     update invoices set status = 'issued'               -- allowed
--
-- Three ordinary statements, no privilege escalation, and the amount a family was
-- billed is different from the amount they were shown. `invoices` had no audit trigger
-- either (fixed in section 3 below), so there was no record that it happened.
--
-- The CHECK constraint that existed — `invoices_issued_when_not_draft` — is satisfied
-- by a reversion, because it only says "if not draft then issued_at is not null".
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT
--
-- A CHECK sees one row and cannot see the row it replaced. "Was this already issued"
-- is a question about the transition, and only a trigger has both tuples.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_invoice_transition()
returns trigger
language plpgsql
as $$
begin
  -- A draft is working material. Everything below is about what may happen *after* a
  -- family has been sent a number.
  if old.status = 'draft' then
    return new;
  end if;

  if new.status = 'draft' then
    raise exception
      'An invoice that has been issued cannot be returned to draft. Void it and raise a new one.'
      using errcode = '23514';
  end if;

  -- Void is terminal. Resurrecting a cancelled invoice would put a reference a family
  -- has already been told is void back into circulation.
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A voided invoice cannot be reinstated. Raise a new one.'
      using errcode = '23514';
  end if;

  -- The identifying facts. Changing any of these after issue produces two different
  -- documents wearing the same name — and `payments` is append-only, so a payment
  -- already recorded against this reference cannot be moved to follow it.
  if new.reference    is distinct from old.reference
  or new.guardian_id  is distinct from old.guardian_id
  or new.period_from  is distinct from old.period_from
  or new.period_to    is distinct from old.period_to
  or new.issued_at    is distinct from old.issued_at
  or new.centre_id    is distinct from old.centre_id then
    raise exception
      'An issued invoice cannot have its reference, recipient, period, centre or issue date changed. Void it and raise a new one.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

comment on function public.enforce_invoice_transition() is
  'Refuses the transitions that would let an issued invoice be edited: back to draft, out '
  'of void, or a change to the facts that identify it. Not SECURITY DEFINER — it reads '
  'only OLD and NEW and needs no privilege of its own, and a definer function that needs '
  'nothing is a definer function somebody will later add something to.';

drop trigger if exists invoices_transition on public.invoices;
create trigger invoices_transition
  before update on public.invoices
  for each row execute function public.enforce_invoice_transition();


-- ---------------------------------------------------------------------------
-- 2. `schema_migrations` had RLS off and no policies.
--
-- Not exploitable: it carries no grant to `anon`, `authenticated` or `service_role`, so
-- PostgREST does not expose it and no API caller can reach it. It is here because the
-- protection was an *absence* — nobody had granted anything yet — and the day somebody
-- runs `grant select on all tables in schema public to authenticated` to fix an
-- unrelated problem, migration history and checksums become readable with no second
-- barrier. RLS with no policy is deny-by-default, so this costs nothing and removes the
-- dependence on an absence.
--
-- `postgres` (the owner, which is how the migration runner connects) and `service_role`
-- (which holds BYPASSRLS) are unaffected, so `npm run migrate` keeps working.
-- ---------------------------------------------------------------------------

alter table public.schema_migrations enable row level security;

comment on table public.schema_migrations is
  'Applied migrations and their checksums. RLS on with no policies: deny-by-default for '
  'every API role. The migration runner connects as the owner and is unaffected. See 0021.';


-- ---------------------------------------------------------------------------
-- 3. Eight tables holding consequential state had no audit trigger.
--
-- 0005 applied the trigger to ten tables. Phases 3, 4 and 5 then added twelve more and
-- no migration extended it, so the audit log stopped keeping up with the schema in
-- April and nobody noticed — because a missing audit row looks exactly like a quiet day.
--
-- The one that matters most is `staff_records`. That table *is* the licensing evidence
-- this product sells: an expiry date on a police vetting record could be edited, or a
-- "sighted by" cleared, with no trace at all. A centre could have shown a reviewer a
-- binder assembled from records that had been quietly adjusted, and the product would
-- have had nothing to say about it.
--
-- Still deliberately excluded: `attendance_events`, `staff_count_events`,
-- `consent_events`, `messages`, `payments`. Those are append-only in both the policies
-- and the grants, so an audit row would record an insert that cannot be followed by an
-- edit — the row itself is the record. That reasoning is from 0005 and still holds.
--
-- Also excluded: `push_tokens` and `notification_preferences`, which are a person's own
-- device settings and belong to no centre, so `audit_trigger()` could not attribute
-- them anyway.
-- ---------------------------------------------------------------------------

-- First, teach the trigger to attribute an invoice line. It has `child_id`, but that is
-- nullable — a line for a late fee names no child — and the existing function silently
-- skips a row it cannot attribute to a centre. So the most audit-worthy edit in the
-- table, a changed amount on a general line, was the one it would have dropped.
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
  -- that does, or off an invoice that does.
  if v_row ? 'centre_id' then
    v_centre := (v_row ->> 'centre_id')::uuid;
  elsif v_row ? 'child_id' and (v_row ->> 'child_id') is not null then
    select c.centre_id into v_centre from public.children c
     where c.id = (v_row ->> 'child_id')::uuid;
  elsif v_row ? 'invoice_id' then
    select i.centre_id into v_centre from public.invoices i
     where i.id = (v_row ->> 'invoice_id')::uuid;
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
    (v_row ->> 'id'),
    v_detail
  );

  return coalesce(new, old);
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'staff_records',      -- the licensing evidence. The reason this section exists
    'evidence',           -- what was filed against which criterion, and by whom
    'invoices',           -- see section 1: the reversion had no record either
    'invoice_lines',      -- what a family was actually charged
    'fee_schedules',      -- what the charge is *supposed* to be
    'bookings',           -- what a family is billed for holding
    'waitlist',           -- who was offered a place, and when
    'posts',              -- what was published to whānau, and by whom
    'message_threads',    -- who opened a thread and who closed it
    'media',              -- captions and audience; the audience trigger is separate
    'media_children',     -- which child a photo is of, which decides who may see it
    'post_children'       -- which child a post is about, same reason
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I '
      'for each row execute function public.audit_trigger()',
      t || '_audit', t
    );
  end loop;
end;
$$;

-- Convention, restated because this is the second time it has been missed:
-- A NEW TABLE THAT HOLDS CONSEQUENTIAL STATE GETS THE AUDIT TRIGGER IN THE SAME
-- MIGRATION THAT CREATES IT. The exceptions are append-only tables, where the row is
-- its own record, and user-scoped settings, which belong to no centre. Anything else
-- and the audit log silently stops describing the product.
