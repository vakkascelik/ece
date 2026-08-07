-- ---------------------------------------------------------------------------
-- 0032 — the other half of a medication record
--
-- `medication_authorities` (0004) records that a guardian said yes. Nothing has ever
-- recorded that anybody then gave the child anything. That is half a licensing
-- requirement implemented: the authority answers "were we allowed to", and the part
-- a review actually asks about is "what did you give, when, and who gave it".
--
-- Append-only, and for the strongest version of the reason. A medication record that
-- can be edited after the fact is worth nothing in the one conversation it exists
-- for — the one that starts with a child having had a reaction. A correction is a
-- new row citing the one it corrects, exactly as `attendance_events` does, and
-- UPDATE and DELETE are withheld from everybody including `service_role`.
--
-- WHY `child_id` IS DENORMALISED OFF THE AUTHORITY
--
-- Two reasons, and both would be re-normalised away by somebody tidying up, so they
-- are written down. Every policy evaluation would otherwise join to
-- `medication_authorities` to find the child; and `purge_child` deletes the child
-- row and relies on cascade, so a table reaching its child through a second table
-- depends on that table's cascade firing first. A direct
-- `references children(id) on delete cascade` is one hop and cannot be got wrong.
--
-- The trigger below asserts the two agree, so the denormalisation cannot drift.
-- ---------------------------------------------------------------------------

