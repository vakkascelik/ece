-- 0004 — children, whānau, enrolment, health and consent
--
-- The first migration that holds real child data, and the reason the rest of this
-- schema was built the way it was.
--
-- WHAT MAKES THIS DIFFERENT FROM EVERY TABLE SO FAR
--
-- Up to here, "who may see this row" had one answer: members of the centre. That
-- is no longer sufficient, because `parent` is a role inside the tenant. A parent
-- at Little Pearls Mt Albert is a legitimate member of that centre and must see
-- their own child's allergies — and must never see the child sitting next to
-- them. So the boundary for these tables is guardianship, not tenancy, and
-- tenancy alone would be a data breach that every existing test passes.
--
-- Three predicates carry it, all SECURITY DEFINER for the same reason
-- `caller_centre_ids()` is: they read tables that are themselves under RLS, and
-- without it every policy below would recurse.
--
--   caller_staff_centre_ids()  centres where the caller is owner/manager/educator
--   caller_ward_ids()          children the caller is a guardian of
--   caller_guardian_ids()      the caller's own guardian records
--
-- Each one requires a LIVE membership, so revoking a parent's access cuts them
-- off from their own child's record immediately. That is asserted in the suite —
-- it is the kind of thing that looks obviously true and quietly is not.

create extension if not exists "btree_gist";

-- ---------------------------------------------------------------------------
-- Children
-- ---------------------------------------------------------------------------

create table if not exists public.children (
  id             uuid primary key default gen_random_uuid(),
  centre_id      uuid not null references public.centres(id) on delete cascade,

  first_name     text not null,
  last_name      text not null,
  -- What the child is actually called. Often not a shortening of the legal name,
  -- and it is what an educator says out loud all day, so it is a first-class
  -- field rather than a note somebody has to open a record to find.
  preferred_name text,
  date_of_birth  date not null,

  -- Ministry data. Needed for funding returns and roll reconciliation later, and
  -- collected at enrolment because nobody wants to chase it in July.
  moe_nsn        text,
  -- Up to three, which is what the Ministry accepts. Stats NZ level-1 descriptors
  -- rather than codes: this is read by educators far more often than it is
  -- exported, and a screen full of numeric codes gets filled in wrongly.
  ethnicities    text[] not null default '{}',
  iwi            text,
  first_language text,
  gender         text,

  -- A child's record is retained after they leave — the Ministry requires it and
  -- so does any later question about who was present when something happened. So
  -- archived, never deleted.
  archived_at    timestamptz,
  created_at     timestamptz not null default now(),

  constraint children_gender_known check (
    gender is null or gender in ('female', 'male', 'another', 'unspecified')
  ),
  constraint children_ethnicities_max_three check (cardinality(ethnicities) <= 3),
  -- A date of birth in the future is a typo, and one 20 years ago is a different
  -- typo. Both have been typed into every enrolment system ever built.
  constraint children_dob_plausible check (
    date_of_birth <= current_date and date_of_birth > current_date - interval '20 years'
  ),
  constraint children_nsn_unique_per_centre unique (centre_id, moe_nsn)
);

comment on table public.children is
  'Enrolled and former children. Visible to centre staff, and to a guardian for their own child only.';
comment on column public.children.moe_nsn is
  'Ministry National Student Number. Unique within a centre; null until issued.';

create index if not exists children_centre_idx on public.children (centre_id) where archived_at is null;
create index if not exists children_name_idx   on public.children (centre_id, last_name, first_name);

-- ---------------------------------------------------------------------------
-- Guardians and the link to children
-- ---------------------------------------------------------------------------

-- `user_id` is nullable, and usually null. A grandparent who is on the collection
-- list does not need an account, and requiring one would make the emergency
-- contact list depend on somebody completing a sign-up.
create table if not exists public.guardians (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,

  full_name   text not null,
  email       text,
  phone       text,
  address     text,

  archived_at timestamptz,
  created_at  timestamptz not null default now(),

  -- One guardian record per person per centre. Two rows for the same account is
  -- how one of them ends up missing a consent.
  constraint guardians_user_unique_per_centre unique (centre_id, user_id)
);

