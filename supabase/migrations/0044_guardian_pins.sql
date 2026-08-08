-- ---------------------------------------------------------------------------
-- 0044 — the door tablet: guardian PINs, and who attested a sign-in
--
-- 0042 made the role and 0043 shut the doors it opened. This is the capability
-- itself, and it is the riskiest migration in the repo so far: it adds an
-- authentication factor and it touches `attendance_events`, which underpins a
-- funding claim on the Crown.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY NOT SHA-256, DESPITE `invitations` DOING EXACTLY THAT
--
-- The roadmap says "hash only, the invitations precedent". Right about *hash only*
-- and wrong about the algorithm, and the difference is the input.
--
-- An invitation token is 256 bits of randomness. SHA-256 of it is safe because there
-- is nothing to guess: an attacker holding the whole table has 2^256 candidates.
--
-- A PIN is four digits. SHA-256 of a four-digit PIN is **ten thousand hashes**, which
-- is a rainbow table somebody builds in a second, and every PIN in a leaked table
-- falls at once. Unsalted, they all fall to the same table.
--
-- So: bcrypt, via pgcrypto, per-row salt, work factor 10. Verified against this
-- database before being relied on. The comparison happens *inside* Postgres in a
-- definer function, so the hash never crosses the wire and the application never
-- holds it even briefly.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY THE FUNCTION RETURNS A STATUS INSTEAD OF RAISING
--
-- Because a `raise exception` would roll back the failed-attempt counter it had just
-- incremented, and the lockout would never engage. That is not a hypothetical: it is
-- the obvious implementation, and it produces a brute-force limiter that counts to
-- one forever.
--
-- So every outcome is a returned value and the transaction commits. `submit_job_
-- application` reached the same conclusion for the same reason.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE KIOSK CANNOT ENFORCE, STATED HERE SO NOBODY ASSUMES IT DOES
--
-- `custody_arrangements` holds free text — "collection by the father is not permitted
-- without written agreement". It is prose written for a person to read, and there is
-- no machine-readable form of it. A door tablet therefore **cannot** enforce a
-- parenting order.
--
-- What it can enforce is `child_guardians.can_collect`, which is a boolean, and this
-- migration is the first thing in the repo to enforce it at all — until now it was
-- data staff read off a screen and applied with judgement. At a door there is no
-- judgement, so sign-OUT requires it and sign-IN does not: bringing a child in is not
-- taking one away.
--
-- The consequence is that `can_collect` stops being a note and becomes a control, and
-- a centre that has left it at its default for a guardian who must not collect has a
-- kiosk that will let them. Recorded in `unverified-claims`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The PINs
-- ---------------------------------------------------------------------------

create table if not exists public.guardian_pins (
  -- One PIN per guardian, so the guardian id *is* the key. A second row for the same
  -- person is not a thing that could ever be meaningful.
  guardian_id     uuid primary key references public.guardians(id) on delete cascade,

  -- bcrypt, 60 characters, salt included. Never selected by anything but the verify
  -- function below — there is no grant that would allow it.
  pin_hash        text not null,

  failed_attempts integer not null default 0,
  -- Counted in the table rather than in process. An in-process limiter does not
  -- survive a restart and does not see a second instance; the same reasoning
  -- `submit_job_application` records.
  locked_until    timestamptz,

  set_at          timestamptz not null default now(),
  set_by          uuid references auth.users(id) on delete set null,

  constraint guardian_pins_hash_is_bcrypt check (pin_hash like '$2%' and length(pin_hash) = 60),
  constraint guardian_pins_attempts_sane check (failed_attempts >= 0)
);

comment on table public.guardian_pins is
  'One bcrypt PIN per guardian, for the door tablet. No policy grants SELECT to anybody: the hash is readable only inside the definer functions in this migration.';

/*
 * RLS on, and NOT ONE POLICY.
 *
 * Deliberate, and the opposite of the convention in `conventions.md` — which is why
 * it is written down here. Every other table in this schema is reachable by somebody;
 * this one is reachable by nothing. Staff manage PINs through the three functions
 * below, all of which are definer, and the absence of a policy means a mistake in a
 * future grant still cannot expose a hash.
 *
 * The isolation suite asserts the absence directly, because "no policy" looks
 * identical to "policy forgotten".
 */
