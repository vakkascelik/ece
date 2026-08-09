# Reporting

*Occupancy and attendance over thirty days — and the figure the product refuses to invent.*

Migration `0050`. Code: `packages/core/src/occupancy.ts`, `readAttendanceByDay` in
`packages/api/src/compliance.ts`, `apps/web/src/app/(app)/reports/`.

---

## The finding that shaped the whole feature

**This product could not compute occupancy, and had never noticed.** It knew how many children
attended and had never known how many it was allowed — `centres` carried no licence capacity at
all. A percentage needs a denominator, and the denominator is on a piece of paper from the Ministry
that nobody had typed in.

So `0050` adds `licensed_places`, **nullable**, defaulting to nothing. Same contract as
`sleep_check_minutes` (0033) and `drill_interval_days` (0034): *null means the centre has not
stated one*, which is a different fact from any number.

The tempting alternative is a default. It is wrong in a way that is hard to see afterwards: a New
Zealand licence runs from about ten places to about a hundred and fifty, so a default can be wrong
by a factor of three **while producing percentages that look entirely real**. Somebody would put
one in a board paper. See [[unverified-claims]] for the standing rule this follows — if you cannot
source a figure, make the product say so.

---

## The absent denominator is a result, not a zero

`DayOccupancy` is a discriminated union, and that is the design:

```ts
type DayOccupancy =
  | { date: string; children: number; stated: true; licensedPlaces: number; percent: number }
  | { date: string; children: number; stated: false };
```

Three shapes were rejected, all wrong in the same direction:

- **`percent: 0`** — reads as an empty centre, which is a crisis rather than a blank settings
  field, and a manager would act on it.
- **`percent: null`, let the screen decide** — every call site re-invents the sentence, and one of
  them eventually renders `null%` or quietly `?? 0`.
- **Default the licence** — covered above.

The union means a caller *cannot read a percentage without having handled the case where there is
not one*. The type does the arguing, which is the same reasoning as `ModelPayload` having no string
branch in [[model-calls]].

Mutation-tested: collapsing the not-stated branch into `0%` fails three named tests.

---

## The percentage is not capped at 100

A day over the licence is the single most important row the report can contain, and clamping it to
100% would hide exactly what somebody is looking for.

**But it is not necessarily a breach, and the page says so.** `children` counts everyone present at
*any point* in a day, so a morning child who leaves before an afternoon child arrives counts twice
toward the day's total while the centre was never over its licence at any instant. A report that
called that a breach would be accusing a centre of something it did not do.

Two different questions, and the page names which one it is answering:

| Question | Answered by |
|---|---|
| Was the centre ever over its licence *at a moment*? | `replayDay` / the ratio history on [[compliance-and-evidence]] |
| How full was the centre *across a day*? | this report |

`daysAtOrOverLicence` uses `>=`, not `>`. At capacity is the operationally interesting number — it
is the day a centre turned a family away — and `>` would silently omit it. Mutation-tested.

---

## The average is over open days, not calendar days

Averaging ninety children across five calendar days gives 18; across the three days the centre was
actually open it gives 30. **The first figure is a third of the truth and nothing about it looks
wrong** — it is exactly the number that ends up in a board paper.

So `averageChildren` divides by days that had any attendance, and `daysWithAttendance` is returned
alongside so a reader knows what the average is over. The screen states it in words underneath.

`null`, not `0`, when nothing was recorded: *"we have no attendance data"* and *"no children came"*
are different statements and only one of them is alarming. The page says the stronger thing — a day
nobody signed in looks identical here to a day the centre was closed.

---

## `readAttendanceByDay`, and why it counts in TypeScript

One query over a range, not one per day. The roster forecast already shipped with a page issuing 31
queries and had to be rewritten; a term is ninety days.

Paged through `fetchAll`, and **the bound is not structural**: ~130 events a day at a 65-place
service is ~8,000 a term, so this passes PostgREST's 1000-row ceiling inside a fortnight. That
ceiling is silent, and here it would *under-count attendance* — the same direction of wrongness
that under-reported a funding claim by 28%. See [[reading-every-row]].

**The obvious optimisation is refused on purpose.** `count(distinct child_id) group by date` in
Postgres would return one small answer instead of thousands of rows. It is not used because the
grouping key is a **local date** and the column is an instant: the SQL would have to embed
`at time zone 'Pacific/Auckland'`, and this schema has a `timezone` column precisely so no query
hardcodes one. `localDates.test.ts` scans for that pattern and would reject it.

So the caller passes the day windows it already computed from the centre's timezone, and the
bucketing happens in the application against them. Slower and correct beats faster and thirteen
hours out on the two days a year the offset moves.

