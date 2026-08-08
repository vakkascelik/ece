-- ---------------------------------------------------------------------------
-- 0037 — excursions: the plan, the consents, and the headcount
--
-- Taking children off site is the highest-consequence ordinary thing a centre does,
-- and the paperwork around it is the part that fails quietly: a consent form signed
-- for a different trip, a child added to the list on the morning, a headcount nobody
-- wrote down.
--
-- THE DESIGN TRAP, AND THE REASON THIS IS FOUR TABLES
--
-- `consent_kind` already has `'excursion'`. It is a **standing** consent — "we are
-- happy for our child to go on outings" — recorded once at enrolment in
-- `consent_events`. Reusing it as the consent for a *specific* outing is the mistake
-- this migration exists to make impossible: it would let a centre take a child to a
-- beach in 2028 on a form a family signed in 2026, having never been told where
-- their child was going.
--
-- So a specific outing gets its own consent record, and the standing one stays what
-- it is: a **precondition**, not a substitute. Both are shown on the screen and
-- neither stands in for the other.
--
-- WHAT IS DELIBERATELY NOT ENFORCED
--
-- A headcount that does not match is **recorded, not refused**. Refusing it would
-- destroy the evidence that a child was briefly unaccounted for — which is the exact
-- record that matters afterwards, and the reason to count at all. The register's job
-- is to hold what happened; the screen's job is to make a mismatch impossible to
-- miss.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.excursion_status as enum ('planned', 'departed', 'returned', 'cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.excursions (
  id               uuid primary key default gen_random_uuid(),
  centre_id        uuid not null references public.centres(id) on delete cascade,

  destination      text not null,
  purpose          text,
  departs_at       timestamptz not null,
  /** Planned return, so somebody in the building knows when to start worrying. */
  returns_at       timestamptz,
  transport        text,

  /**
   * The outing's own plan — route, hazards, what happens if it rains.
   *
   * Free text on purpose. A structured risk assessment would need a taxonomy of
   * hazards this repo has not sourced, and the same argument applies as everywhere
   * else in these two phases: a form with invented categories produces a document
   * that looks official and is not.
   */
  plan             text,
  adults_attending smallint,

  status           public.excursion_status not null default 'planned',
  departed_at      timestamptz,
  returned_at      timestamptz,

  recorded_by      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint excursions_destination_present check (length(trim(destination)) > 0),
  constraint excursions_return_after_departure check (returns_at is null or returns_at >= departs_at),
  constraint excursions_adults_sane check (adults_attending is null or adults_attending between 0 and 100),
  -- The status and its timestamp cannot disagree, in either direction. A trip marked
  -- departed with no departure time, or a departure time on one still marked planned,
  -- are both records that cannot be read back.
  constraint excursions_departed_has_time
    check ((status in ('departed', 'returned')) = (departed_at is not null)),
  constraint excursions_returned_has_time
    check ((status = 'returned') = (returned_at is not null))
);

comment on table public.excursions is
  'One outing. Consent for it lives in excursion_consents, per child, and is NOT the standing `excursion` consent in consent_events.';

create index if not exists excursions_centre_idx on public.excursions (centre_id, departs_at desc);
-- Partial: "who is off site right now" is the question during an emergency at the centre.
create index if not exists excursions_out_idx on public.excursions (centre_id) where status = 'departed';

-- ---------------------------------------------------------------------------
-- Who is going
-- ---------------------------------------------------------------------------

create table if not exists public.excursion_children (
  excursion_id uuid not null references public.excursions(id) on delete cascade,
  child_id     uuid not null references public.children(id)   on delete cascade,
  added_at     timestamptz not null default now(),
  primary key (excursion_id, child_id)
);

comment on table public.excursion_children is
  'The plan: who is intended to go. Being on this list is not consent — see excursion_consents and the departure trigger.';

create index if not exists excursion_children_child_idx on public.excursion_children (child_id);

-- ---------------------------------------------------------------------------
-- Consent, for THIS outing
--
-- Append-only, exactly like `consent_events`, and for the same reason: "do we have
-- consent" and "did we have consent on the day" are different questions and only the
-- second matters once somebody asks. Withdrawal is a new row with `granted = false`.
-- ---------------------------------------------------------------------------

