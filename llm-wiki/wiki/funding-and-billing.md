# Funding and billing

Attendance into money, in two directions that pull against each other — and one thing this product
deliberately cannot do.

## Overview

Phase 5 turns recorded attendance into a funding claim and held bookings into an invoice. Those are
two different sources, and keeping them apart is the point of the phase.

A **funding claim** comes from `attendance_events`: the Crown pays for hours actually delivered, and
a claim built on what was *planned* would be a claim for hours nobody observed.

An **invoice** comes from bookings: a family is charged for the days they held, because a centre
cannot resell a Tuesday somebody did not turn up for.

Because hours become a claim on the Crown, the single most important property in this phase is that
**nothing is estimated**.

## Key Points

- **A day whose record is broken is excluded and named, never guessed.** Not estimated up, not
  silently zeroed.
- **Every rounding decision goes down.** `toHours` floors to two decimals.
- **Corrections supersede what they correct**, transitively — otherwise a fixed sign-in time is
  counted twice.
- **The daily cap is applied before the weekly one.** The other order over-claims.
- **RS7 submission is impossible** and every label says "preparation".
- **No funding rates exist anywhere in the product.** See [[unverified-claims]].
- Bookings are not attendance and neither substitutes for the other.

## Details

### Why a broken day is excluded rather than estimated

A child signed in at 8:00 with no sign-out attended *something*, and an unknown amount of it. Three
options, and only one is defensible:

| Option | Consequence |
|---|---|
| Estimate to a normal day | Over-claims. A false claim to the Crown |
| Silently count zero | Understates, loses the centre funding it is owed, and **hides the record error** |
| **Exclude it and name the day** | The centre fixes the record and re-runs. Conservative, and the error becomes visible |

`attendedHours` returns `claimableMinutes` (complete days only) alongside `unresolvedMinutes` and
`unresolvedDays`, so the export can show what resolving a day is *worth* without claiming it. The
funding page lists the dates rather than a count, because a manager fixing three missing sign-outs
needs to know which three.

A **duplicate sign-in** is reported and does *not* make a day unclaimable — withholding a day's
funding over a double-tap would be punishing a centre for a UI slip. The first sign-in is taken,
because that is when the child arrived.

### The cap ordering, which is easy to get backwards

Daily cap first, then weekly, on what survives.

With a 6h daily and 20h weekly cap, an 8-hour Monday and a 4-hour Tuesday:

- **Daily first:** `min(8,6) + min(4,6) = 10`, then `min(10,20) = 10`. Correct.
- **Weekly first:** `min(12,20) = 12` — two hours nobody was entitled to, because Monday's excess is
  not transferable to Tuesday.

Tested directly. The weekly cap is applied per **ISO week**, so a fortnight is not capped at 20.

Caps apply only where the 20 Hours ECE attestation is in force. Without it there is nothing to cap,
and applying one anyway would understate an ordinary fee-paying enrolment.

### Rounding, deliberately downward

`toHours(59)` is `0.98`, not `1`. A hundredth of an hour per child per day is still over-claiming,
and the direction of a rounding error in a Crown claim should never favour the claimant. The total
is floored again after summing so it cannot creep above the sum of its parts.

### What cannot be built: submission

Submitting a funding return requires being a Ministry-approved student management system integrated
with ELI. The Ministry is not accepting integration applications, and approval requires supporting
**50 services before you may apply**. That is the one thing the regulatory position genuinely
forecloses.

So the output is a **preparation export**: figures a manager keys into ELI Web. Every label says
"preparation" and none say "return", "submit" or "file". That is not pedantry — a screen that looks
like it filed something is a screen after which nobody files anything. `exportDisclaimer()` generates
the wording from the summary, so it cannot say "complete" when it is not, and lives in `@ece/core`
so a future emailed version says the same thing.

### Rejected: Stripe, for now

The plan said "invoicing with Stripe". The invoice is built and the collection is not, for three
reasons:

1. **Nobody pays yet.** The pilot is free, so payment collection is speculative work against an
   unknown flow — and the flow is the part that turns out to be wrong.
2. **Most centres already collect**, through their accounting system or their bank. An invoice they
   can produce and reconcile is worth more than a second payment rail nobody asked to run.
3. **Stripe is a large surface** — keys, webhooks, disputes, refunds, PCI questions, a live account
   in the centre's name. None of those are decidable while the price is NZ$0.

`payments` records money that arrived, entered by whoever reconciled it. Wiring Stripe later means
adding a source column and a webhook, not restructuring anything.

### Rejected: a stored invoice total

`invoice_totals` is a view over the lines. A cached money figure drifts from its own detail the first
time a credit is added inside a transaction that fails halfway, and a total that disagrees with its
lines is worse than a slow query.

**A credit is a negative line, not a second table.** One table means the total is a sum and cannot
disagree with itself; two would mean an invoice total and a credit total that a reader has to
reconcile, which they will do wrongly.

