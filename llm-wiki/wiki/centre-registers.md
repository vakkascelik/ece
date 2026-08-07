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
- **A failed safety check must say what was wrong.** Enforced by a `CHECK`.
- **Closing a hazard requires saying how.** `resolved_at` and `resolution` are a pair.
- **Nothing here can be deleted**, by anybody. A hazard is closed, not removed.
- **No drill frequency is stored or implied.** `centres.drill_interval_days` is null until a
  centre states one.
- `safety_checks` is append-only with the same `client_uuid` contract as everything else in the
  registers.

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

### A mutation test that failed to mutate

Worth recording because it briefly looked like a hole. The attempted weakening of
`immunisation_select` keyed on the child's centre rather than guardianship — and the suite
stayed green, because a policy expression that reads `children` inherits `children`'s own RLS.
For a parent the inner `EXISTS` returns nothing, so the "weakened" policy was accidentally as
strict as the real one. `using (true)` failed the assertion immediately.

The general lesson is in [[conventions]]: a green suite after a deliberate weakening may mean
the weakening did nothing, and the `caller_*` predicates are `SECURITY DEFINER` precisely so
they are not silently narrowed by the tables they consult.

## See Also

- [[incident-register]] — the harder boundary, and where the append-only reasoning is written out
- [[sleep-checks]] — the same "no interval until you state one" pattern
- [[tenancy-and-rls]] — why `parent` being a role *inside* the tenant is the thing to design against
- [[unverified-claims]] — where the drill frequency belongs
