# Attendance verification

The half of an attendance record this product never had: a family's signature on it, and the
state that only exists because the signature is derived rather than stored.

## Overview

Since 0009 this product has recorded attendance and never once recorded that anybody outside
the centre agreed with it. That is not a missing nicety. Chapter 6 of the ECE Funding
Handbook requires evidence that a parent or guardian *"has regularly examined and confirmed
the attendance record"* — **once a week** for all-day teacher-led centre-based services, once
a month for sessional and parent/whānau-led ones — and it is the verified attendance record
that underpins a claim on the Crown. Without it, [[funding-and-billing]] was preparing a
funding export from figures no family had ever seen.

§6-3 sets **twelve criteria** for verifying attendance electronically. Before `0061` this repo
met eight of them by accident of decisions taken for other reasons: PINs are per-guardian and
bcrypt ([[kiosk-and-pins]]), nothing defaults to present ([[attendance-and-ratios]]), every
alteration is evident because the tables are append-only and audited, and records are retained
and extractable. It met none of the four that are actually about verification.

`0061` adds two things: a per-child `is_authorised_signatory` flag, and
`attendance_verifications` — append-only rows, one per signature. The *state* of a week is
computed from those rows by `summariseVerification()` in `@ece/core`, never stored.

## Key Points

- **Weekly for all-day teacher-led services.** Source: ECE Funding Handbook §6-3, retrieved
  2026-08-14. Monthly for sessional and parent/whānau-led, which is why the period is stored
  as two dates rather than assumed to be seven days.
- **The status is derived, not stored** — and that is where this diverges from the approved
  SMS it is measured against.
- **`superseded` is a state no competitor models**, because a stored status cannot express it.
- **`is_authorised_signatory` defaults to `false`**, and that is the entire point of the column.
- **There is no snapshot of what was approved**, and it is not needed — because
  `attendance_events` is append-only.
- **The 21-day chase window is a market convention, not a citation.** §6-3 states no deadline.
- **The exact wording of the twelve criteria has not been read by a person.** See
  [[unverified-claims]].

## Details

### The status is derived, and the competition stores it

Juniorlogs — an SMS approved by the Ministry in 2019, and the closest published implementation
of §6-3 in this market — stores a status on the week and moves it through *Awaiting approval →
In Review → Approved*, with *Failed* after three weeks and *Approved-Paper* for the wet-signature
fallback. It is a well-designed state machine and it is stored.

A stored `Approved` drifts the moment the attendance underneath it is corrected. It does not
report itself as drifted; it reports itself as approved. That is the identical failure
[[attendance-and-ratios]] refuses for `children.is_present` and [[reporting]]'s replay refuses
for sampling — and it matters more here, because the thing it would be wrong about is a claim
on public money.

So `attendance_verifications` holds **events** and `summariseVerification()` derives:

| Status | Meaning |
|---|---|
| `not-yet-due` | The period is still running. Nothing can be signed off |
| `awaiting` | Ended, nobody has answered, inside the chase window |
| `overdue` | Nobody answered and the window passed. The way out is paper |
| `in-review` | The signatory disputed it. The ball is with the centre |
| `superseded` | Approved, and attendance has changed since |
| `approved` | Approved, and still true |

### `superseded`, which is what deriving it buys

The state no stored-status design can express: an approval that was true when it was given and
is not any more, because the record moved underneath it.

It is not a nicety. An approval a centre believes it holds, over figures that have since
changed, is exactly the row an auditor finds and the centre cannot explain. The product that
ships a status column does not have this state — not because nobody thought of it, but because
the shape forbids it.

**Two states deliberately do not age into `overdue`:** a dispute and a supersession. `overdue`
means the family never answered. In both of those they did answer, and the outstanding action
belongs to the centre. Letting either age would file the centre's own unfinished work under the
family's non-response, and would hide the two states that always need somebody to do something.
Both are asserted directly.

### Rejected: a snapshot of what was approved

Criterion 6 requires the signature *"indicate the signatory's approval of the information to
which the signature relates"*, which reads like an instruction to copy the week's times into the
row so it is beyond argument what was agreed.

Refused, for [[privacy-and-retention]]'s reason and a better one.

The first is 0055's: a snapshot is a second copy of a family's data under a different retention
rule from the first, on a table nobody can correct or purge.

The second is that it is **not needed**, and only because of a decision taken four phases
earlier. `attendance_events` is append-only and a correction is a new row rather than an edit,
so the record as it stood at any past instant is exactly reconstructible by ignoring rows with a
later `created_at`. *"What did this parent approve"* is answerable from the events and the
timestamp alone.

That is a property this repo paid for in Phase 3 and had never spent. The staleness rule spends
it. What it costs, stated rather than discovered later: answering requires a point-in-time
replay rather than reading a column. If that is ever too slow it becomes a materialised view
over the events, not a snapshot column.

