-- ---------------------------------------------------------------------------
-- 0038 — a person who works here
--
-- Phase 10 turns "three adults are present" into "these three adults are present",
-- and none of the rest of it is possible until the schema can name a person. This
-- migration does only that, because the identity question is the whole difficulty
-- and getting it wrong quietly is worse than shipping it late.
--
-- THREE OVERLAPPING NOTIONS OF A PERSON ALREADY EXIST
--
--   `auth.users`             an account. Supabase's, not ours.
--   `memberships`            an account plus a role at a centre. What the app
--                            authorises against.
--   `staff_records`          a NAME on a certificate, with an optional account —
--                            0011 made `person_name` required and `user_id`
--                            optional on purpose, because a reliever who covers
--                            two days a term has a police vetting result and no
--                            login.
--
-- None of them is "a person who works here". A membership cannot be one: a reliever
-- has no account, and an owner may hold a membership without ever being on the
-- floor. `staff_records` cannot be one either — it is one row per certificate, so a
-- person with first aid and a practising certificate is two rows, and a person with
-- neither does not exist at all.
--
-- So this is the fourth notion, and it is deliberately the thin one: a name, a
-- centre, and optionally an account. Everything Phase 10 adds — shifts, per-person
-- sign-in, the certificated-teacher count — hangs off it.
--
-- WHY THE BACKFILL IS NOT IN THIS FILE
--
-- `staff_records.staff_member_id` is added nullable and left null. The obvious next
-- step is a migration matching `person_name` to a new `staff_members` row, and it
-- must not be written: two relievers called Sarah become one person holding somebody
-- else's police vetting result, and the resulting record looks entirely normal. A
-- vetting result attached to the wrong person is the single worst row this schema
-- could contain.
--
-- Linking is therefore a human act through a screen, one record at a time, by
-- somebody who knows which Sarah. Until then a staff record works exactly as it did
-- — `person_name` still carries the name, and it is still `not null`, which is also
-- why `on delete set null` below loses nothing: the evidence outlives the person
-- record it was linked to.
-- ---------------------------------------------------------------------------

create table if not exists public.staff_members (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,

  full_name   text not null,

  /**
   * The account, if they have one.
   *
   * Nullable for the reason 0011 gives: relievers, contractors and the cook exist,
   * work here, appear on a roster, and never log in. A design that required an
   * account would push those people out of the roster and back onto paper — which
   * is exactly where the ratio evidence stops being derivable.
   */
  user_id     uuid references auth.users(id) on delete set null,

  /** "Head teacher, over-2s" — free text, because job titles here are not a taxonomy. */
  role_note   text,

  started_on  date,
  finished_on date,

  archived_at timestamptz,
  created_at  timestamptz not null default now(),

  constraint staff_members_name_present check (length(trim(full_name)) > 0),
  constraint staff_members_dates_ordered
    check (finished_on is null or started_on is null or finished_on >= started_on),
  /**
   * One person record per account per centre.
   *
   * Without it, two `staff_members` rows sharing a `user_id` make "who is signed in"
   * ambiguous the moment per-person attendance lands in 0039 — and the ambiguity
   * would surface as a ratio that is wrong by one, which is the number this whole
   * phase exists to make trustworthy.
   *
   * Several NULLs are fine and intended: Postgres does not collide them, which is
   * what lets a centre hold a dozen relievers with no accounts.
   */
  constraint staff_members_user_unique_per_centre unique (centre_id, user_id)
);

comment on table public.staff_members is
  'A person who works at a centre, with or without an app account. The person-of-record that shifts, per-person attendance and the certificated-teacher count all hang off.';

create index if not exists staff_members_centre_idx
  on public.staff_members (centre_id) where archived_at is null;
create index if not exists staff_members_user_idx
  on public.staff_members (user_id) where user_id is not null;

-- ---------------------------------------------------------------------------
-- The link from licensing evidence to the person
--
-- `on delete set null`, not cascade, and the difference matters: a police vetting
-- result is evidence about a named human being, and it must survive the tidying-up
-- of a person record. 0011 made `person_name` `not null` for exactly this — the name
-- on the certificate is the fact, and the link is a convenience laid over it.
-- ---------------------------------------------------------------------------

alter table public.staff_records
  add column if not exists staff_member_id uuid references public.staff_members(id) on delete set null;

comment on column public.staff_records.staff_member_id is
  'Optional link to the person. Left null by 0038 on purpose: matching on person_name would merge two relievers with the same first name, and a vetting result attached to the wrong person is the worst row this schema could hold. Linked by hand, one record at a time.';

create index if not exists staff_records_member_idx
  on public.staff_records (staff_member_id) where staff_member_id is not null;

-- ---------------------------------------------------------------------------
-- Policies
--
-- Read: any staff member of the centre. Everyone rostered needs to know who else
-- works here, and `memberships` is already readable on the same basis.
--
-- Write: owner and manager. Adding a person to the staff list is an administrative
-- act with consequences for the ratio, and `caller_has_role` is the predicate the
-- rest of the schema uses for that.
-- ---------------------------------------------------------------------------

alter table public.staff_members enable row level security;

drop policy if exists staff_members_select on public.staff_members;
create policy staff_members_select on public.staff_members
  for select using (centre_id in (select public.caller_staff_centre_ids()));

drop policy if exists staff_members_write_insert on public.staff_members;
create policy staff_members_write_insert on public.staff_members
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists staff_members_write_update on public.staff_members;
create policy staff_members_write_update on public.staff_members
  for update using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  ) with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

-- No DELETE policy and no DELETE grant. A person who worked here appears in ratio
-- history, on shifts, and against attendance events; removing the row would leave
-- those pointing at nothing and would rewrite what the binder can show. Departure is
-- `finished_on`, and tidying-up is `archived_at`.

revoke all on public.staff_members from anon, authenticated, service_role;
grant select, insert, update on public.staff_members to authenticated, service_role;

drop trigger if exists staff_members_audit on public.staff_members;
create trigger staff_members_audit
  after insert or update or delete on public.staff_members
  for each row execute function public.audit_trigger();
