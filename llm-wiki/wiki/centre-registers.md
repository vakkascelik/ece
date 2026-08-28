# Centre registers

Drills, hazards and safety checks — the records that belong to the building rather than to a
child, and the phase where the boundary is finally one line.

## Overview

Phase 9's first migration (0034). Three tables in one file because they share a boundary
*exactly*: all centre-scoped, all staff-only, none touching guardianship.

That is the whole reason this phase is simpler than the last. `caller_may_see_child` does not
appear anywhere in it, and neither does the trap where a family reads a record about their own
child that was not ready. What replaces it is a smaller trap, and it is the one thing here worth
asserting.

## Key Points

- **`caller_staff_centre_ids()`, not `caller_centre_ids()`.** A parent is a member of the centre.
  The obvious predicate hands them the hazard register.
  **One later table deliberately breaks this rule** — `rooms` (0066) is readable by a parent,
  because `incidents.room_id` would otherwise render blank for the family the incident exists to
  inform. A room name is a noun; this register is a list of risks the centre recorded about
  itself. See [[checklists]] for the full argument, and note it before copying the predicate
  above onto something new.
- **A failed safety check must say what was wrong.** Enforced by a `CHECK`.
- **Closing a hazard requires saying how.** `resolved_at` and `resolution` are a pair.
- **Nothing here can be deleted**, by anybody. A hazard is closed, not removed.
- **No drill frequency is stored or implied.** `centres.drill_interval_days` is null until a
  centre states one.
- `safety_checks` is append-only with the same `client_uuid` contract as everything else in the
  registers.
- **Hazards gained an assessment in 0069** — `likelihood`, `consequence`, a generated
  `risk_score`, and `review_interval_days` — and **nothing bands the score**. `risk` stays a
  person's judgement and is not derived from the arithmetic; the two are allowed to disagree,
  and a disagreement is information. [[unverified-claims]] item 40 explains why no grid is
  applied, and it closes the day somebody sources one.
- **All three tables gained `room_id` in 0066**, nullable. `hazards.area` stays alongside it for
  the free text a room list cannot express — the verge, the front path.

## Details

### The one predicate that matters

```sql
for select using (centre_id in (select public.caller_staff_centre_ids()))
```

`caller_centre_ids()` is what `centres` itself uses, and it is right there, and it is wrong here.
It includes `parent`, because a parent *is* a member of the centre — that is the whole reason
[[tenancy-and-rls]] describes two boundaries rather than one.

Written with it, a parent would read the hazard register and the drill log: every risk the
centre has recorded about itself, including the ones still open. Not a catastrophe, and not
something anybody would notice from the screens, because parents have no nav link to these
pages. The policy is the only thing that decides.

Mutation-tested: `hazards_select` was rewritten with `caller_centre_ids()` against the live
database, the suite failed on *a PARENT at the same centre reads no drill, hazard or safety
check*, and the correct policy was restored.

### The two constraints doing real work

**A failed check must carry a note.** `safety_checks_failure_has_note` refuses `passed = false`
with nothing written. Without it, "playground: fail" is a row that tells the next person
nothing, and the entire value of the register is that somebody later can act on what was found.

**Closing a hazard requires a resolution.** `resolved_at` and `resolution` are a pair or
neither — the same rule as `sighted_by`/`sighted_at` on `staff_records`, for the same reason. A
closing date with no account of what changed is an empty claim, and it is the claim a review
pushes on.

`control` and `resolution` are separate columns and that is deliberate: what is being done about
a live hazard, and how a closed one was closed, are different facts. A hazard can be recorded at
9am and controlled at 11 without being resolved for a fortnight.

### `issues_found`, which is the column the drill register exists for

A register of drills that all went perfectly is a register nobody learned from. The point of
practising is to find the gate that sticks, and a schema with nowhere to record that produces a
folder of green ticks and no improvement. It sits beside `notes` rather than inside it so it can
be surfaced on its own.

Counts rather than links to the roll: a drill's value as evidence is that *this many* people got
out in *this long*, and tying it to children would make a record about the building depend on a
child's record that may later be purged.

