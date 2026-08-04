-- 0001 — tenancy foundation
--
-- WHY POOLED, NOT SILO
--
-- shop-platform and charity-platform both use a silo model: one deployment and
-- one database schema per customer. That works because each customer wants
-- their own website at their own domain.
--
-- It cannot work here, because this product ships a mobile app. You cannot
-- publish one App Store binary per childcare centre. One app must serve every
-- centre, which means the tenant is resolved at login and isolation has to be
-- enforced somewhere the client cannot reach — the database.
--
-- So: every tenant-scoped table carries `centre_id`, and Row Level Security is
-- the boundary. The application never filters by tenant; Postgres does. An
-- application-layer filter is one forgotten `.eq('centre_id', …)` away from
-- showing one centre another centre's children, and that is not a bug anyone
-- gets to make twice in early childhood education.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenants
-- ---------------------------------------------------------------------------

create table if not exists public.centres (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  -- Ministry of Education service number. The real-world identity of a licensed
  -- service and the natural key for anything that has to reconcile with the
  -- Ministry later. Nullable because a centre may be onboarded before it is
  -- confirmed, unique because two centres must never share one.
  moe_service_number  text        unique,
  slug                text        not null unique,
  timezone            text        not null default 'Pacific/Auckland',
  created_at          timestamptz not null default now(),
  archived_at         timestamptz
);

comment on table public.centres is
  'Tenants. One row per licensed early learning service.';

-- ---------------------------------------------------------------------------
-- Who may see which tenant
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.member_role as enum ('owner', 'manager', 'educator', 'parent');
exception when duplicate_object then null; end $$;

-- A person can belong to more than one centre: a manager of a two-site operator
-- (Little Pearls runs Mt Albert and Mt Roskill), or a parent with children at
-- two services. So this is a join table, not a column on the user.
create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.member_role not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  unique (centre_id, user_id)
);

