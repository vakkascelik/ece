# Staff as people

Phase 10 turns *"three adults are present"* into *"these three adults are present"*, and none of
it is possible until the schema can name a person.

## Overview

The binder currently admits that adult counts are "figures entered by staff, not derived from
individual staff sign-in" ([[compliance-and-evidence]]). That admission is honest and it is also
the gap. Closing it is the largest change in the roadmap, because it changes what a ratio *is*.

0038 does only the identity part, and shipping the identity question late was better than shipping
it wrong quietly. Everything after it hangs off that one table: per-person attendance (0039), the
derived ratio (0040), and the planned roster (0041).

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
- **One person cannot hold two overlapping shifts**, because a double-booked person is counted
  twice in a forecast and the roster then reads adequately staffed when it is not.
- **Leave is availability, not payroll.** No rates, no balances, no accrual.

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

### The screens

`/staff` — the roster, present first. Present first because the list is read at two moments that
want the same order: signing somebody out at the end of a shift, and counting the room against
the ratio. Alphabetical serves neither.

It sits **beside `/members`, not inside it**, and the distinction is the point of 0038:
`/members` is who has a *login*; `/staff` is who *works here*. A reliever appears on one and not
the other.

Reading and signing in are open to any staff member (a manager signs in the reliever; a door
tablet signs in the team arriving together). Adding somebody and recording a last day are
owner/manager, because both change the denominator of the ratio.

**A person with no login says so on the row.** Blank would read as a broken record, and this is
the common case — relievers, contractors, the cook.

**Linking an account is deliberately not on the add form.** `unique (centre_id, user_id)` means
getting it wrong makes "who is signed in" ambiguous, so it does not belong in a form somebody
fills in at speed.

The page states which source the ratio actually uses, and says the surprising half out loud when
it is `derived`: *if nobody signs in, it reads zero adults and shows a breach.* When it is
`declared`, it says signing in here records who was present but does not feed the ratio yet.

#### The count that says what it cannot see

`/staff` shows *"N of M hold a current practising certificate"* — and, when any exist, *"K
practising certificates not linked to anybody"*.

The second line is what makes the first honest. 0038 leaves every link null on purpose, so an
unlinked centre reads as **zero certificated staff while holding a folder of certificates**.
Without the warning that is a lie by omission, and a manager would go chasing documents already
in the drawer.

Mutation-tested: hiding the warning failed the spec on exactly that line. No percentage and no
funding band appear anywhere, and the e2e asserts their absence — rates step at
certificated-teacher thresholds and this repo has not read the handbook.

#### Linking, on `/compliance`

A select beside each staff record, **nothing preselected**, with an explicit *Not linked* option
that also unlinks. A default of "the closest name" would be the same guess 0038 refuses to make,
wearing a different hat.

### What is *planned* (0041), and the constraint that is really about the forecast

Everything above records what happened. `shifts` and `staff_leave` record what is meant to
happen, and they are the half that makes a forward ratio possible: `bookings` (0018) already holds
the children expected on a day, and this holds the adults.

**`on_date` + `from_time` + `to_time`, not a `timestamptz` range** — because `bookings` is shaped
that way and the forecast has to line the two up. A roster is written as "Tuesday, 8 till 4" in
the centre's own clock; storing instants would put a timezone conversion, and therefore a bug, in
a different place on each side of the join.

**The overlap constraint is the assertion the section exists for.** A double-booked person is
counted twice in a forecast, and the error surfaces as a roster that reads adequately staffed and
is not. `exclude using gist` refuses it, the same mechanism as `enrolments_no_overlap`. Two
details that look like bugs and are not:

- **`[)` bounds.** A shift ending at 16:00 does not collide with one starting at 16:00. That is a
  handover, not a clash, and asserted as such.
- **Cancelled shifts are excluded from the constraint.** A cancelled 8-till-4 must not block the
  replacement 8-till-4, which is the entire point of cancelling one.

**Leave deliberately has no overlap constraint.** Sick leave declared during booked annual leave is
a real situation, and refusing it pushes the correction outside the system where nothing can see
it. Only *approved* leave affects the forecast, and that is decided when the forecast is computed.

