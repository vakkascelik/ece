# Reading every row

PostgREST returns at most a thousand rows and reports no error. That silently under-reported a
funding claim by 28% and invented broken days that were not broken.

## Overview

`max_rows: 1000` is in this project's PostgREST configuration — read from the project, not assumed.
An unbounded `select()` therefore returns **at most 1000 rows with `error` set to `null`**. Nothing
in the response says anything was left behind.

That was a live bug in the money path, and it was found by measurement rather than by reasoning. It
is on this page as its own topic because the failure mode generalises: a read that quietly returns
part of the answer is worse than one that fails, and there is no type, no lint rule and no runtime
check that distinguishes "this returns everything" from "this returns the first thousand of an
unknown number".

## Key Points

- **`max_rows` is 1000 and truncation is silent.** No error, no flag, no count.
- **It cost 28% of a funding claim and fabricated two unresolved days**, measured against the live
  database with 1,200 attendance events.
- **`fetchAll` pages and throws at a ceiling** rather than returning a partial result, because a
  partial result is what caused the bug.
- **A bigger `.limit()` would move the cliff, not remove it** — and move it somewhere nobody is
  watching.
- **Every paged query orders by `id` as a tiebreaker.** Paging over a non-unique order repeats one
  row and skips another.
- A guard test reads the source of every query and makes the decision explicit for all of them.

## Details

### What it actually did

1,200 attendance events for one child, then `readFundingPeriod` over the same period:

| | reported | true |
|---|---|---|
| attended hours | 72 | higher |
| unresolved dates | 2 | 0 |

Wrong in **both** directions at once. It under-reported the claim, so a centre would be underpaid.
And it fabricated two broken days, because the cut landed mid-day and left sign-ins with no
sign-out — telling a manager their records were incomplete when they were not.

That is the precise inverse of what the funding design is for. The rule is that nothing is
estimated: a day whose record is broken is excluded and **named**, so somebody goes and fixes it.
Silent truncation makes the product name days that are fine and quietly drop hours that were
worked. See [[funding-and-billing]].

Worse, with **tidy** data the truncation produces no warning at all. The drill's clean fixture —
every session inside one local day — reports 41.66 hours instead of 50.00 with zero unresolved days.
A plausible wrong number and nothing to notice.

### Why paging, and why it throws

`fetchAll` (`packages/api/src/paging.ts`) takes a page **factory**, not a builder — a Supabase query
builder cannot be awaited twice, and reusing one silently returns the first response again, which
would be an infinite loop of identical pages. A factory makes that impossible to write.

It stops on a short page, and at a ceiling of 200 pages it **throws** rather than returning what it
has. A funding export that fails is one somebody investigates; a funding export that is 28% low is
one somebody keys into ELI Web.

Exactly 1000 rows is ambiguous — full page or last page — so it always costs one more request to
find out. Cheaper than being wrong.

### The tiebreaker is not cosmetic

Every paged query orders by `id` in addition to its natural sort. Paging over a non-unique order is
its own silent corruption: two rows sharing a timestamp — a bulk import, a fast double-tap — can
come back in either order, so one appears on **both** pages and another on **neither**. On an
invoice that means charging for a day twice and not at all for another.

### Where it mattered most, which was not obvious

`listChildren` was the sharpest case and it looks harmless. A licence caps the roll, so the current
roll could never truncate — but `includeArchived: true` returns every child who has ever attended,
and that is the option the **funding page** uses to turn an id into a name for a child who has since
left. Ten years of a two-site operator is well past a thousand.

The failure would not have looked like a failure: the table renders "a former child" when a name is
missing from its map, so a truncated read produces an export where some rows are anonymous — on the
one document whose purpose is to be keyed into a Ministry system per child. No error, and the totals
stay correct.

### The guard, and the three ways it lied first

`packages/api/src/__tests__/bounded-queries.test.ts` reads the source of every query in the package
and requires each to be paged, provably small, or listed with the **structural** reason its row count
cannot reach a thousand. "A licence caps the roll" qualifies. "It probably will not get that big"
does not, and anything resting on that got paged.

It took three attempts to make honest, and the middle failure is the one worth keeping:

1. Treating any chain containing `.select(` as a read flagged `insert(…).select()` three times — the
   idiom for returning an inserted row. **A guard that reports things which are not true earns an
   allowlist entry, then gets ignored, then gets deleted.**
2. A fixed line lookahead bled into the **next** function. `listChildren` is followed by `getChild`,
   which ends in `.single()`, so the scanner declared the unbounded query bounded and the whole
   suite passed with the bug still present. Worse than a false positive because it is silent — and
   it is the same shape of wrongness the guard exists to catch, inside the guard.
3. Scoping to the statement broke the `let q = …; q = q.gte(…); await q.limit(200)` builder pattern
   and called a bounded query unbounded.

Function-scoped windows handle all three. The test also asserts it finds more than 25 queries, so a
scan that matched nothing cannot pass vacuously.

### The drill

```bash
npm run drill:rowcap
```

Creates a throwaway tenant with 1,200 events and asserts the funding path reports **exactly** 50.00
hours. The expected total is hand arithmetic in the script's comments — 8 days × 75 sessions × 5
minutes — not a snapshot, because a snapshot proves the code agrees with itself.

It is mutation-tested: raising the page size above the server cap makes it report 41.66. It is also
the only test in the repo that crosses the cap, because unit tests cannot — the cap is a property of
the server.

Its first version was a **bad instrument** and worth recording as such. A continuous ten-minute
cadence ran through midnight, so `pairDay` correctly reported orphan sign-outs at every date
boundary; the fix improved the number from 72 to 84 against an expected 100, and 84 was tempting to
accept. The expectation was wrong, not the fix. An improvement is not a fix.

## See Also

- [[funding-and-billing]] — the calculation this was corrupting
- [[conventions]] — the other PostgREST traps
- [[offline-outbox]] — the other place a silent partial result appears

*Last updated: 2026-08-05*
