# Staff as people

Phase 10 turns *"three adults are present"* into *"these three adults are present"*, and none of
it is possible until the schema can name a person.

## Overview

The binder currently admits that adult counts are "figures entered by staff, not derived from
individual staff sign-in" ([[compliance-and-evidence]]). That admission is honest and it is also
the gap. Closing it is the largest change in the roadmap, because it changes what a ratio *is*.

0038 does only the identity part. The rest — per-person attendance, shifts, the derived ratio —
waits on it, and shipping the identity question late is better than shipping it wrong quietly.

## Key Points

- **Three notions of a person already existed and none of them fit.** `staff_members` is a
  fourth, deliberately thin one.
- **`user_id` is nullable**, because relievers, contractors and the cook work here and never log
  in.
- **The backfill is a screen, not a migration.** Matching on `person_name` would merge two
  relievers called Sarah.
- **One account cannot have two person records.** That ambiguity would surface as a ratio wrong
  by one.
- **Nobody can delete a staff member.** Departure is `finished_on`.

## Details

### Why none of the three existing notions fit

| | |
|---|---|
| `auth.users` | An account. Supabase's, not ours |
| `memberships` | An account plus a role. What the app authorises against — but a reliever has no account, and an owner may hold a membership and never be on the floor |
| `staff_records` | A **name on a certificate**. One row per certificate, so a person with first aid and a practising certificate is two rows, and a person with neither does not exist at all |

0011 already made `person_name` required and `user_id` optional on `staff_records`, for the
reason recorded there: *a centre holds a vetting result for somebody who covers two days a term
and has no app account.* That decision is the one this table generalises.

### The backfill that must not be written

`staff_records.staff_member_id` is added nullable and left null. The obvious next migration
matches `person_name` to a new row, and it is the one thing in this phase that could do real
harm: **two relievers called Sarah become one person holding somebody else's police vetting
result**, and the resulting record looks entirely normal.

So linking is a human act through a screen, one record at a time, by somebody who knows which
Sarah. Nothing breaks in the meantime — `person_name` still carries the name and is still
`not null`, which is also why the foreign key is `on delete set null`: the evidence outlives the
person record it was linked to.

### The unique constraint that is really about the ratio

`unique (centre_id, user_id)`. Two `staff_members` rows sharing an account make "who is signed
in" ambiguous the moment per-person attendance lands, and the ambiguity surfaces as a ratio that
is **wrong by one** — the exact number this phase exists to make trustworthy.

Several NULLs are fine and intended. Postgres does not collide them, which is what lets a centre
hold a dozen relievers with no accounts, and the suite asserts that rather than assuming it.

### Read by everyone rostered, written by the office

Select is any staff member of the centre: everyone rostered needs to know who else works here,
and `memberships` is already readable on the same basis. Insert and update are owner/manager via
`caller_has_role`, because adding a person to the staff list has consequences for the ratio.

Mutation-tested: widening the insert policy to any staff failed the suite on *and CANNOT add to
it*. The educator update assertion checks the **value did not change** rather than that an error
was raised — a USING mismatch filters silently rather than raising, so an exception-only
assertion would pass against a policy that had been removed entirely.

### No DELETE, for a reason that only bites later

A person who worked here appears in ratio history, on shifts, and against attendance events.
Removing the row leaves those pointing at nothing and rewrites what the binder can show.
Departure is `finished_on`; tidying up is `archived_at`.

### Per-person attendance (0039), and why it is a second table

`staff_attendance_events` and `attendance_events` look identical — in, out, a time, a client key
— and merging them is the obvious tidy-up. Two reasons not to, and the first is enough:

1. **The RLS does not compose.** A guardian may sign their *own child* in, so
   `attendance_events` is readable and writable by parents through `caller_may_see_child`. No
   guardian may see staff hours. One table means one set of policies, and the merged predicate
   would be an OR of two unrelated boundaries — which is how a parent ends up able to read when
   the manager arrived.
2. **One of them underpins a funding claim on the Crown**; the other is a payroll and compliance
   record. Sharing a table invites a future query that sums the wrong rows into a claim.

