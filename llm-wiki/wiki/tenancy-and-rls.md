# Tenancy and RLS

Two access boundaries, both in Postgres: centre against centre, and guardianship inside a
single centre.

## Overview

`shop-platform` and `charity-platform` are silo multi-tenant — one deployment and one schema
per customer. That cannot work here, because this ships a mobile app: you cannot publish one
App Store binary per childcare centre. One app serves every centre, the tenant is resolved
at sign-in, and isolation has to live somewhere the client cannot reach.

So the boundary is Row Level Security, and `packages/api` contains **no tenant filtering at
all**. That absence is deliberate and load-bearing: a filter in the app is one forgotten
`.eq('centre_id', …)` away from showing one centre another centre's children, and writing
it anyway would imply the filter is what keeps centres apart.

The second boundary was introduced in Phase 1 and is the more dangerous of the two, because
`parent` is a role *inside* the tenant. A parent at Little Pearls Mt Albert is a legitimate
member of that centre; they must see their own child's allergies and must never see the
child sitting next to them.

## Key Points

- **Postgres is the boundary. RLS is the second check, not the first.** Postgres tests the
  table privilege *before* it evaluates any policy, so a table with perfect policies and no
  `GRANT` is unreachable, and a table with a `GRANT` and no policy returns everything.
- **A policy keyed on `centre_id` alone passes every pre-Phase-1 test and leaks medical
  records between families.** Guardianship needs its own predicates.
- **Every access predicate joins to a live membership**, so revoking a parent closes their
  own child's record immediately.
- **Column-level grants do work a policy cannot** — a policy restricts rows, only a grant
  restricts columns.
- The isolation suite is the highest-value test in the repo: **119 assertions as at
  2026-08-04**, and it found three real bugs the first time it was ever executed.

## Details

### The predicates

All `SECURITY DEFINER`, because they read tables that are themselves under RLS and would
otherwise recurse.

| Function | Answers |
|---|---|
| `caller_centre_ids()` | centres the caller belongs to, any role |
| `caller_staff_centre_ids()` | centres where the caller is owner/manager/educator |
| `caller_ward_ids()` | children the caller is a guardian of |
| `caller_guardian_ids()` | the caller's own guardian records |
| `caller_is_staff_for_child(uuid)` | staff at the centre this child belongs to |
| `caller_may_see_child(uuid)` | staff for the child, **or** their guardian |

The live-membership join in the last four is the part that reads as obviously handled and
is not: guardianship is recorded on the guardian row and would outlive the access without
it. Asserted directly in the suite.

### Rejected: filtering in the query layer

Considered and refused. See the Overview. The one concession is that read functions take a
`centreId` argument to *narrow* a query — that is a performance and correctness aid for the
caller, not a security boundary, and the policies would refuse regardless.

### Rejected: `GRANT SELECT ON auth.users TO authenticated`

Supabase suggests this when a `security_invoker` view joins `auth.users`. It fixes the error
by publishing every email in the project to every signed-in user. The real fix was
`member_email(uuid)` — a `SECURITY DEFINER` function narrow enough to audit in one screen,
which re-checks the caller's membership itself because PostgREST exposes every public
function over RPC.

### Rejected: putting custody notes on the whānau record

A custody arrangement is a record *about* the guardians, so it must not be readable *by*
them — including the guardian it concerns. A policy cannot restrict some columns of a row to
one role, and a column grant cannot vary by role. `custody_arrangements` is therefore its
own table with an owner/manager-only policy. Educators cannot read it either; what they need
is on the collection list.

### Rejected: showing a parent their co-guardians

A parent sees only their **own** guardian record. In a domain where separated parents and
protection orders are ordinary, an app that hands one parent the other's current address on
request is a safety problem, not a convenience.

### The three bugs the suite found on first execution

1. `centre_members` was unreadable by any authenticated caller — `security_invoker = on`
   made the `auth.users` join run as the caller.
2. `centres`, `memberships` and `audit_events` had policies but no grants. The whole of
   `0001` was unreachable. It had been relying on the `ALTER DEFAULT PRIVILEGES` a stock
   Supabase project ships with — ambient, invisible in the migration, and gone the moment
   the schema is recreated.
3. Same again for `service_role`, which bypasses RLS but not grants.

All three were invisible to `typecheck`, to `next build`, and to reading the migrations.

### Mutation testing

Phase 1's suite passed 63/63 first run, which was not trusted. The child policy was
weakened to centre-only and the suite failed on "a parent sees exactly one child", then
restored. A test that cannot fail is not a test — worth repeating for any new policy.

## See Also

- [[conventions]] — the migration and grant convention for new tables
- [[compliance-and-evidence]] — where an educator's own record is readable by them
- [[unverified-claims]]

*Last updated: 2026-08-04*