### `created_at`, not `at` — and the bug that would have followed

Staleness compares the signature against `attendance_events.created_at`, when the **server
received** the event, and emphatically not `at`, when the device says it happened.

An offline sign-in flushed on Friday for Monday morning carries Monday in `at` and Friday in
`created_at`. Comparing against `at` would say the record had not changed since a Wednesday
approval — when it demonstrably had, forty-eight hours after the fact. The offline design in
[[offline-outbox]] makes that gap normal rather than exotic.

### Comparing instants, not strings — caught by mutation testing

The first version compared ISO timestamps with `>`. Every test passed. The tests were vacuous:
they compared timestamps whose **date parts differed**, and the date dominates a string
comparison, so the result was identical with or without the fix.

`2026-08-10T09:00:00Z` and `2026-08-10T09:00:00+00:00` are the same instant and sort
differently — `Z` is above the digits, `+` is below them. Postgres renders `timestamptz` with
an offset; JavaScript's `toISOString()` renders `Z`. Both reach this function.

The rewritten tests use a `+12:00` offset — what a session on `Pacific/Auckland` renders — so
that a string comparison gives the **opposite** answer. Three tests now fail when `isAfter` is
reverted to `>`, and they failed for the right reasons.

Calendar-date comparisons in the same module *are* string comparisons, on purpose: a `date` has
no zone and no format variation. It also avoids a third copy of the `daysBetween` helper that
`arrears.ts` and `compliance.ts` each already have privately.

### The signatory flag, and why it defaults to false

Criterion 4: *"Only a parent or guardian who is an authorised signatory can verify attendance
records electronically."*

The column is on `child_guardians`, not `guardians`, because the authority is per child — the
same reason that table already carries `can_collect` and `is_emergency_contact`. A grandmother
who may collect on Tuesdays is not thereby the person who signs off funded hours.

**It defaults to `false`, and that is the whole point.** Defaulting to `true` would make every
contact an authorised signatory the moment they were added — which is criterion 7's *"must not
default to marking children as present"* wearing a different hat: a system that assumes an
answer nobody gave. If the column is tedious to populate, it is working.

`caller_signatory_ward_ids()` is `caller_ward_ids()` with that predicate applied. Reaching for
the unnarrowed function in the policy is the obvious mistake and would pass every test that did
not have a guardian who is not a signatory — which is why the RLS suite now has one.

### Quinn, who is the test

The isolation suite already had Quinn: Beau's father, with an app account and a `parent`
membership. He is deliberately **not** a signatory, so he passes every check the insert policy
makes except the one it exists to make. `caller_ward_ids()` returns Beau for him.

If the signatory predicate is dropped from the policy, or the column ever defaults to true, his
assertion is the line that fails. That is the difference between this block and the
`detail_confirmations` block it is modelled on — one predicate harder, and the harder one has a
named counter-example rather than an argument.

### Rejected: calling it `failed`

`overdue` fires after `chaseWindowDays`, default 21 — three weekly reminders, which is market
practice. **§6-3 states no deadline at all.**

It is treated the way `arrears.ts` treats 30/60/90: a parameter with a documented default, no
`VERIFIED` flag, no claimed consequence. And it is deliberately *not* called `failed`, the word
the market uses, because `failed` reads as a regulatory outcome and there is no regulation
behind it. `overdue` says only what is true — the window passed and nobody signed — and leaves
the response to the centre, whose answer is usually to verify that week on paper instead.

`method = 'paper'` is that fallback, and a paper verification with no `evidence_id` is refused
by a CHECK: a paper signature nobody can point at is precisely the assertion this table exists
to stop the product making.

### Rejected: a unique constraint on (child, period)

A period legitimately holds several rows — disputed on Monday, corrected, approved on Thursday.
The newest wins, transitively, which is the rule `funding.ts` already applies to attendance
corrections. A unique constraint would make the dispute path unrepresentable and force
resolution to be an `UPDATE`, on an append-only table — the contradiction that would have
quietly turned this back into a status column.

## What is not built yet

`0061` is the record and the derivation. Still outstanding, in order:

- The kiosk definer function, so a signatory can verify with the PIN they already have.
- The parent-portal screen and the staff view of what needs attention.
- The weekly release and the reminder chain, which need a scheduler this repo does not have.
- The inspector-shaped export for criterion 12.

## See Also

- [[attendance-and-ratios]] — where the events being verified come from
- [[funding-and-billing]] — what a verified record is evidence for
- [[kiosk-and-pins]] — the PIN that becomes the electronic signature
- [[offline-outbox]] — why `created_at` and `at` differ, and by how much
- [[unverified-claims]] — the criteria wording, and the chase window

*Last updated: 2026-08-14*