alter table public.guardian_pins enable row level security;

revoke all on public.guardian_pins from anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Who attested
-- ---------------------------------------------------------------------------

alter table public.attendance_events
  add column if not exists attested_by uuid references public.guardians(id) on delete set null;

comment on column public.attendance_events.attested_by is
  'The guardian who entered their PIN at the door. Distinct from recorded_by, which is the device. Null for every event recorded by staff in the app, which is the overwhelming majority.';

create index if not exists attendance_attested_idx on public.attendance_events (attested_by)
  where attested_by is not null;

/*
 * `attendance_insert` IS NOT TOUCHED.
 *
 * The roadmap's own warning, and it is right: adding a nullable column to an
 * append-only funding-critical table is safe, and changing its insert policy is not.
 * The kiosk does not write through the policy at all — it writes through the definer
 * function below, which is the narrow, auditable path. Staff writes are governed by
 * exactly the rule they were governed by yesterday.
 *
 * The suite asserts the old attribution rule still holds, because the failure this
 * guards against is a silent widening rather than an error.
 */

-- ---------------------------------------------------------------------------
-- Is this caller a kiosk at this centre?
-- ---------------------------------------------------------------------------

create or replace function public.caller_kiosk_centre_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.centre_id
    from public.memberships m
   where m.user_id = auth.uid()
     and m.revoked_at is null
     and m.role = 'kiosk'
   -- A device belongs to one entrance. `limit 1` is not a tie-break, it is a
   -- statement that two kiosk memberships for one account is a configuration error
   -- rather than a supported deployment.
   limit 1
$$;

comment on function public.caller_kiosk_centre_id() is
  'The centre this caller is a kiosk for, or null. Null is the answer for every human.';

revoke execute on function public.caller_kiosk_centre_id() from public;
grant  execute on function public.caller_kiosk_centre_id() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- What the door tablet may see
-- ---------------------------------------------------------------------------

/**
 * The roll, as three columns and nothing else.
 *
 * A function rather than a policy on `children`, because the requirement is
 * column-shaped and a policy cannot restrict columns. A column GRANT can — but grants
 * attach to Postgres roles, and every signed-in caller here shares the single
 * `authenticated` role, so a grant cannot vary by membership role. That leaves a
 * definer function, which is also the most auditable of the three: what a kiosk can
 * learn about a child is the `returns table` clause, in full, on one line.
 *
 * No date of birth, no conditions, no guardians, no notes. A screen in an entrance
 * shows who is here.
 */
