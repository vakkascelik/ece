# Sleep checks

The most repetitive record in the building, and the one place this product refuses to say how
often.

## Overview

Phase 8's third table (0033). A centre with sleeping under-2s records that somebody looked at
them, at intervals, and what they saw. Same append-only shape as
[[medication-administration]], so the machinery is unremarkable. The decision worth reading is
what the schema declines to know.

## Key Points

- **No interval is stored, defaulted or implied.** `centres.sleep_check_minutes` is nullable and
  null means *not configured*.
- The product shows **elapsed time since the last check** — a fact — and computes "overdue" only
  once a centre has stated its own interval. It never renders the word *compliant*.
- `not_observed` is a real position, because forcing a choice between four that were not seen
  makes the register say something the checker did not.
- Append-only, `client_uuid` idempotency, `on delete cascade` — all as
  [[medication-administration]], and all asserted.
- The column is `observed_position`, not `position`, which is a SQL function.

## Details

### Why there is no default interval

Five minutes and ten minutes are both commonly quoted. Neither is sourced in this repo, and
"every N minutes" is a claim about the licensing criteria — which [[compliance-and-evidence]]
ships **empty** precisely because nobody here has read them.

Shipping a default would be worse than shipping nothing, and in a specific way. A centre that
saw the product enforcing ten minutes would reasonably conclude ten minutes is the rule. If the
rule is five, the product has just talked them into a breach while showing them a green screen.
That is the `RATIO_TABLES_VERIFIED` argument in its fourth outing, and it is why this is a null
column rather than a flag: there is nothing to flag, because nothing is asserted.

The suite asserts the absence directly — *a centre has NO sleep-check interval until it states
one* — so a future default cannot be added without a test failing and somebody having to justify
it.

### What a centre gets instead

Elapsed time. "Last checked 6 minutes ago" is true, useful, and makes no claim about whether 6
is acceptable. Once a centre sets `sleep_check_minutes`, the same screen can say *overdue against
your 10-minute interval* — attributing the standard to the centre, which is where it came from.

A `CHECK` keeps the stated interval between 1 and 120 minutes. That is a sanity bound on a
typo, not a regulatory range, and 0 is refused — asserted, because a zero interval would make
everything permanently overdue and the screen useless.

### Rejected: enforcing the interval in the database

Tempting and wrong. A missed check is not an invalid row — it is an absence, and absences cannot
be constrained into existence. Worse, a database that refused a late check would delete the
evidence that it was late, which is the exact record a review needs. The register records what
happened; the screen is what draws attention to a gap.

### The screen, and the tick it will not draw

`/sleep`, staff-only, scoped to children who are **signed in** — a register listing the whole
roll is a register nobody scans, and "who is here" comes from `attendance_events` like every
other presence answer in this product.

Sorted longest-since-a-check first, with children never checked today at the top. Sorting by
name would be tidier and useless: the person holding the tablet is looking for who to check
next, and that is the top of the list or it is nowhere. Same reasoning as
`compareIncidentUrgency`.

**Four states, and three of them are easy.** A child never checked reads *No check recorded
today* — not "overdue", because an interval has not started running for them. Past the stated
interval is a red flag naming the interval and whose it is. Inside it is a green tick.

The fourth is the one the feature exists for: **no interval stated**. `overdue` is `null`, and
the row shows a plain elapsed time in the quiet style — deliberately *not* the green tick. A
tick would read as approval of a gap nobody has measured against anything, which is exactly how
a product talks a centre into a breach behind a green screen.

That distinction lives entirely in the view. `test:rls` covers the write and cannot see it, and
`registers.test.ts` proves `sleepStatuses` returns `null` rather than `false` but not what gets
drawn. So `sleep.spec.ts` asserts the absence of `.flag-ok` on that row, and it was
mutation-tested: rendering the null case as the tick made the suite fail on exactly that
assertion.

**The breathing question has no preselected answer.** It is `required` with neither radio
checked, so the browser refuses an empty submission. A default of "yes" would mean the single
most consequential claim on the screen — that somebody observed a sleeping child breathing —
gets recorded by nobody answering it.

The time comes from the server, not from a field, for the same reason: a check records the
moment somebody looked, and a time input invites filling the register in afterwards from
memory, which is the practice it replaces. `client_uuid` is minted per submission and refreshed
after each success, the same contract as `GiveMedicine` and for the same reason — a key fixed at
mount would swallow the 2:10 check as a duplicate of the 2:00 one and report success.

Elapsed times are a server-render snapshot rather than a ticking client counter. A counter would
be friendlier and would also keep counting on a tablet nobody is holding; a number that is
obviously a snapshot is the safer lie to not tell.

## See Also

- [[medication-administration]] — same shape, and where the append-only reasoning is written out
- [[incident-register]] — the other Phase 8 table
- [[unverified-claims]] — item 23
- [[attendance-and-ratios]] — `RATIO_TABLES_VERIFIED`, the pattern this follows