create index if not exists guardians_centre_idx on public.guardians (centre_id) where archived_at is null;
create index if not exists guardians_user_idx   on public.guardians (user_id) where user_id is not null;

create table if not exists public.child_guardians (
  id                   uuid primary key default gen_random_uuid(),
  child_id             uuid not null references public.children(id)  on delete cascade,
  guardian_id          uuid not null references public.guardians(id) on delete cascade,

  -- Free text rather than an enum. "Mother", "father", "aunty", "whāngai
  -- caregiver", "grandmother (primary)" — an enum here would be a list of the
  -- family shapes the author happened to think of, and the ones it omits are
  -- exactly the families already used to being told their arrangement is invalid.
  relationship         text not null,

  is_primary           boolean not null default false,
  -- Distinct from is_primary on purpose. The person the centre rings first and
  -- the people allowed to take a child home are different lists, and conflating
  -- them is how a child leaves with the wrong adult.
  can_collect          boolean not null default true,
  is_emergency_contact boolean not null default false,
  -- Ring order for emergency contacts. Lower first.
  contact_priority     smallint not null default 100,

  revoked_at           timestamptz,
  created_at           timestamptz not null default now(),

  constraint child_guardians_unique unique (child_id, guardian_id)
);

create index if not exists child_guardians_child_idx    on public.child_guardians (child_id)    where revoked_at is null;
create index if not exists child_guardians_guardian_idx on public.child_guardians (guardian_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- Custody arrangements — a separate table, deliberately
-- ---------------------------------------------------------------------------
--
-- This could have been a `custody_notes` column on child_guardians. It is not,
-- because the visibility rule is different from everything around it: a custody
-- arrangement is a record ABOUT the guardians, so it must not be readable BY the
-- guardians.
--
-- "Father is not to collect, parenting order in place" is information the centre
-- needs and the other parent must not read in the app. A policy cannot restrict
-- some columns of a row to one role and other columns to another, and a
-- column-level GRANT cannot vary by role either. A separate table with a
-- staff-only policy expresses it exactly once and cannot be got wrong by
-- someone adding a field later.
create table if not exists public.custody_arrangements (
  id                     uuid primary key default gen_random_uuid(),
  child_id               uuid not null references public.children(id) on delete cascade,
  detail                 text not null,
  court_order_reference  text,
  recorded_by            uuid references auth.users(id) on delete set null,
  at                     timestamptz not null default now(),
  -- Superseded rather than edited, so the arrangement in force on a given date is
  -- still answerable. This gets asked in front of a lawyer.
  superseded_at          timestamptz
);

comment on table public.custody_arrangements is
  'Court orders and collection restrictions. STAFF ONLY — never readable by a guardian, including the guardian it concerns.';

create index if not exists custody_child_idx on public.custody_arrangements (child_id) where superseded_at is null;

-- ---------------------------------------------------------------------------
-- Enrolment
-- ---------------------------------------------------------------------------

create table if not exists public.enrolments (
  id                     uuid primary key default gen_random_uuid(),
  child_id               uuid not null references public.children(id) on delete cascade,
  centre_id              uuid not null references public.centres(id)  on delete cascade,

  start_date             date not null,
  -- Null means open-ended, which is the normal state of an enrolled child.
  end_date               date,

  funded_hours_per_week  numeric(5, 2) not null default 0,
  -- 20 Hours ECE is an attestation the parent signs, not something derived from
  -- the hours, so it is recorded separately from them.
  twenty_hours_ece       boolean not null default false,
  -- ISO weekdays, 1 = Monday. An array rather than seven booleans because the
  -- question asked of it is always "which days", never "is Tuesday set".
  days                   smallint[] not null default '{}',
  notes                  text,
  created_at             timestamptz not null default now(),

  constraint enrolments_dates_ordered check (end_date is null or end_date >= start_date),
  constraint enrolments_days_valid check (
    days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  constraint enrolments_hours_sane check (funded_hours_per_week between 0 and 50),

  -- Two overlapping enrolments for one child double-count funded hours, and the
  -- error surfaces months later as a funding discrepancy nobody can trace. The
  -- database refuses it instead. `[)` so a new enrolment may start the day the
  -- previous one ends; 'infinity' so an open-ended enrolment overlaps everything
  -- after it, which is the intent.
  constraint enrolments_no_overlap exclude using gist (
    child_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[)') with &&
  )
);

create index if not exists enrolments_child_idx  on public.enrolments (child_id);
create index if not exists enrolments_centre_idx on public.enrolments (centre_id, start_date desc);

-- ---------------------------------------------------------------------------
-- Health
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.health_kind as enum ('allergy', 'medical_condition', 'dietary_requirement');
exception when duplicate_object then null; end $$;

-- 'anaphylaxis' is separated from 'severe' because it changes what an educator
-- does, not just how worried they are: it means adrenaline, and it means the
-- response plan is not optional reading.
do $$ begin
  create type public.health_severity as enum ('mild', 'moderate', 'severe', 'anaphylaxis');
exception when duplicate_object then null; end $$;

create table if not exists public.health_conditions (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.children(id) on delete cascade,
  kind          public.health_kind not null,
  name          text not null,
  severity      public.health_severity,
  -- What to do, in the words of whoever will have to do it. Free text on purpose:
  -- a structured version of an emergency response plan is a form somebody fills
  -- in badly instead of writing the two sentences that matter.
  response_plan text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

comment on column public.health_conditions.severity is
  'Null for dietary requirements. anaphylaxis is not a synonym for severe — it means adrenaline.';

create index if not exists health_child_idx on public.health_conditions (child_id) where resolved_at is null;

create table if not exists public.medication_authorities (
  id            uuid primary key default gen_random_uuid(),
  child_id      uuid not null references public.children(id) on delete cascade,

  medicine      text not null,
  dose          text not null,
  route         text,
  instructions  text,

  -- Who authorised it. Administering medicine without a guardian's authority is a
  -- licensing breach, so the authority is part of the record, not an assumption.
  authorised_by uuid references public.guardians(id) on delete set null,
  authorised_at timestamptz not null default now(),
  starts_on     date not null default current_date,
  -- Authorities expire. An open-ended authority to give a prescription medicine
  -- is not an authority anybody would defend at a review.
  expires_on    date,

  created_at    timestamptz not null default now(),
  constraint medication_dates_ordered check (expires_on is null or expires_on >= starts_on)
);

create index if not exists medication_child_idx on public.medication_authorities (child_id);

-- ---------------------------------------------------------------------------
-- Consent
-- ---------------------------------------------------------------------------

-- Photo consent is split. Putting a child's face in the private learning journal
-- their own whānau reads and putting it on the centre's Facebook page are not the
-- same permission, and every family that has ever objected has objected to the
-- second one. A single `photo` flag forces the centre to either over-collect or
-- over-share.
do $$ begin
  create type public.consent_kind as enum (
    'photo_internal',
    'photo_public',
    'excursion',
    'sunscreen',
    'nappy_cream',
    'medical_emergency',
    'transport'
  );
exception when duplicate_object then null; end $$;

-- Events, not state. "Do we have photo consent" and "did we have photo consent in
-- March, when we published that newsletter" are different questions, and only the
-- second one matters once somebody complains. So consent is append-only and
-- withdrawal is a new event, exactly like the audit log.
create table if not exists public.consent_events (
  id          bigserial primary key,
  child_id    uuid    not null references public.children(id) on delete cascade,
  kind        public.consent_kind not null,
  granted     boolean not null,

  -- The guardian whose consent this is. Not the person who typed it in — staff
  -- record consent from a paper form all the time, and conflating the two loses
  -- the only fact that matters.
  given_by    uuid references public.guardians(id) on delete set null,
  recorded_by uuid references auth.users(id) on delete set null,
  note        text,
  at          timestamptz not null default now()
);

comment on table public.consent_events is
  'Append-only consent history. Withdrawal is a new row with granted = false. No update or delete policy exists, by design.';

create index if not exists consent_child_kind_idx on public.consent_events (child_id, kind, at desc);

-- ---------------------------------------------------------------------------
-- Access predicates
-- ---------------------------------------------------------------------------

/** Centres where the caller is staff — owner, manager or educator, not parent. */
create or replace function public.caller_staff_centre_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select centre_id
    from public.memberships
   where user_id = auth.uid()
     and revoked_at is null
     and role in ('owner', 'manager', 'educator')
$$;

/**
 * The caller's own guardian records.
 *
 * Requires a live membership at the guardian's centre. A guardian row on its own
 * is a contact detail, not a grant — access ends when the membership is revoked.
 */
create or replace function public.caller_guardian_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select g.id
    from public.guardians g
    join public.memberships m
      on m.centre_id = g.centre_id
     and m.user_id = auth.uid()
     and m.revoked_at is null
   where g.user_id = auth.uid()
     and g.archived_at is null
$$;

/**
 * Children the caller is a guardian of.
 *
 * Also gated on a live membership, so revoking a parent's access closes their own
 * child's record too. Without that clause a revoked parent keeps reading health
 * notes indefinitely, and nothing in the UI would show it.
 */
create or replace function public.caller_ward_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select cg.child_id
    from public.child_guardians cg
    join public.guardians   g on g.id = cg.guardian_id
    join public.children    c on c.id = cg.child_id
    join public.memberships m on m.centre_id = c.centre_id
                             and m.user_id = auth.uid()
                             and m.revoked_at is null
   where g.user_id = auth.uid()
     and g.archived_at is null
     and cg.revoked_at is null
$$;

/** Is the caller staff at the centre this child belongs to? */
create or replace function public.caller_is_staff_for_child(p_child uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.children c
     where c.id = p_child
       and c.centre_id in (select public.caller_staff_centre_ids())
  )
$$;

/** May the caller see this child at all — as staff, or as their guardian? */
create or replace function public.caller_may_see_child(p_child uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.caller_is_staff_for_child(p_child)
      or p_child in (select public.caller_ward_ids())
$$;

/**
 * Current consent for one child and one kind.
 *
 * The point of this function is that Phase 4's media pipeline can enforce consent
 * in SQL rather than remembering to check it in application code. It is
 * `security invoker`, so a caller who cannot see the child gets `false` and the
 * write is refused — the safe direction. A definer version would answer honestly
 * to anybody and turn a missing check into a leak.
 */
create or replace function public.has_consent(p_child uuid, p_kind public.consent_kind)
returns boolean language sql stable security invoker set search_path = public as $$
  select coalesce(
    (select granted
       from public.consent_events
      where child_id = p_child and kind = p_kind
      order by at desc, id desc
      limit 1),
    false
  )
$$;

-- Latest event per child and kind. security_invoker so the caller's own RLS on
-- consent_events applies — see the note in 0002 about what a view does otherwise.
create or replace view public.current_consents
with (security_invoker = on) as
  select distinct on (child_id, kind)
    child_id, kind, granted, given_by, at
  from public.consent_events
  order by child_id, kind, at desc, id desc;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.children              enable row level security;
alter table public.guardians             enable row level security;
alter table public.child_guardians       enable row level security;
alter table public.custody_arrangements  enable row level security;
alter table public.enrolments            enable row level security;
alter table public.health_conditions     enable row level security;
alter table public.medication_authorities enable row level security;
alter table public.consent_events        enable row level security;

-- Children ------------------------------------------------------------------

drop policy if exists children_select on public.children;
create policy children_select on public.children
  for select using (
    centre_id in (select public.caller_staff_centre_ids())
    or id in (select public.caller_ward_ids())
  );

-- Enrolling and editing a child is office work. An educator reads the record all
-- day and does not maintain it, and a parent maintains none of it.
drop policy if exists children_write on public.children;
create policy children_write on public.children
  for all
  using      (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

-- Guardians -----------------------------------------------------------------

-- A parent sees their OWN guardian record and no other. Not co-guardians.
--
-- That is a deliberate restriction and it is not about tidiness: in a domain
-- where separated parents and protection orders are ordinary, an app that hands
-- one parent the other's current phone number and address on request is a safety
-- problem. Staff can see the whole list, which is who needs it.
drop policy if exists guardians_select on public.guardians;
create policy guardians_select on public.guardians
  for select using (
    centre_id in (select public.caller_staff_centre_ids())
    or id in (select public.caller_guardian_ids())
  );

drop policy if exists guardians_write on public.guardians;
create policy guardians_write on public.guardians
  for all
  using      (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

-- Child ↔ guardian links ----------------------------------------------------

drop policy if exists child_guardians_select on public.child_guardians;
create policy child_guardians_select on public.child_guardians
  for select using (
    public.caller_is_staff_for_child(child_id)
    or guardian_id in (select public.caller_guardian_ids())
  );

drop policy if exists child_guardians_write on public.child_guardians;
create policy child_guardians_write on public.child_guardians
  for all
  using      (public.caller_is_staff_for_child(child_id))
  with check (public.caller_is_staff_for_child(child_id));

-- Custody -------------------------------------------------------------------

-- Staff only, and only owner/manager at that. An educator needs to know a child
-- must not go home with a named adult, which belongs on the collection list — not
-- the terms of a parenting order.
drop policy if exists custody_select on public.custody_arrangements;
create policy custody_select on public.custody_arrangements
  for select using (
    exists (
      select 1 from public.children c
       where c.id = child_id
         and public.caller_has_role(c.centre_id, array['owner', 'manager']::public.member_role[])
    )
  );

drop policy if exists custody_write on public.custody_arrangements;
create policy custody_write on public.custody_arrangements
  for insert with check (
    exists (
      select 1 from public.children c
       where c.id = child_id
         and public.caller_has_role(c.centre_id, array['owner', 'manager']::public.member_role[])
    )
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- Superseding is an UPDATE of superseded_at only; the column grant enforces that.
drop policy if exists custody_supersede on public.custody_arrangements;
create policy custody_supersede on public.custody_arrangements
  for update
  using (
    exists (
      select 1 from public.children c
       where c.id = child_id
         and public.caller_has_role(c.centre_id, array['owner', 'manager']::public.member_role[])
    )
  )
  with check (
    exists (
      select 1 from public.children c
       where c.id = child_id
         and public.caller_has_role(c.centre_id, array['owner', 'manager']::public.member_role[])
    )
  );

-- Enrolment, health, medication ---------------------------------------------
--
-- Same shape for all three: staff at the centre, or the child's own guardian.
-- Parents can read their child's allergies because they are the ones who told us.

drop policy if exists enrolments_select on public.enrolments;
create policy enrolments_select on public.enrolments
  for select using (public.caller_may_see_child(child_id));

drop policy if exists enrolments_write on public.enrolments;
create policy enrolments_write on public.enrolments
  for all
  using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  )
  with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
    -- The enrolment's centre must be the child's centre. Without this an owner of
    -- two sites could file an enrolment against the wrong one, and the funded
    -- hours would land in the wrong roll return.
    and exists (select 1 from public.children c where c.id = child_id and c.centre_id = enrolments.centre_id)
  );

drop policy if exists health_select on public.health_conditions;
create policy health_select on public.health_conditions
  for select using (public.caller_may_see_child(child_id));

-- Educators may record health information, unlike enrolment details. An allergy
-- disclosed at the door at 8am has to be writable by the person who was told.
drop policy if exists health_write on public.health_conditions;
create policy health_write on public.health_conditions
  for all
  using      (public.caller_is_staff_for_child(child_id))
  with check (public.caller_is_staff_for_child(child_id));

drop policy if exists medication_select on public.medication_authorities;
create policy medication_select on public.medication_authorities
  for select using (public.caller_may_see_child(child_id));

drop policy if exists medication_write on public.medication_authorities;
create policy medication_write on public.medication_authorities
  for all
  using      (public.caller_is_staff_for_child(child_id))
  with check (public.caller_is_staff_for_child(child_id));

-- Consent -------------------------------------------------------------------

drop policy if exists consent_select on public.consent_events;
create policy consent_select on public.consent_events
  for select using (public.caller_may_see_child(child_id));

-- Staff may record consent given by any guardian, because that is what happens
-- when a signed form arrives. A parent may record only their OWN consent — the
-- alternative is one parent granting photo permission on the other's behalf.
drop policy if exists consent_insert on public.consent_events;
create policy consent_insert on public.consent_events
  for insert with check (
    public.caller_may_see_child(child_id)
    and (
      public.caller_is_staff_for_child(child_id)
      or given_by in (select public.caller_guardian_ids())
    )
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- No UPDATE or DELETE policy, as with audit_events. Consent that can be edited
-- afterwards is not evidence of consent, and "we had permission at the time" is
-- the entire question.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Postgres checks these before it evaluates a single policy above. See the note
-- in 0001 — the whole of that migration was once unreachable for want of them.

revoke all on public.children               from anon, authenticated;
revoke all on public.guardians              from anon, authenticated;
revoke all on public.child_guardians        from anon, authenticated;
revoke all on public.custody_arrangements   from anon, authenticated;
revoke all on public.enrolments             from anon, authenticated;
revoke all on public.health_conditions      from anon, authenticated;
revoke all on public.medication_authorities from anon, authenticated;
revoke all on public.consent_events         from anon, authenticated;

grant select, insert, update, delete on public.children               to authenticated;
grant select, insert, update, delete on public.guardians              to authenticated;
grant select, insert, update, delete on public.child_guardians        to authenticated;
grant select, insert, update, delete on public.enrolments             to authenticated;
grant select, insert, update, delete on public.health_conditions      to authenticated;
grant select, insert, update, delete on public.medication_authorities to authenticated;

-- Custody: insert and read, plus superseding. No DELETE, and UPDATE is scoped to
-- the one column that closes a record, so the terms of an order cannot be quietly
-- rewritten after the fact.
grant select, insert           on public.custody_arrangements to authenticated;
grant update (superseded_at)   on public.custody_arrangements to authenticated;

-- Consent: append and read only, for everybody. Same reasoning as audit_events,
-- and the same two-layer enforcement — no policy AND no grant.
grant select, insert on public.consent_events to authenticated;
grant usage on sequence public.consent_events_id_seq to authenticated;

grant select on public.current_consents to authenticated;

-- service_role bypasses RLS but not grants. It gets the same restriction on
-- consent and custody: the onboarding credential has no business rewriting a
-- consent history either.
grant all on public.children               to service_role;
grant all on public.guardians              to service_role;
grant all on public.child_guardians        to service_role;
grant all on public.enrolments             to service_role;
grant all on public.health_conditions      to service_role;
grant all on public.medication_authorities to service_role;
grant select, insert on public.custody_arrangements to service_role;
grant update (superseded_at) on public.custody_arrangements to service_role;
grant select, insert on public.consent_events to service_role;
grant usage on sequence public.consent_events_id_seq to service_role;
grant select on public.current_consents to service_role;

revoke execute on function public.has_consent(uuid, public.consent_kind) from public, anon;
grant  execute on function public.has_consent(uuid, public.consent_kind) to authenticated, service_role;