create or replace function public.kiosk_roll()
returns table (child_id uuid, display_name text, present boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         coalesce(nullif(c.preferred_name, ''), c.first_name) as display_name,
         coalesce(t.kind = 'in', false) as present
    from public.children c
    left join public.attendance_today t on t.child_id = c.id
   where c.centre_id = public.caller_kiosk_centre_id()
     and c.archived_at is null
   order by display_name
$$;

comment on function public.kiosk_roll() is
  'The three columns a door tablet may know about a child: id, the name to show, and whether they are here. Returns nothing to a caller who is not a kiosk.';

revoke execute on function public.kiosk_roll() from public;
grant  execute on function public.kiosk_roll() to authenticated, service_role;

/**
 * The adults a kiosk may offer for a given child.
 *
 * Names only, and only guardians with a live link. `can_collect` is returned so the
 * screen can grey out the ones who may not take the child away, but the flag is
 * *enforced* in `kiosk_sign_child` rather than trusted from the client — the screen
 * is a convenience and the function is the rule.
 */
create or replace function public.kiosk_guardians(p_child uuid)
returns table (guardian_id uuid, full_name text, can_collect boolean, has_pin boolean)
language sql
stable
security definer
set search_path = public
as $$
  select g.id,
         g.full_name,
         cg.can_collect,
         exists (select 1 from public.guardian_pins p where p.guardian_id = g.id)
    from public.child_guardians cg
    join public.guardians g on g.id = cg.guardian_id
    join public.children c on c.id = cg.child_id
   where cg.child_id = p_child
     and cg.revoked_at is null
     and c.centre_id = public.caller_kiosk_centre_id()
   order by cg.contact_priority nulls last, g.full_name
$$;

comment on function public.kiosk_guardians(uuid) is
  'Guardians a door tablet may list for one child: name, whether they may collect, whether they have set a PIN. No contact details, no address, no relationship notes.';

revoke execute on function public.kiosk_guardians(uuid) from public;
grant  execute on function public.kiosk_guardians(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Signing, at the door
-- ---------------------------------------------------------------------------

/**
 * Sign a child in or out from the kiosk, attested by a guardian's PIN.
 *
 * Returns one of: `recorded`, `duplicate`, `wrong_pin`, `locked`, `no_pin`,
 * `not_permitted`. **Never raises for a failed attempt**, because raising would roll
 * back the attempt counter and the lockout would never engage — see the header.
 *
 * `not_permitted` covers every structural refusal — not a kiosk, wrong centre, not a
 * guardian of this child, `can_collect` false on a sign-out — deliberately as one
 * answer. The screen has already filtered the list it offered, so a caller reaching
 * this branch is not a person making a mistake.
 */
create or replace function public.kiosk_sign_child(
  p_child       uuid,
  p_kind        public.attendance_kind,
  p_at          timestamptz,
  p_client_uuid uuid,
  p_guardian    uuid,
  p_pin         text
)
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_centre  uuid := public.caller_kiosk_centre_id();
  v_pin     public.guardian_pins%rowtype;
  v_ok      boolean;
  v_rows    integer;
begin
  if v_centre is null then
    return 'not_permitted';
  end if;

  -- The child is at this kiosk's centre, and this guardian is live for that child.
  -- `can_collect` gates sign-OUT only: bringing a child in is not taking one away.
  if not exists (
    select 1
      from public.child_guardians cg
      join public.children c on c.id = cg.child_id
     where cg.child_id = p_child
       and cg.guardian_id = p_guardian
       and cg.revoked_at is null
       and c.centre_id = v_centre
       and c.archived_at is null
       and (p_kind <> 'out' or cg.can_collect)
  ) then
    return 'not_permitted';
  end if;

  select * into v_pin from public.guardian_pins where guardian_id = p_guardian;
  if not found then
    return 'no_pin';
  end if;

  if v_pin.locked_until is not null and v_pin.locked_until > now() then
    return 'locked';
  end if;

  v_ok := (extensions.crypt(p_pin, v_pin.pin_hash) = v_pin.pin_hash);

  if not v_ok then
    /*
      Five attempts, then fifteen minutes. The numbers are a judgement, not a
      citation: a parent mistyping at a door needs room to try again, and 10,000
      candidates at five per fifteen minutes is eight days of uninterrupted tapping in
      a staffed entrance. Recorded in unverified-claims as a chosen figure.
    */
    update public.guardian_pins
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 5
                               then now() + interval '15 minutes' else null end
     where guardian_id = p_guardian;
    return 'wrong_pin';
  end if;

  update public.guardian_pins
     set failed_attempts = 0, locked_until = null
   where guardian_id = p_guardian;

  /*
    Same idempotency contract as every other event write in this schema: the client
    generates the key before its first attempt and reuses it on retry, and a repeated
    key is reported as success. A parent told the write failed will tap again, and
    here that would be a second event nobody made.
  */
  insert into public.attendance_events (child_id, kind, at, recorded_by, client_uuid, attested_by)
  values (p_child, p_kind, p_at, auth.uid(), p_client_uuid, p_guardian)
  on conflict (client_uuid) do nothing;

  get diagnostics v_rows = row_count;
  return case when v_rows = 0 then 'duplicate' else 'recorded' end;
end;
$$;

comment on function public.kiosk_sign_child(uuid, public.attendance_kind, timestamptz, uuid, uuid, text) is
  'The only write path a door tablet has. Returns a status rather than raising, so the failed-attempt counter survives a wrong PIN.';

revoke execute on function public.kiosk_sign_child(uuid, public.attendance_kind, timestamptz, uuid, uuid, text) from public;
grant  execute on function public.kiosk_sign_child(uuid, public.attendance_kind, timestamptz, uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Managing a PIN, from the office
-- ---------------------------------------------------------------------------

/**
 * Set or replace a guardian's PIN. Owner and manager at the guardian's centre.
 *
 * Four to eight digits, checked here rather than in the app, because this function is
 * reachable over RPC and the form is not the boundary. Setting a PIN clears any
 * lockout — a parent locked out at the door rings the office, and the office resetting
 * the PIN is the fix.
 */
create or replace function public.set_guardian_pin(p_guardian uuid, p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare v_centre uuid;
begin
  select centre_id into v_centre from public.guardians where id = p_guardian;
  if v_centre is null
     or not public.caller_has_role(v_centre, array['owner', 'manager']::public.member_role[]) then
    raise exception 'not permitted';
  end if;

  if p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'a PIN is 4 to 8 digits';
  end if;

  insert into public.guardian_pins (guardian_id, pin_hash, set_by)
  values (p_guardian, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), auth.uid())
  on conflict (guardian_id) do update
    set pin_hash = excluded.pin_hash,
        set_by = excluded.set_by,
        set_at = now(),
        failed_attempts = 0,
        locked_until = null;
end;
$$;

revoke execute on function public.set_guardian_pin(uuid, text) from public;
grant  execute on function public.set_guardian_pin(uuid, text) to authenticated, service_role;

/** Remove a PIN entirely. The guardian can no longer use the door tablet. */
create or replace function public.clear_guardian_pin(p_guardian uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_centre uuid;
begin
  select centre_id into v_centre from public.guardians where id = p_guardian;
  if v_centre is null
     or not public.caller_has_role(v_centre, array['owner', 'manager']::public.member_role[]) then
    raise exception 'not permitted';
  end if;

  delete from public.guardian_pins where guardian_id = p_guardian;
end;
$$;

revoke execute on function public.clear_guardian_pin(uuid) from public;
grant  execute on function public.clear_guardian_pin(uuid) to authenticated, service_role;

/**
 * Whether a guardian has a PIN, and whether they are locked out. Never the hash.
 *
 * Staff need this to answer "why can I not sign my child in", which is a phone call
 * the office takes. It returns one boolean and one timestamp, so there is nothing
 * here worth stealing.
 */
create or replace function public.guardian_pin_status(p_guardian uuid)
returns table (has_pin boolean, locked_until timestamptz, set_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select true, p.locked_until, p.set_at
    from public.guardian_pins p
    join public.guardians g on g.id = p.guardian_id
   where p.guardian_id = p_guardian
     and public.caller_has_role(g.centre_id, array['owner', 'manager']::public.member_role[])
$$;

revoke execute on function public.guardian_pin_status(uuid) from public;
grant  execute on function public.guardian_pin_status(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Auditing, and the reason `audit_trigger` had to change to do it
--
-- `audit_trigger` attributes a row to a tenant through `centre_id`, `child_id` or
-- `invoice_id`, and gives up silently when it finds none — returning without writing,
-- because failing the operation would be worse.
--
-- `guardian_pins` carries none of the three. So the trigger would have been created,
-- the class-level assertion in the suite would have gone on passing (it checks the
-- trigger EXISTS), and not one audit row would ever have been written. That is a
-- check that reports a thing as covered while it is not, which is the failure mode
-- this repo keeps finding and is worth one more paragraph.
--
-- The added branch is safe against every existing table by inspection of the
-- catalogue: only `child_guardians` and `invoices` carry `guardian_id`, and both
-- match an earlier branch — `child_id` and `centre_id` respectively — so neither
-- changes behaviour. `guardian_pins` is the only table that reaches it.
--
-- What the audit records is the column NAME that changed, never its value, so a
-- rotated PIN appears as `{"changed": ["pin_hash", "set_at"]}` and the hash stays in
-- the one table nobody can read. The DELETE is the case that matters most: clearing a
-- PIN otherwise leaves no trace whatsoever, because the evidence goes with the row.
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
  -- that does, or off an invoice that does, or off a guardian that does.
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
    -- `guardian_pins` is keyed on the guardian and has no `id`, which would have left
    -- `entity_id` null — a permitted value, so nothing would have failed, and the
    -- audit would have said "a PIN changed at this centre" without saying whose. That
    -- is worse than an error, because it looks like a record. Every existing table has
    -- `id`, so the coalesce never changes their behaviour.
    coalesce(v_row ->> 'id', v_row ->> 'guardian_id'),
    v_detail
  );

  return coalesce(new, old);
end;
$$;

drop trigger if exists guardian_pins_audit on public.guardian_pins;
create trigger guardian_pins_audit
  after insert or update or delete on public.guardian_pins
  for each row execute function public.audit_trigger();