create table if not exists public.excursion_consents (
  id           bigserial primary key,
  excursion_id uuid not null references public.excursions(id) on delete cascade,
  child_id     uuid not null references public.children(id)   on delete cascade,

  granted      boolean not null,
  /** The guardian whose decision this is — not the person who typed it in. */
  given_by     uuid references public.guardians(id) on delete set null,
  recorded_by  uuid references auth.users(id) on delete set null,
  note         text,
  at           timestamptz not null default now()
);

comment on table public.excursion_consents is
  'Consent for one child on one outing. Append-only; withdrawal is a new row. Distinct from the standing `excursion` consent kind, which is a precondition and not a substitute.';

create index if not exists excursion_consents_lookup_idx
  on public.excursion_consents (excursion_id, child_id, at desc);

-- ---------------------------------------------------------------------------
-- Headcounts
--
-- Append-only. `expected` is recorded rather than derived at read time, so the count
-- stays meaningful after a child is added to or removed from the plan — a record
-- whose denominator moves afterwards cannot be read back honestly.
-- ---------------------------------------------------------------------------

create table if not exists public.excursion_headcounts (
  id           bigserial primary key,
  excursion_id uuid not null references public.excursions(id) on delete cascade,

  at           timestamptz not null,
  counted      smallint not null,
  expected     smallint not null,
  counted_by   uuid references auth.users(id) on delete set null,
  client_uuid  uuid not null unique,
  note         text,
  created_at   timestamptz not null default now(),

  constraint excursion_headcounts_sane check (counted >= 0 and expected >= 0 and expected <= 500),
  constraint excursion_headcounts_not_future check (at <= now() + interval '2 hours')
  -- Deliberately NO constraint requiring counted = expected. See the header: a
  -- mismatch is the record that matters, and refusing it destroys the evidence.
);

comment on table public.excursion_headcounts is
  'A count taken during an outing. Append-only, and a count that does not match expected is accepted — refusing it would destroy the evidence that a child was unaccounted for.';

create index if not exists excursion_headcounts_idx
  on public.excursion_headcounts (excursion_id, at desc);

-- ---------------------------------------------------------------------------
-- Departure requires consent for everybody on the list
--
-- The one hard gate in this migration, and it is on the *transition* rather than on
-- the list: a child is often added to the plan before their family has answered, and
-- refusing that would push staff into keeping the real list somewhere else.
--
-- The message carries a COUNT and not names. An exception string can reach a log, an
-- error reporter, or a screen in a room with parents in it, and this schema's rule is
-- that identifying detail does not travel in messages — the same reason
-- `audit_events.detail` holds column names and never values. The screen has the roll
-- already and can say who.
-- ---------------------------------------------------------------------------

create or replace function public.enforce_excursion_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_missing integer;
begin
  if new.status <> 'departed' or old.status = 'departed' then
    return new;
  end if;

  select count(*)
    into v_missing
    from public.excursion_children ec
   where ec.excursion_id = new.id
     and coalesce(
       (select k.granted
          from public.excursion_consents k
         where k.excursion_id = new.id
           and k.child_id = ec.child_id
         order by k.at desc, k.id desc
         limit 1),
       false
     ) = false;

  if v_missing > 0 then
    raise exception
      '% tamariki on this outing have no consent recorded for it. An outing cannot depart without one for each child.',
      v_missing
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_excursion_departure() from public;

drop trigger if exists excursions_departure on public.excursions;
create trigger excursions_departure
  before update on public.excursions
  for each row execute function public.enforce_excursion_departure();

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.excursions           enable row level security;
alter table public.excursion_children   enable row level security;
alter table public.excursion_consents   enable row level security;
alter table public.excursion_headcounts enable row level security;

-- The outing itself is centre business. A family reads *their child's* involvement
-- through `excursion_children` below, which is where guardianship applies.
drop policy if exists excursions_select on public.excursions;
create policy excursions_select on public.excursions
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists excursions_write_insert on public.excursions;
create policy excursions_write_insert on public.excursions
  for insert with check (
    centre_id in (select public.caller_staff_centre_ids())
    and (recorded_by is null or recorded_by = auth.uid())
  );

