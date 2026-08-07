# Incident register

One table with two audiences, where the boundary runs *inside* a centre — and the draft that a
family must not see.

## Overview

Phase 8's first table. An injury, an illness sending a child home, a near miss with the gate:
the most-used form in a centre, the first thing a reviewer asks for, and absent from this
product for eight phases. It lived on paper, which is also where the evidence that a parent had
been told about it lived.

The machinery is small. The difficulty is entirely in who may read what, and when.

## Key Points

- **A guardian cannot read a draft.** `caller_may_see_child` is true for staff *and* guardians,
  which makes it the wrong predicate here and the easy mistake.
- **Final freezes.** An amendment is a new row carrying `supersedes`, not an edit.
- **The acknowledgement is the one fact in the table the centre does not author**, so staff
  cannot record it and a guardian cannot record it as somebody else.
- **The transition trigger decides by what changed, not by who called** — because an educator
  whose own child attends is both.
- **Nobody can DELETE, including `service_role`.** A centre that can make a report disappear
  cannot use the register to prove anything.
- Four tables were rejected in favour of four tables. See below — the generic one was the
  obvious design and it breaks the audit log.

## Details

### Why not one `child_register_events` table with a `jsonb` payload

Incidents, medication administration and sleep checks are the same shape: a child, a time, a
person, a note. One table with a `kind` enum and a `jsonb detail` is the obvious design and it
is wrong *here* for a reason specific to this schema.

`audit_events.detail` holds **column names and never values**. That is the only thing that lets
a child's record be purged while the evidence it existed survives, and the suite asserts it — no
name and no medical detail reaches the audit trail. A `jsonb` payload defeats it in both
directions: the audit row would either name one column, `detail`, and record nothing useful, or
it would carry the text of a child's injury into the table that deliberately outlives the
child's record.

Two lesser reasons that would not have been decisive alone: per-kind `CHECK` constraints are
unwritable against `jsonb` (a medication row needs a dose, a sleep check needs a position), and
the RLS differs — a guardian reads their own child's incident report, which is not true of a
sleep check, and policies are per table.

### The draft, which is the assertion this table exists to get right

A draft is working material. A teacher types "Ana fell — checking whether it's broken" and then
finds out it is a graze. Streaming that to a parent's phone as it is typed is worse than
telling them nothing for ten minutes, and it is what using `caller_may_see_child` on this table
would have done.

```sql
for select using (
  public.caller_is_staff_for_child(child_id)
  or (status = 'final' and child_id in (select public.caller_ward_ids()))
)
```

Mutation-tested rather than trusted: the policy was replaced with
`caller_may_see_child(child_id)` against the live database, the suite failed on *a parent
CANNOT READ a draft incident about their own child*, and the correct policy was restored and the
catalogue re-read to confirm it matched the migration character for character.

Guardianship, not tenancy: another family at the same centre cannot read the report even once
final. That assertion is the one that would pass if the policy keyed on `centre_id`.

### The trigger decides by what changed, not by who called

RLS decides *who* may update a row. It cannot say "and only these two columns" — and this table
has two audiences with completely different rights over it, while a column-level `GRANT` is per
role rather than per policy. So the grant opens every column either audience might touch, and
`enforce_incident_transition` works out which audience the caller was.

The obvious implementation branches on `caller_is_staff_for_child`. It is wrong for a real and
not-rare person: **an educator whose own child attends the same centre**. They are staff by that
predicate, so the guardian branch would never run for them and they could never acknowledge a
report about their own child. Keying on the changed columns instead means the same statement is
judged the same way whoever sends it.

So: if the only columns that moved are `acknowledged_at` and `acknowledged_by`, this is an
acknowledgement — the row must already be final, unacknowledged, and the guardian named must be
the caller's own and a guardian of that child. Anything else is a staff edit — the caller must be
staff for the child, the row must still be a draft, and they may not touch the acknowledgement.

### What the column grant does before any of that runs

`id`, `centre_id`, `child_id`, `reported_by` and `created_at` are absent from the `UPDATE`
grant, so moving a report to a different child is refused by Postgres before a policy or trigger
is consulted — the cheapest possible place to refuse it. The trigger compares those columns
anyway, because a privilege can be widened by a later migration and the trigger is what would
notice.

### Rejected: correction-as-a-new-row

`attendance_events` corrects a scalar by appending; a sign-in time is one value and the later
row simply supersedes it. An incident report is a paragraph written in a hurry, and the
attendance idiom does not carry. `custody_arrangements` already had the right shape —
supersession — so this follows it. Editing a report after a family has been shown it is not a
correction, it is a different document wearing the same name, which is the argument
[0021](../../supabase/migrations/0021_integrity.sql) makes about an issued invoice.

### The grant that was missing, and the check that caught it

0030 applied cleanly, the suite went 219/219, and `review:security` immediately dropped to
15/16: `enforce_incident_transition` is `SECURITY DEFINER` and, like every function, was created
with `EXECUTE` granted to `PUBLIC` — a function running as the table owner, reachable by `anon`.

Low severity in its current form, since called directly it gets no trigger context and fails at
once. Fixed in 0031 anyway, because "harmless in its current form" is the argument that stops
being true after the next edit. **A trigger function does not need `EXECUTE` granted to the
caller at all** — PostgreSQL checks `TRIGGER` on the table, not `EXECUTE` on the function — so
revoking it from `PUBLIC` costs nothing, which the suite confirmed by still passing 219/219.

The interesting part is how it was found. 0030 was read twice before being applied and this was
in neither reading, because **the grant is not written anywhere in the file**. It is what
`create function` does when you say nothing. A check against the live schema sees what the file
does not say; a code review cannot.

### The screen, and the two-step it refuses to collapse

`/incidents` is staff-only, behind `recordDailyPractice` so educators can file — they are the
people who witness these. That is a nav decision, not the boundary; 0030's policy is.

Two things on it are deliberate and would both be "improved" away by somebody optimising the
flow:

- **There is no "save and send".** The submit button says *Save as draft* and has no sibling.
  Final is the version a family reads and nobody can edit afterwards, and a one-press path to it
  gets pressed by somebody standing up holding a crying child.
- **The draft state says so on screen** — *Draft — whānau cannot see this*. A teacher who
  believes they have told the family and has left the report in draft is the exact failure this
  column exists to surface, and no policy will tell them.

The summary counts what is **outstanding**, not how many incidents occurred, so a centre with
forty resolved reports reads the same as one with none. Same argument as `summarise().clean` in
the compliance code.

Every time is formatted on the server in the centre's zone. `toLocaleString` in the browser uses
the *device's* zone, and an incident time that shifts depending on who opens the page is worse
than useless in a review.

### The guard caught the new page, which is the point of having it

`/incidents` needed "fourteen days before today" and wrote the arithmetic out inline —
`Date.UTC(y, m - 1, d - n).toISOString().slice(0, 10)`. Legitimate, and identical to what
`lastSevenDays` in `dayWindow.ts` already did.

`localDates.test.ts` failed on it, because the allowlist is keyed by file and the new page was
not in it. **The fix was not a second allowlist entry.** It was `shiftLocalDate` in
`dayWindow.ts`, which both callers now use: one exemption with one argument beats two of each,
and the duplication the guard exposed was a real one. A guard that only ever gets appeased is a
guard being ignored slowly.

## See Also

- [[tenancy-and-rls]] — the two boundaries, and why the one inside a centre is the hard one
- [[privacy-and-retention]] — why `on delete cascade` on `child_id` is load-bearing
- [[compliance-and-evidence]] — where this register will feed the binder
- [[conventions]] — the new-table checklist this followed
