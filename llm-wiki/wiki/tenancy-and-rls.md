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
- **A new ROLE is a change to every policy that does not name roles.** `caller_centre_ids()`
  trusts a membership row without asking in what capacity, so four policies had to be narrowed
  in 0043 before `kiosk` could safely exist. Allowlist the roles; never denylist one.
- **Column-level grants do work a policy cannot** — a policy restricts rows, only a grant
  restricts columns.
- The isolation suite is the highest-value test in the repo: **321 assertions as at
  2026-08-08**, and it found three real bugs the first time it was ever executed.

## Details

### The predicates

All `SECURITY DEFINER`, because they read tables that are themselves under RLS and would
otherwise recurse.

| Function | Answers |
|---|---|
| `caller_centre_ids()` | centres the caller belongs to, **any role** — read the warning below |
| `caller_person_centre_ids()` | centres where the caller is a *person*: owner/manager/educator/parent |
| `caller_staff_centre_ids()` | centres where the caller is owner/manager/educator |
| `caller_ward_ids()` | children the caller is a guardian of |
| `caller_guardian_ids()` | the caller's own guardian records |
| `caller_is_staff_for_child(uuid)` | staff at the centre this child belongs to |
| `caller_may_see_child(uuid)` | staff for the child, **or** their guardian |

The live-membership join in the last four is the part that reads as obviously handled and
is not: guardianship is recorded on the guardian row and would outlive the access without
it. Asserted directly in the suite.

#### `caller_centre_ids()` trusts a membership row, not a person

It asks *which centres does this caller belong to* and never asks in what capacity, so every
policy reading it inherits whatever roles exist **at the time somebody reads it**, including
ones added later. That is a latent hazard rather than a bug, and 0042 was the change that
made it bite: adding a `kiosk` role to `member_role` would, on its own, have handed a door
tablet published pānui, the photographs attached to them, the membership list, and the
ability to open a message thread as the centre.

Six policies read it. Four were narrowed to `caller_person_centre_ids()` in 0043 — `posts_
select`, `media_select`, `memberships_select`, `message_threads_insert`. Two were kept and the
keeping is written down in the migration: `centres_select`, because a kiosk has to render the
centre's name, and `audit_insert`, because a device that acts and leaves no trace is worse
than one that reads a name.

**An allowlist, not `role <> 'kiosk'`.** A denylist is wrong the next time a role is added and
wrong *silently* — the new role inherits everything and nothing fails. `caller_staff_centre_
ids()` needed no change at all in 0043 precisely because it already names its three roles, so
it was safe against a role that did not exist when it was written. That property is the one
worth copying.

Prefer `caller_person_centre_ids()` in anything new. Reach for `caller_centre_ids()` only when
a device genuinely should be included, and say why in the migration.

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

### An audit trigger that fires and writes nothing, on three tables, reported as covered

Found by an audit on 2026-08-12, fixed in `0059_audit_attributable.sql`.

`audit_trigger()` resolves the tenant from `centre_id`, then `child_id`, then `invoice_id`, then
`guardian_id`, then the `centres` table itself, and otherwise gives up quietly:

```sql
if v_centre is null then
  return coalesce(new, old);
end if;
```

`shifts` and `staff_leave` (0041) hang off `staff_member_id`. `post_strands` (0058) hangs off
`post_id`. None of the three carries any resolvable key, so the trigger fired on every write and
inserted nothing. `select count(*) from audit_events where entity = 'shifts'` was 0 from the day
0041 shipped.

**Both guards passed, and that is the part worth keeping.** The class assertion in this suite looked
for a `pg_trigger` row named `<table>_audit`; check 11 of `review:security` did the same. "Has a
trigger" and "is audited" are different claims, and for three tables they disagreed for months —
while check 11 printed *"no consequential table can be changed without a record of who changed which
column, and when"*.

The roster is not bookkeeping: `shifts` and `staff_leave` feed the ratio forecast, and UPDATE is
granted on both. 0041's own comment argues that a roster somebody can erase "cannot show that
Tuesday was short before anybody noticed". It could not show it either way.

**The near-miss is instructive.** 0044 added the `guardian_id` branch for `guardian_pins`, described
this exact failure mode in its header, and said the fix was verified complete "by inspection of the
catalogue". That inspection asked *which tables carry `guardian_id`*. The question that finds these
three is the inverse — *which audited tables carry none of the keys* — and nothing was asking it.

So 0059 adds two joins and, more usefully, an assertion that every audited table has an attributable
column. It runs at migration time and again in this suite. Nothing is backfilled: the rows were
never written and inventing plausible actors would be worse than the gap.

### Mutation testing

Phase 1's suite passed 63/63 first run, which was not trusted. The child policy was
weakened to centre-only and the suite failed on "a parent sees exactly one child", then
restored. A test that cannot fail is not a test — worth repeating for any new policy.

## See Also

- [[conventions]] — the migration and grant convention for new tables
- [[compliance-and-evidence]] — where an educator's own record is readable by them
- [[unverified-claims]]

*Last updated: 2026-08-12*