Superseded events are excluded — a corrected sign-in is not a second child, and corrections cluster
on the days somebody was watching, which are the days a report is about.

---

## Attendance trends — a trend, not a longer log

Migration: none. Code: `packages/core/src/attendanceTrend.ts`,
`apps/web/src/app/(app)/reports/trends/`.

The occupancy report above answers "how full, day by day, for the last thirty days" — a log.
"Are we busier than last term" and "which afternoon can I safely roster one fewer educator"
cannot be read out of thirty rows of daily noise, so this buckets the same `DayAttendance[]`
`readAttendanceByDay` already produces into twelve Monday–Sunday weeks and into weekdays
instead of days. No new query — arithmetic on what the occupancy report already reads, the
same split `occupancy.ts` itself makes between the query and the summary.

**Twelve *complete* weeks, not the twelve including today.** `completeWeeksBefore` excludes
the week `today` falls in, on any day of the week including Sunday — a Wednesday's three open
days would otherwise average as though the week had already finished, understating it for a
reason nothing on the page would explain. The same discipline `averageOverOpenDays` applies to
a closed day, one level up.

**`averageOverOpenDays` is factored out of `occupancy.ts` rather than copied.** It was about to
be written a third time — the daily average, a weekly one, a per-weekday one — and a fourth
chance for the rounding or the open-day filter to drift between copies. One function, three
callers.

**The trend figure names two weeks rather than fitting a line.** "Busier than twelve weeks ago"
compares the earliest week with any attendance against the most recent one, both printed in the
sentence — a reader can check the claim against the table directly below it. A regression slope
or a moving average would compress twelve numbers into one that looks more rigorous and is
harder to audit against what is on the same page.

**The weekday pattern is for rostering, not compliance.** "Fridays average 22 tamariki" is one
number a manager can act on; "22 last Friday" is one sample and might have been a school
holiday. The page points at [[compliance-and-evidence]]'s ratio history for the moment-by-moment
question, the same cross-reference the occupancy report makes.

Mutation-tested: the Sunday-bucketing case (`getUTCDay()` returns 0 for Sunday, and a naive
`date - (weekday - 1)` with no remap sends it into the *following* week) has its own test
because it is the kind of off-by-one that would pass on six days out of seven.

---

## Enquiry conversion — and why it is not called "waitlist conversion rate"

Migration: none. Code: `packages/core/src/enquiryFunnel.ts`,
`apps/web/src/app/(app)/reports/waitlist-conversion/`.

The roadmap that named this item called it "waitlist conversion". It is not built as one,
because the schema cannot answer that question and building it as though it could would be
exactly the confidently-wrong report [AGENTS.md §4.5](../../AGENTS.md) forbids.

**`enrolment_applications.status` (0052/0054) is current state, not history.** The path is
`new → contacted → waitlisted → enrolled`, and once a row reaches `enrolled` it no longer says
`waitlisted` — the fact that it passed through that stage is gone from the row. So "of everyone
who was ever waitlisted, how many enrolled" cannot be read out of this table. "Of everyone who
enquired, how many became a placement" can, and is what `summariseEnquiryFunnel` computes. The
page's own heading says which question it is answering rather than borrowing a name that implies
the other one.

**The rate divides by decided enquiries, not by all of them.** A centre with six new enquiries
and two enrolments and zero declines has a 100% conversion rate among decisions made, not 33% —
dividing by `total` would count "hasn't been actioned yet" as a loss. Same shape as
`averageChildren` in `occupancy.ts`: `null`, not `0%`, when nothing has been resolved, because
`0%` reads as "every enquiry is failing" and the true state is "nobody has been contacted back
yet".

**All enquiries ever, not a thirty-day window.** Enquiries are not the high-volume, PostgREST-row-cap
concern attendance is — a small service gets a handful a month, and a family's enquiry can take
months to resolve. Windowing this the way occupancy windows attendance would show mostly `new`
and `contacted` rows with no outcome, understating the rate for a reason nothing on the page
would explain.

**The office `waitlist` table (0018) is deliberately not on this page.** It is a second, older
path for enquiries taken by phone, and nothing in this product has a screen that reads or writes
it — `grep` for `.from('waitlist')` outside its own migration returns nothing. A report that
folded it in would be asserting a queue nobody can see or add to. Left out and said so, rather
than shown as a silent zero that looks like "nobody has phoned".

## Related

[[attendance-and-ratios]] · [[compliance-and-evidence]] · [[reading-every-row]] ·
[[unverified-claims]] · [[conventions]] · [[public-website]]

*Last updated: 2026-08-09*
