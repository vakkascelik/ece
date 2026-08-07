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

## See Also

- [[medication-administration]] — same shape, and where the append-only reasoning is written out
- [[incident-register]] — the other Phase 8 table
- [[unverified-claims]] — item 23
- [[attendance-and-ratios]] — `RATIO_TABLES_VERIFIED`, the pattern this follows
