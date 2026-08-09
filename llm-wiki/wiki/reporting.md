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

## Related

[[attendance-and-ratios]] · [[compliance-and-evidence]] · [[reading-every-row]] ·
[[unverified-claims]] · [[conventions]]

*Last updated: 2026-08-09*