create table if not exists public.medication_administrations (
  id           bigserial primary key,

  authority_id uuid not null references public.medication_authorities(id) on delete cascade,
  child_id     uuid not null references public.children(id) on delete cascade,

  given_at     timestamptz not null,
  -- What was actually given, not what was authorised. Those differ — half a dose
  -- because the child spat it out is the entry a reviewer most wants to find.
  dose_given   text not null,

  -- Nullable and `on delete set null`, matching `attendance_events.recorded_by`: an
  -- account that is later deleted must not take the medication record with it. The
  -- insert policy pins it to the caller, so it is only ever null in retrospect.
  given_by     uuid references auth.users(id) on delete set null,
  witnessed_by uuid references auth.users(id) on delete set null,

  /**
   * Fixed at enqueue on the device, reused on every retry. Identical contract to
   * `attendance_events.client_uuid`: the failure mode of a flaky connection at the
   * medicine cupboard is a dose recorded three times, and a unique key is what makes
   * the retry safe rather than the retry logic.
   */
  client_uuid  uuid not null unique,

  corrects     bigint references public.medication_administrations(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now(),

  constraint medication_admin_dose_present check (length(trim(dose_given)) > 0),
  -- Same tolerances as attendance, for the same reasons: a couple of hours of clock
  -- skew is real, the future is not, and the outbox can be a fortnight behind.
  constraint medication_admin_not_future check (given_at <= now() + interval '2 hours'),
  constraint medication_admin_not_ancient check (given_at > now() - interval '14 days'),
  constraint medication_admin_correction_has_note
    check (corrects is null or length(coalesce(note, '')) >= 3),
  -- A witness who is the person administering is not a witness.
  constraint medication_admin_witness_is_other
    check (witnessed_by is null or witnessed_by is distinct from given_by)
);

comment on table public.medication_administrations is
  'What was actually given, when, by whom. Append-only: a correction is a new row citing corrects. No UPDATE or DELETE grant exists for anybody, service_role included.';

create index if not exists medication_admin_child_idx
  on public.medication_administrations (child_id, given_at desc);
create index if not exists medication_admin_authority_idx
  on public.medication_administrations (authority_id, given_at desc);

-- ---------------------------------------------------------------------------
-- Whether a second pair of eyes is required
--
-- Default FALSE, deliberately. Whether a service must have a second person witness
-- a dose is a claim about the licensing criteria, and this repo has not read the
-- criteria — that is the whole reason `criteria` ships empty. Defaulting to true
-- would assert a regulation nobody here has sourced; defaulting to false and letting
-- a centre turn it on asserts nothing and still makes the control real once they do.
--
-- Recorded in unverified-claims.
-- ---------------------------------------------------------------------------

alter table public.centres
  add column if not exists medication_requires_witness boolean not null default false;

comment on column public.centres.medication_requires_witness is
  'Centre policy, not a regulation this repo has verified. When true, the trigger refuses a dose with no witness.';

-- `centres_update` is already owner/manager only, so this column inherits that.
grant update (medication_requires_witness) on public.centres to authenticated;

-- ---------------------------------------------------------------------------
-- Administration must fall inside the authority
--
-- This cannot be a CHECK constraint: it reads another table, and `starts_on` /
-- `expires_on` live on the authority. So it is a trigger, and it is a hard refusal
-- rather than a warning — giving a child a prescription medicine outside the window
-- their guardian authorised is the exact event `medication_authorities` exists to
-- prevent, and a product that records it politely has helped nobody.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_medication_within_authority()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_child   uuid;
  v_starts_on    date;
  v_expires_on   date;
  v_given_date   date;
  v_needs_witness boolean;
begin
  select ma.child_id, ma.starts_on, ma.expires_on
    into v_auth_child, v_starts_on, v_expires_on
    from public.medication_authorities ma
   where ma.id = new.authority_id;

  if v_auth_child is null then
    raise exception 'No such medication authority.' using errcode = '23503';
  end if;

  -- The denormalisation cannot drift into a record that says one child and cites an
  -- authority for another.
  if v_auth_child <> new.child_id then
    raise exception 'This administration names a different child from the authority it cites.'
      using errcode = '23514';
  end if;

  /*
   * The date the dose was given **at the centre**, not in UTC. A dose given at 9am
   * in Auckland is 9pm yesterday in UTC, so a UTC date would put the morning of the
   * first authorised day outside the window and refuse it — the same class of bug as
   * 0006 and 0029, arriving here as a refusal to give a child their medicine.
   */
  select (new.given_at at time zone ce.timezone)::date, ce.medication_requires_witness
    into v_given_date, v_needs_witness
    from public.children c
    join public.centres ce on ce.id = c.centre_id
   where c.id = new.child_id;

  if v_given_date < v_starts_on
     or (v_expires_on is not null and v_given_date > v_expires_on) then
    raise exception
      'Medicine given outside the window the guardian authorised (% to %).',
      v_starts_on, coalesce(v_expires_on::text, 'open')
      using errcode = '23514';
  end if;

  if v_needs_witness and new.witnessed_by is null then
    raise exception 'This centre requires a second person to witness a dose.'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Trigger only. Same reasoning as 0031: a definer function reachable by `anon` is a
-- hole waiting for an edit, and firing a trigger needs TRIGGER on the table rather
-- than EXECUTE on the function.
revoke execute on function public.enforce_medication_within_authority() from public;

drop trigger if exists medication_admin_within_authority on public.medication_administrations;
create trigger medication_admin_within_authority
  before insert on public.medication_administrations
  for each row execute function public.enforce_medication_within_authority();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.medication_administrations enable row level security;

/*
 * Read: staff and the child's own guardians, matching `medication_authorities`.
 *
 * Unlike `incidents` there is no draft here and no reason to withhold anything — a
 * parent is entitled to know their child was given medicine and when, and a product
 * that made them ask for it would be worse than the paper book it replaces.
 */
drop policy if exists medication_admin_select on public.medication_administrations;
create policy medication_admin_select on public.medication_administrations
  for select using (public.caller_may_see_child(child_id));

/*
 * Write: staff only, attributed to the caller. A guardian may authorise a medicine
 * and does not administer one at the centre, and `given_by` is the answer to the
 * question this table exists for.
 */
drop policy if exists medication_admin_write_insert on public.medication_administrations;
create policy medication_admin_write_insert on public.medication_administrations
  for insert with check (
    public.caller_is_staff_for_child(child_id)
    and (given_by is null or given_by = auth.uid())
  );

-- No UPDATE and no DELETE policy. A correction is a new row; the grants below
-- withhold the verbs as well, so it is enforced twice — the same shape as
-- `attendance_events`.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.medication_administrations from anon, authenticated, service_role;

grant select, insert on public.medication_administrations to authenticated;
grant usage on sequence public.medication_administrations_id_seq to authenticated;

-- `service_role` gets SELECT only. It bypasses RLS but not grants, so this is what
-- makes "no medication record was ever altered" true of the whole system rather
-- than only of its API callers.
grant select on public.medication_administrations to service_role;

-- No audit trigger, and this is a decision rather than an omission: the row IS the
-- record, and an audit row describing an insert that can never be followed by an
-- edit says nothing the table does not already say. The suite and
-- `scripts/security-review.ts` both carry the exemption by name, so a future
-- mutable table cannot inherit it silently.