create index if not exists memberships_user_idx   on public.memberships (user_id) where revoked_at is null;
create index if not exists memberships_centre_idx on public.memberships (centre_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- The isolation primitives
-- ---------------------------------------------------------------------------

-- Which centres may the caller see? Used by every policy below.
--
-- SECURITY DEFINER because the function reads `memberships`, and `memberships`
-- itself is under RLS — without it the policy would recurse. STABLE so the
-- planner can hoist it out of per-row evaluation.
create or replace function public.caller_centre_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select centre_id
    from public.memberships
   where user_id = auth.uid()
     and revoked_at is null
$$;

create or replace function public.caller_has_role(target_centre uuid, allowed public.member_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.memberships m
     where m.user_id = auth.uid()
       and m.centre_id = target_centre
       and m.revoked_at is null
       and m.role = any(allowed)
  )
$$;

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.centres     enable row level security;
alter table public.memberships enable row level security;

-- Deliberately no INSERT/UPDATE/DELETE policy on `centres` for normal users.
-- Creating a tenant is an onboarding action performed with the service role;
-- letting an authenticated client create tenants is how you get a tenant table
-- full of junk and a support burden nobody budgeted for.
drop policy if exists centres_select on public.centres;
create policy centres_select on public.centres
  for select using (id in (select public.caller_centre_ids()));

drop policy if exists centres_update on public.centres;
create policy centres_update on public.centres
  for update using (public.caller_has_role(id, array['owner', 'manager']::public.member_role[]));

-- A member sees the roster of centres they belong to. A parent sees it too:
-- knowing who the educators are is not sensitive, and hiding it breaks the
-- app's own "who posted this" displays.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select using (centre_id in (select public.caller_centre_ids()));

-- Only owners and managers change who has access, and only within their centre.
-- The WITH CHECK matters as much as the USING: without it a manager could move
-- a membership row to a centre they do not administer.
--
-- UPDATE only, not FOR ALL. Creating a membership requires creating or looking up
-- an auth user, which needs the service role, so it is an onboarding flow rather
-- than something an authenticated client does — and removal is a revocation,
-- which is an UPDATE. A FOR ALL policy here would advertise an INSERT path that
-- the grants below deliberately do not open.
drop policy if exists memberships_write  on public.memberships;
drop policy if exists memberships_update on public.memberships;
create policy memberships_update on public.memberships
  for update
  using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- RLS is not the first check, it is the second. Postgres tests the table
-- privilege first and only then applies policies, so a table with perfect
-- policies and no GRANT returns "permission denied for table x" to every real
-- caller — and a table with a GRANT and no policy returns everything.
--
-- These were originally left implicit, relying on the ALTER DEFAULT PRIVILEGES a
-- stock Supabase project ships with. That is a bad dependency for the tables that
-- ARE the tenant boundary: it is ambient, it is invisible in this file, and it
-- disappears the moment the schema is recreated. Which is how it was found —
-- `drop schema public cascade` took the default ACLs with it and every policy in
-- this file became unreachable.
--
-- So they are explicit, and column-scoped where the column list is meaningfully
-- shorter than the table.

-- Schema-level reach. A stock Supabase project already has this, so it is here
-- for self-containment rather than because it is missing: these migrations should
-- produce a working database from `create schema public` alone, with nothing
-- inherited from how the project happened to be set up.
grant usage on schema public to anon, authenticated, service_role;

-- anon is the pre-login identity. It has no business with any of this.
revoke all on public.centres     from anon;
revoke all on public.memberships from anon;

grant select on public.centres to authenticated;
-- Not `grant update` wholesale: `slug` appears in URLs and `archived_at`
-- decommissions a centre. Both are operator actions, and neither belongs to a
-- form an owner can reach. The centres_update policy restricts which ROWS; this
-- restricts which COLUMNS, which a policy cannot express.
grant update (name, moe_service_number, timezone) on public.centres to authenticated;

grant select on public.memberships to authenticated;
-- Role changes and revocations, nothing else. Withholding UPDATE on centre_id
-- and user_id makes "move this membership to another centre" impossible to
-- express rather than merely refused — the WITH CHECK above would catch it; this
-- means the attempt never reaches the policy.
grant update (role, revoked_at) on public.memberships to authenticated;

-- service_role is the onboarding and scheduled-job identity. It bypasses RLS, so
-- it is not constrained by any policy above — but bypassing RLS is not the same as
-- holding a grant, and it needs these stated too. Creating a centre and attaching
-- its first owner is the one operation the product cannot perform on itself, and
-- without these lines `scripts/onboard.ts` fails with "permission denied for
-- table centres", which reads like a bug in the script.
grant all on public.centres     to service_role;
grant all on public.memberships to service_role;

-- ---------------------------------------------------------------------------
-- Convention for every future tenant-scoped table
-- ---------------------------------------------------------------------------
--
--   create table public.<thing> (
--     id        uuid primary key default gen_random_uuid(),
--     centre_id uuid not null references public.centres(id) on delete cascade,
--     ...
--   );
--   create index <thing>_centre_idx on public.<thing> (centre_id);
--   alter table public.<thing> enable row level security;
--   create policy <thing>_rw on public.<thing>
--     for all using (centre_id in (select public.caller_centre_ids()))
--             with check (centre_id in (select public.caller_centre_ids()));
--   revoke all on public.<thing> from anon;
--   grant select, insert, update, delete on public.<thing> to authenticated;
--
-- Both halves of the policy are required. USING controls which rows are visible;
-- WITH CHECK controls which rows may be written. A policy with only USING lets a
-- caller insert a row belonging to a centre they cannot read — silent
-- cross-tenant write, invisible in testing because the row promptly disappears
-- from view.
--
-- The GRANT line is not boilerplate to skip, and it is not boilerplate to paste
-- unread either. Without it the table is unreadable by every real caller; wider
-- than the policies contemplate and it is writable in ways nothing checks. Grant
-- only the verbs the product performs, and add an assertion to
-- `supabase/tests/rls_isolation.sql` in the same commit.
