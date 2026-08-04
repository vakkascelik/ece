-- 0002 — a members view that can show an email address
--
-- `auth.users` is not in Supabase's exposed schema, so an anon-key client cannot
-- join to it. That is a good default: the table holds every user in the project
-- across every tenant, and exposing it would let any authenticated caller
-- enumerate the lot.
--
-- But a roster screen has to show who somebody is, and a UUID is not an answer.
-- So this view exposes exactly one extra column — the email — and nothing else
-- from `auth.users`.

create or replace view public.centre_members
with (security_invoker = on) as
  select
    m.id,
    m.centre_id,
    m.user_id,
    m.role,
    m.created_at,
    m.revoked_at,
    u.email as member_email
  from public.memberships m
  join auth.users u on u.id = m.user_id;

-- `security_invoker = on` is the entire point of this migration.
--
-- A Postgres view runs as its owner by default, which for a view over
-- `memberships` would mean running as a superuser and returning EVERY
-- membership in the database to any caller — a complete bypass of the tenant
-- boundary, delivered by the convenience helper written to display a name.
--
-- With security_invoker the view executes as the calling user, so the RLS
-- policies on `memberships` apply exactly as they do to a direct query.
--
-- Requires Postgres 15+. Supabase is well past that, but if this view ever
-- needs to run somewhere older it must be replaced with a security-definer
-- function that filters on caller_centre_ids() explicitly, not left to default.

comment on view public.centre_members is
  'Memberships with the member email. security_invoker=on so RLS on memberships applies to the caller.';

grant select on public.centre_members to authenticated;