### Issued invoices freeze — which took three mechanisms, not two

The write policy on `invoice_lines` requires `status = 'draft'` — on **every** verb, which took
until `0025` to be true. See the correction below. Changing what a family was billed
after they were billed it is not an edit — it is a different invoice. 
**CORRECTED 2026-08-07, and this is the second time this exact claim has been wrong.** The page
said "the write policy on `invoice_lines` requires `status = 'draft'`" and the enforcement had a
hole in it for five phases: the policy was declared `FOR ALL` with the status condition in its
**WITH CHECK only**, and PostgreSQL checks USING for DELETE, not WITH CHECK. So a line could be
DELETED from an issued, paid or void invoice by any owner or manager of that centre with a JWT.

Because a credit is a negative line by design, that moves the total in either direction: remove
the "centre closed" credit and the family owes MORE than the invoice they hold, after issue, with
no void-and-reissue and no reason recorded. `invoice_totals` is a view, so the app would show the
new figure while the family's copy showed the old one — the outcome `0021` and the trigger were
built to prevent, reached in one statement instead of three.

`0022` is not to blame. It split fourteen `FOR ALL` policies into insert/update/delete by reading
the expressions out of the catalogue and re-issuing them verbatim, precisely so a transcription
error was impossible — and it preserved this asymmetry exactly as it found it. What it could not
see is that `FOR ALL` was **already** asymmetric. The general hazard, now asserted in
`rls_isolation.sql` for every table rather than reasoned about per table: *a narrowing condition
placed only in WITH CHECK is not enforced on DELETE.* `0025` carries the fix, an assertion on the
verb, an assertion on the class, and an allowlist for the two tables where the difference is
legitimate.

Voiding requires a reason and
keeps the reference, because a deleted invoice takes its number with it and the next one reuses it,
so two different amounts end up sharing one reference in a family's records.

**That policy alone did not achieve it, and this page said it did for two days.** `invoices.status`
carries a column UPDATE grant, because an owner has to be able to issue an invoice — so the sequence
was: set the status back to `draft`, edit the line (now permitted), re-issue. Three ordinary
statements, no privilege escalation, and no audit trigger on `invoices` to record any of it.

`0021` adds a transition trigger: no return to draft, no reinstating a void, and the reference,
recipient, period, centre and issue date fixed once issued. A note can still be added, because a rule
that blocks ordinary work is a rule somebody removes. A CHECK constraint could not do this — a CHECK
sees one row and cannot see the row it replaced, and "was this already issued" is a question about the
transition. See [[security-review]].

Payments are append-only in the policies *and* the grants. Correcting a receipt means recording the
reversal, as with attendance and consent.

### Why bookings are not `enrolments.days`

An enrolment carries the contracted pattern; a booking is what is planned for a specific date. They
diverge constantly — a swap for one week, a family holiday, a public holiday. Rolling them together
would mean editing a funding-relevant contract every time a parent asks for a Thursday, and losing
what the contract actually says.

`booking_status` distinguishes `absent` (booked, did not attend, usually still charged) from
`cancelled` (withdrawn in time) from `closed` (the centre was shut, so nobody owes anything). That
distinction is the difference between a correct invoice and an argument.

### The waitlist is not a child record

A waitlist entry is a name, a phone number and a hoped-for start date. Creating a child record for it
would put somebody who may never attend into the roll, the ratio and the retention schedule.

It is owner and manager only, and **invisible to every parent** — it is a list of who is ahead of
them, which is not theirs and is how an ordinary wait becomes a complaint. No DELETE: "were we ever
offered a place" is a question families ask.

### The reconciliation

```bash
ECE_ALLOW_DEMO_SEED=yes ECE_DRILL_PASSWORD=… npm run reconcile:funding
```

Writes a fortnight whose correct answer is worked out **by hand in the script's comments** — a day
over the cap, a split day, a correction, a missing sign-out, and a child without the attestation —
then compares. Expected values are arithmetic a reader can check, not a snapshot, which would only
prove the code agrees with itself. 13/13 as at 2026-08-04.

It refuses to run twice against the same child, because attendance is append-only and a second run
would double the figures. Clearing it needs `seed:demo -- --purge`, which cascades from the children —
attendance cannot be deleted by the app or the service role at all.

That constraint also broke a first version of the assertion: it expected `unresolvedChildCount === 1`
and got 4, because other demo children carried unpaired events from earlier probe runs that could not
be cleaned up. The fix was to assert on the child under test, not to loosen the schema — and it
incidentally demonstrated the calculation working on genuinely messy data.

## See Also

- [[attendance-and-ratios]] — where the events come from
- [[unverified-claims]] — the caps, and the absence of rates
- [[compliance-and-evidence]] — the other thing attendance is evidence for

*Last updated: 2026-08-04*