drop policy if exists excursions_write_update on public.excursions;
create policy excursions_write_update on public.excursions
  for update using (centre_id in (select public.caller_staff_centre_ids()))
          with check (centre_id in (select public.caller_staff_centre_ids()));

-- Staff see the whole list; a guardian sees only their own child's place on it.
drop policy if exists excursion_children_select on public.excursion_children;
create policy excursion_children_select on public.excursion_children
  for select using (public.caller_may_see_child(child_id));

drop policy if exists excursion_children_write_insert on public.excursion_children;
create policy excursion_children_write_insert on public.excursion_children
  for insert with check (public.caller_is_staff_for_child(child_id));

-- Removing a child from a plan is not destroying evidence — the outing has not
-- happened, and a stale list is worse than a corrected one. This is the one DELETE
-- granted in Phase 9, and it is granted here for the same reason 0024 grants it on
-- `job_applications` and withholds it on `waitlist`.
drop policy if exists excursion_children_write_delete on public.excursion_children;
create policy excursion_children_write_delete on public.excursion_children
  for delete using (public.caller_is_staff_for_child(child_id));

/*
 * Consent: read by staff and the child's own family; written by either.
 *
 * A guardian may record their own decision, and staff transcribe paper forms — the
 * same shape as `consent_events`, including that `given_by` names the guardian whose
 * decision it is rather than whoever typed it. A parent may only attribute one to
 * themselves, which is enforced below.
 */
drop policy if exists excursion_consents_select on public.excursion_consents;
create policy excursion_consents_select on public.excursion_consents
  for select using (public.caller_may_see_child(child_id));

drop policy if exists excursion_consents_write_insert on public.excursion_consents;
create policy excursion_consents_write_insert on public.excursion_consents
  for insert with check (
    public.caller_may_see_child(child_id)
    and (recorded_by is null or recorded_by = auth.uid())
    and (
      -- Staff may record a decision on behalf of any guardian, from a paper form.
      public.caller_is_staff_for_child(child_id)
      -- A guardian may record only their own.
      or given_by in (select public.caller_guardian_ids())
    )
  );

-- Headcounts are about the outing, not about a child, so they follow the excursion's
-- boundary: staff only.
drop policy if exists excursion_headcounts_select on public.excursion_headcounts;
create policy excursion_headcounts_select on public.excursion_headcounts
  for select using (
    exists (
      select 1 from public.excursions e
       where e.id = excursion_id
         and e.centre_id in (select public.caller_staff_centre_ids())
    )
  );

drop policy if exists excursion_headcounts_write_insert on public.excursion_headcounts;
create policy excursion_headcounts_write_insert on public.excursion_headcounts
  for insert with check (
    exists (
      select 1 from public.excursions e
       where e.id = excursion_id
         and e.centre_id in (select public.caller_staff_centre_ids())
    )
    and (counted_by is null or counted_by = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.excursions           from anon, authenticated, service_role;
revoke all on public.excursion_children   from anon, authenticated, service_role;
revoke all on public.excursion_consents   from anon, authenticated, service_role;
revoke all on public.excursion_headcounts from anon, authenticated, service_role;

grant select, insert, update on public.excursions to authenticated, service_role;
grant select, insert, delete on public.excursion_children to authenticated, service_role;

-- Append-only, both of them.
grant select, insert on public.excursion_consents to authenticated;
grant usage on sequence public.excursion_consents_id_seq to authenticated;
grant select on public.excursion_consents to service_role;

grant select, insert on public.excursion_headcounts to authenticated;
grant usage on sequence public.excursion_headcounts_id_seq to authenticated;
grant select on public.excursion_headcounts to service_role;

-- ---------------------------------------------------------------------------
-- Audit
--
-- `excursions` and `excursion_children` are mutable and carry the trigger. The two
-- append-only tables are exempt by name in the suite and in the security review.
-- ---------------------------------------------------------------------------

drop trigger if exists excursions_audit on public.excursions;
create trigger excursions_audit
  after insert or update or delete on public.excursions
  for each row execute function public.audit_trigger();

drop trigger if exists excursion_children_audit on public.excursion_children;
create trigger excursion_children_audit
  after insert or update or delete on public.excursion_children
  for each row execute function public.audit_trigger();