**This is not payroll.** No rate, no entitlement balance, no accrual. Leave answers one question —
is this person available that day — because that is what the ratio needs. Half a payroll system is
worse than none.

Read is any staff member (somebody who cannot see next week cannot plan around it); write is
owner/manager through `caller_may_roster`, a definer function for the same reason
`caller_is_staff_for_member` is one. Mutation-tested both ways: dropping the exclusion constraint
failed the suite on *one person CANNOT be rostered twice*, and widening the insert policy to any
staff failed it on *and CANNOT roster themselves*. Neither table has DELETE — a cancelled shift is
a fact about what was planned, and a roster somebody can erase cannot show that Tuesday was short
before anybody noticed.

### The forward forecast, which is the only answer anybody can act on

`forecastDay` joins the two halves: bookings for the children, shifts minus approved leave for
the adults. Everything else in this product answers *what is the ratio now* or *what was it at
10:40 last Tuesday*, and both are late — a breach you learn about at 10:41 has already happened.

**It never touches a timezone**, and that is the payoff for 0041's column shape. Both sides are a
local date plus local times, so the comparison is a string comparison between two things already
in the same frame. Converting to instants would put a conversion, and a different bug, on each
side of the join.

**Segments, not a verdict.** Same argument as `replayDay`: the planned ratio is a step function
that changes only where a booking or a shift begins or ends. *"Tuesday is short"* is not
actionable; *"Tuesday 15:00–16:00 you are one adult short, Alice is already covering"* names the
hour and the person.

Four judgements it makes, each of which could reasonably have gone the other way:

| | |
|---|---|
| **Only approved leave** removes an adult | Forecasting against an undecided request shows a manager a shortfall they can dismiss by declining it — a forecast arguing for its own conclusion |
| **Untimed bookings count all day**, and the screen says how many | The safe direction, and it can invent a 7am shortfall for a child who arrives at noon. A number quietly inflated by a data-entry gap teaches people to distrust it, so the inflation is stated |
| **`[)` on both sides** | The same bound the exclusion constraint uses. A shift ending at 16:00 does not staff the segment starting at 16:00, and treating a handover as an overlap invents an adult |
| **Age banded on the forecast date** | The mirror of `replayDay`'s rule, running forwards. A child who turns two next Tuesday is in the over-2 band next Tuesday |

**It does not read attendance, and must not.** A forecast is about a day that has not happened;
mixing in what actually occurred produces a figure whose provenance nobody can state — the same
mistake 0040 forbids for the adult count, one level up.

Mutation-tested five ways, each caught by the test named for it: approved-only leave, the
half-open bound, the age date, untimed bookings, and the leave filter itself. And twice more
through the browser — dropping the translated overlap message, and hiding an on-leave shift
instead of badging it.

### The screen

`/roster`, directly under Staff, because it is the same list read forwards. Seven days: the
horizon a reliever can be booked within. A month view answers a different question — a manager
looking a month out is planning, one looking a week out is covering.

**A shift for somebody on leave stays on the roster, marked *not counted*.** Hiding it would be
tidier and wrong: that shift is precisely what needs covering, and a roster that silently drops it
contradicts the forecast printed above it.

**The overlap refusal is translated.** Postgres says `violates exclusion constraint
"shifts_no_overlap"`, which is true and useless. Rostering the same person twice is an ordinary
slip rather than an attack, so it is the error a manager will actually hit.

## Still to come in this phase

Nothing. 0038 through 0041 close the gap the binder used to admit to — with the standing
exception that the bands those numbers rest on are still unverified, and the forecast made that
worse rather than better. See [[unverified-claims]].

## See Also

- [[compliance-and-evidence]] — the admission this phase closes, and `staff_records`
- [[attendance-and-ratios]] — what a ratio is derived from today
- [[tenancy-and-rls]] — `caller_has_role` and the predicates used here

*Last updated: 2026-08-08 — date taken from this file's last commit, because the page was written without the footer `llm-wiki/schema.md` requires and no other record of it exists.*