`tsunami` is a separate `drill_kind` from `earthquake` because coastal services rehearse a
different response — move uphill rather than shelter in place — and a register that conflates
them cannot show which was practised.

### Nothing can be deleted

No `DELETE` policy and no `DELETE` grant on any of the three, `service_role` included. A drill
that was held, a hazard that was found and a check that failed are all evidence, and a register
somebody can tidy proves nothing. The same argument as [[incident-register]], and the reason a
hazard is closed with `resolved_at` rather than removed.

### The drill interval this product refuses to know

Every three months is the figure commonly quoted. It is not sourced here, and
[[compliance-and-evidence]] ships `criteria` empty for exactly that reason.

So `centres.drill_interval_days` is nullable, null means the centre has not stated one, and the
product shows how long it has been without calling it late. Fourth outing of the
`RATIO_TABLES_VERIFIED` argument, second of the [[sleep-checks]] shape, and the suite asserts
the absence directly so a default cannot be added without somebody justifying it.

### The visitor book (0035)

One mutable row per visit, signed out by setting a column — not two append-only events like
attendance. A child has a persistent identity that both events hang off, and those events
underpin a funding claim. A visitor has neither: there is nothing to join a second event to
except the first, so the pair would be a row with extra steps, and the append-only discipline
buys nothing when nobody is claiming money against a plumber.

`purpose` and `visiting` are separate fields. "Contractor" and "here to see the manager about
the roof" answer different questions, and after an incident the second is the one that matters —
it is how you work out whether an adult was ever alone with children.

A partial index on `signed_out_at is null`, because "who is still in the building" is asked
during an evacuation, and it is asked while the building is on fire. No `DELETE`: a visitor book
somebody can remove a name from is not a visitor book.

### Immunisation (0036), and the schedule this product refuses to hold

Child-linked, so guardianship is back and so is the purge cascade — both asserted.

**No vaccine list, no ages, no due-date arithmetic.** The National Immunisation Schedule is a
published clinical document this repo has not read, it changes, and encoding a remembered
version would produce a screen telling a centre a child is overdue for something — against a
table nobody here checked, about a matter where being wrong is a conversation with a family
about their child's health. This is the `criteria` argument applied to medicine rather than
regulation, and stricter for the obvious reason.

`next_due_on` exists and is a date somebody **typed off the document in front of them**. Nothing
derives it and nothing derives from it.

`declined` and `not_provided` are separate statuses. A family who decline to immunise and a
family who have not brought the certificate in are in different situations, and collapsing them
would make the register say something about a family's decision that they never said. **Neither
status carries a consequence in this product** — nothing is blocked and nothing is flagged
non-compliant, because what follows from either is a regulatory question this repo has not
answered.

Sighting is its own pair of columns, as on `staff_records`: "the family told us she is up to
date" and "somebody looked at the certificate" are different claims, and only the second
survives a review. Records are **superseded rather than edited**, following
`custody_arrangements` — a child's status changes when they get their four-year-old
immunisations, and "were they up to date at enrolment" is a different question from "are they
now". An update in place answers only the second and destroys the first.

Read is staff plus the child's own guardians; write is staff only. Letting a parent write it
would make `sighted_by` meaningless.

### Excursions (0037), and the consent that must not be reused

Four tables, and the reason is one design trap.

`consent_kind` already has `'excursion'`. It is a **standing** consent — *we are happy for our
child to go on outings* — recorded once at enrolment in `consent_events`. Reusing it as the
consent for a *specific* outing is the mistake this migration exists to make impossible: it
would let a centre take a child to a beach in 2028 on a form a family signed in 2026, having
never been told where their child was going.

So a specific outing gets `excursion_consents`, per child, append-only, and the standing consent
stays a **precondition rather than a substitute**. Both are shown; neither stands in for the
other.

**The gate is on the transition, not on the list.** An outing cannot move to `departed` while a
child on it has no consent for *that* outing. It is not on `excursion_children`, because a child
is routinely added to the plan before their family has answered — refusing that would push staff
into keeping the real list somewhere else, which is how paper registers come back.

