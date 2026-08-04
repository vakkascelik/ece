-- 0002 — a members view that can show an email address
--
-- `auth.users` is not in Supabase's exposed schema, so an anon-key client cannot
-- join to it. That is a good default: the table holds every user in the project
-- across every tenant, and exposing it would let any authenticated caller
-- enumerate the lot.
--
-- But a roster screen has to show who somebody is, and a UUID is not an answer.
-- So this exposes exactly one extra column — the email — and nothing else from
-- `auth.users`.
--
-- WHY THIS TAKES TWO OBJECTS RATHER THAN ONE VIEW
--
-- The obvious version is a view with `security_invoker = on` joining straight to
-- `auth.users`. It fails, and the first run of the RLS suite is what caught it:
--
--   ERROR 42501: permission denied for table users
--   HINT: GRANT SELECT ON auth.users TO authenticated;
--
-- Take that hint and every authenticated caller in the project can read every
-- email in it — every other centre's staff and parents. The hint is the fix for
-- the error and a hole in the product.
--
-- The two requirements genuinely conflict:
--
--   * Rows must be filtered as the CALLER, so RLS on `memberships` is what keeps
--     centres apart (security_invoker = on).
--   * The email lookup must run as the OWNER, because the caller has no
--     privilege on `auth.users` and must not be given one.
--
-- So the view keeps `security_invoker = on` and the single privileged read is
-- pushed into a function narrow enough to audit in one screen, which re-checks
-- the caller's membership itself rather than trusting its call site.

/**
 * Email for one user, and only if the caller shares a centre with them.
 *
 * security definer because reading auth.users requires privilege the caller does
 * not have and should never be granted. The guard is therefore not optional: it
 * is the only thing standing between this function and a full email dump, and it
 * is written here rather than at the call site because PostgREST exposes every
 * public function over RPC — this is callable directly, not just via the view.
 */
create or replace function public.member_email(p_user_id uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select u.email::text
    from auth.users u
   where u.id = p_user_id
     and exists (
       -- Shares at least one live centre with the caller. Deliberately does not
       -- exclude a revoked target: revoking keeps the row so the roster can
       -- still show who was removed, and a name is the point of that record.
       select 1
         from public.memberships theirs
        where theirs.user_id = p_user_id
          and theirs.centre_id in (select public.caller_centre_ids())
     );
$$;

comment on function public.member_email(uuid) is
  'Email of a user the caller shares a centre with. security definer: the membership check inside IS the access control.';

-- Not callable unauthenticated. Returning null would be harmless today, but the
-- surface should not exist at all.
revoke execute on function public.member_email(uuid) from public, anon;
grant  execute on function public.member_email(uuid) to authenticated, service_role;

create or replace view public.centre_members
with (security_invoker = on) as
  select
    m.id,
    m.centre_id,
    m.user_id,
    m.role,
    m.created_at,
    m.revoked_at,
    public.member_email(m.user_id) as member_email
  from public.memberships m;

-- `security_invoker = on` is the entire point of this view.
--
-- A Postgres view runs as its owner by default, which for a view over
-- `memberships` would mean running as a superuser and returning EVERY
-- membership in the database to any caller — a complete bypass of the tenant
-- boundary, delivered by the convenience helper written to display a name.
--
-- With security_invoker the view executes as the calling user, so the RLS
-- policies on `memberships` apply exactly as they do to a direct query. Note
-- what this means for the alternative: a view WITHOUT security_invoker that
-- filtered on caller_centre_ids() in its own WHERE clause would also work, and
-- is worse — the tenant boundary would then live in a WHERE clause somebody can
-- delete while "simplifying a query", instead of in a policy.
--
-- Requires Postgres 15+. Supabase is well past that.

comment on view public.centre_members is
  'Memberships with the member email. security_invoker=on so RLS on memberships applies to the caller; the email comes from member_email(), which guards itself.';

grant select on public.centre_members to authenticated;