So it is a near-copy, deliberately. The duplication is the cheaper mistake, and the suite
asserts the absence directly — *a parent reads NO staff attendance*. Mutation-tested with
`using (true)`, which failed on exactly that line.

**It keys on `staff_member_id`, not on a user.** A table keyed on `auth.users` could not sign in
the person who covers Tuesdays — precisely the adult whose presence the ratio most needs to
count. `recorded_by` is the account that tapped; the two are routinely different people, and any
staff member may record for a colleague because a manager signs in the reliever and a door
tablet signs in the team arriving together.

`caller_is_staff_for_member` is a `SECURITY DEFINER` function rather than an inline
`exists (select … from staff_members …)`, and that is the direct application of the lesson in
[[conventions]]: a policy expression that reads another table inherits that table's RLS. Inline,
it would be silently narrowed by `staff_members_select` — which happens to give the right answer
today and would stop doing so the moment that policy changed, in a direction nobody would
notice.

### Two sources for one number (0040), and the rule that they never blend

Three rules, in order of how badly breaking them would end.

**Never blend.** Not an average, not a maximum, not *derived if any staff have signed in,
otherwise declared*. A blended figure is unattributable: nobody reading a binder could say where
the number came from, and the binder's whole value is that its provenance is stateable.

**Never fall back.** A derived centre where nobody signed in reports **zero adults** — a visible,
alarming, correct statement that nobody recorded their presence. Falling back to the typed count
would paper over exactly the failure that switching to derived was meant to expose. The suite
asserts it and the comment beside it says so, because it looks like a bug and the next person
will want to fix it.

**Default to `declared`.** Every existing centre keeps the meaning its history already has. A
default of `derived` would silently reinterpret every ratio snapshot ever recorded, which is the
one thing a compliance record must never do on a deploy.

#### The compiler is the enforcement

`replayDay` **requires** `adultSource`. A default would let a centre switch and keep printing
binders that say "figures entered by staff" over numbers nobody typed. That cost fourteen test
call sites and walked the change to three production ones that would otherwise have been missed
— `readDayRatio`, `/compliance` and `/compliance/binder`. The type error is what found them.

**The binder's disclaimer had to stop being a constant.** It states which source the numbers came
from, and if any day in the period used a *different* source from the one in force, it says that
too — a binder spanning a switch would otherwise assert a provenance it does not have.

`readDayRatio` does not fetch staff attendance at all for a declared centre. Not an optimisation:
fetching data it must then ignore invites "use it if it happens to be there", which is the
blending 0040 forbids. Not fetching makes the rule structural.

#### The correction that bites in two languages

A staff correction can carry an **earlier** timestamp than the row it fixes — signed in at 8:05,
corrected to 7:50. Sorting by time without resolving corrections first replays the wrong state and
reports one adult too few.

Handled in `adults_present_now` (SQL, about now) and `deriveAdultCounts` (TypeScript, replaying a
past day), **deliberately duplicated rather than shared**: one answers in Postgres and the other in
the browser, and a shared implementation would have to live in one of the two places the other
cannot reach. Both are transitive, and both are asserted.

#### The setting

`/settings` carries it, worded as the one control on that page that changes what an existing
record *means* — everything else there adds a rule going forward. An invalid value is refused
rather than coerced to `declared`, because a silent fallback on a typo is a quiet version of the
blending the whole migration forbids.

## Still to come in this phase `centres.ratio_source` defaults to `declared`
  so no existing centre's history changes meaning on deploy, and `replayDay` must record which
  source produced each snapshot — otherwise every binder printed after a switch is ambiguous
  about every day before it.
- **Shifts and leave**, and the forward ratio forecast that needs them.
- **The certificated-teacher count**, stated as a fact and never as a funding consequence — see
  [[unverified-claims]].

## See Also

- [[compliance-and-evidence]] — the admission this phase closes, and `staff_records`
- [[attendance-and-ratios]] — what a ratio is derived from today
- [[tenancy-and-rls]] — `caller_has_role` and the predicates used here