Withdrawal is a new row, and the latest decision counts. Asserted by the sequence that actually
happens: consent given, outing ready, family phones on the morning, outing can no longer leave.

**The exception message carries a count, not names.** An exception string can reach a log, an
error reporter, or a screen in a room with parents in it. Same rule as `audit_events.detail`
holding column names and never values — the screen has the roll already and can say who.

**A headcount that does not match is recorded, not refused.** Refusing it would destroy the
evidence that a child was briefly unaccounted for, which is the exact record that matters
afterwards and the reason to count at all. There is deliberately no constraint requiring
`counted = expected`. `expected` is stored rather than derived at read time, so the count stays
readable after a child is added to or removed from the plan — a record whose denominator moves
afterwards cannot be read back honestly.

`excursion_children` carries **the only `DELETE` granted in Phase 9**. Removing a child from a
plan is not destroying evidence: the outing has not happened, and a stale list is worse than a
corrected one. Same reasoning as [[recruitment]] granting it on `job_applications` and
withholding it on `waitlist`.

The purge assertions gained a case worth having: when a child is purged, their place on an
outing and the consents given for it go, **and the outing itself survives** along with the other
child's place on it. A cascade that took the excursion with the child would delete another
family's record.

### A mutation test that failed to mutate

Worth recording because it briefly looked like a hole. The attempted weakening of
`immunisation_select` keyed on the child's centre rather than guardianship — and the suite
stayed green, because a policy expression that reads `children` inherits `children`'s own RLS.
For a parent the inner `EXISTS` returns nothing, so the "weakened" policy was accidentally as
strict as the real one. `using (true)` failed the assertion immediately.

The general lesson is in [[conventions]]: a green suite after a deliberate weakening may mean
the weakening did nothing, and the `caller_*` predicates are `SECURITY DEFINER` precisely so
they are not silently narrowed by the tables they consult.

### The screen

`/facilities` — hazards, drills and daily checks on one page, because they answer one question:
is the building safe to open. Staff only, educators included, since the person who spots a loose
paving stone is the person walking on it and a hazard register only the office can write to is
one nobody writes to.

**The visitor book is deliberately not on it.** That is used dozens of times a day at the door,
and burying it under a page somebody opens weekly would guarantee it stays a spiral notebook.

Three decisions worth keeping:

- **Every drill kind gets a row, held or not.** A log of drills that happened cannot show the one
  that never did, so *"never recorded"* is a row on screen rather than an absence somebody has to
  notice — and it is the row most worth seeing. Same for safety-check areas: the sandpit nobody
  looked at this morning only appears because every area is listed.
- **Closed hazards stay on the list.** A register that hides what was fixed cannot show a
  reviewer that anything ever gets fixed, which is most of what a hazard register is evidence of.
- **The summary counts *uncontrolled* separately from *high risk*.** A high-risk hazard with a
  control written is a managed risk; one nobody has acted on is a job. Merging them makes the
  number useless.

The drill log renders `overdue: null` as a plain elapsed time in the quiet style — not the tick
used for `false`. Fourth screen to carry that distinction, and for the reason
[[sleep-checks]] sets out.

`drill_interval_days` is settable on `/settings` beside the sleep interval. Both were columns the
product could read and nobody could write for a commit or two; that gap is closed, and it is the
second time this session that a setting shipped ahead of the field to set it.

### The visitor book's screen

`/visitors`, its own nav link — the frequent thing must not live under the weekly one. Two
lists: **in the building** (oldest arrival first, because it is read at the assembly point and
the person who arrived three hours ago is the one nobody has thought about since) and **earlier
today**. Signing out moves a visit from the first to the second; nothing removes it, because
0035 withholds `DELETE` from everybody.

The sign-in form sits open rather than behind a button — unlike every other register, the
common visit to this page *is* a write: somebody is standing at the door. The form clears by
remounting on success, so the next visitor does not have to delete the previous one's name.
Times are taken server-side at the click, never from a field: the record is when somebody
arrived, not when a manager got round to writing the book up.

The window reaches back seven days so that "in the building" has no horizon: a contractor
signed in on Friday and never signed out is still at the top of the list on Monday, as a
question — did they stay, or did nobody sign them out? A today-scoped read would resolve that
question by hiding it.

**A test-writing trap recorded for next time:** the first version of the spec located the
in-building list as `getByRole('table').first()`. When that list empties, its card renders an
empty-state paragraph instead of a table — so the locator silently became the *day log*, and
"the visitor is off the first table" failed against the table that was supposed to contain
them. It read exactly like a product bug and was not one; the diagnosis of "a revalidation
race" was also wrong before the page snapshot settled it. Positional locators shift meaning
when conditional rendering changes the population; scope by the adjacent heading instead.

### The excursion screens

A list at `/excursions` and a detail page per outing, because the work — chasing consent,
departing, counting — is per-outing work done with a phone open at the gate.

**"Off site right now" sits above everything else on the list.** During an emergency at the
centre, the first question about outings is who is not in the building.

**The roster shows three consent states, and the wording keeps them apart.** *Not answered —
chase* is a phone call. *Declined — comes off the list* is an answer. A single "no consent"
label would send somebody to phone a family who has already said no. Unanswered sorts to the
top, because the list is a to-do and that is the to-do.

**The guardian selector offers only that child's guardians.** 0037's staff transcription path
does not re-check the link, so a centre-wide list would invite recording a decision against the
wrong family.

**Depart is never disabled by the consent gaps.** Disabling it hides the refusal — the person
taps, nothing happens, and the reason lives in a tooltip nobody reads. Tapping it produces the
server's sentence naming what is missing, at the moment it is wanted.

That sentence is the one thing here worth a browser test. The trigger reports a *count* on
purpose (an exception string can reach a log, an error reporter, or a screen with parents in the
room). The action, which knows it is talking to a screen, recomputes the gaps and splits them —
so the person at the gate is told which of two very different problems they have. Mutation-tested:
disabling the split made the suite fail on exactly the "phone call" wording.

**A short count is shouted, not refused**, and both counts stay in the log. `expected` is
prefilled from the roster and editable, because two children collected early by a parent is an
expected of N−2 rather than a short count.

### The immunisation panel, and the styling it refuses

On the child record, after Health and before Consent — it is health information, and it belongs
beside the allergies rather than filed with the office paperwork. Readable by staff and the
child's own family; writable by staff, because letting a parent write it would make
`sighted_by` meaningless.

**Every status gets the same quiet chip.** The temptation to red-flag *Not up to date* is exactly
the assertion 0036 refuses to make: nothing is blocked, nothing is non-compliant, because what
follows from any status is a regulatory question nobody here has answered. A screen that colours
one status as a problem has quietly made the claim the schema declined to.

**Sighting is stated separately from status**, because "the family told us" and "somebody looked
at the certificate" are different claims and only the second survives a review. The checkbox is
worded as *I looked at the document myself*, and left unticked the panel says so.

`next_due_on` renders with the words *as printed on the document. This product does not work out
due dates.* That sentence is doing real work — without it a date on screen reads as computed,
and computed is precisely what it is not.

**Superseded records are shown, not hidden.** *Earlier records* is the whole reason for
supersession: "were they up to date at enrolment" is a different question from "are they now",
and an update in place answers only the second. Mutation-tested — making the supersede step match
nothing (so two records go live) failed the spec.

Written with `recordHealth` rather than `manageChildren`, matching health conditions: a Well
Child book handed over at the door at 8am has to be recordable by the person who was handed it.

## See Also

- [[incident-register]] — the harder boundary, and where the append-only reasoning is written out
- [[sleep-checks]] — the same "no interval until you state one" pattern
- [[tenancy-and-rls]] — why `parent` being a role *inside* the tenant is the thing to design against
- [[unverified-claims]] — where the drill frequency belongs
