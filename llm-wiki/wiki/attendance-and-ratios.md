# Attendance and ratios

Append-only sign-in events, and a live adult-to-child ratio derived from them.

## Overview

The feature that makes the app open every morning, and the reason the offline design exists.
`attendance_events` is append-only — but for a *different reason* than the audit log. The
audit log cannot be doctored; attendance is append-only because it makes offline sync
tractable. A sign-in happened at a moment, so two tablets in one room cannot conflict. There
is nothing to merge, only to order and de-duplicate.

That single property is why no sync engine is in this project. Conflict resolution is the
expensive part of offline, and append-only data has none.

Nothing is stored as "present". A counter drifts on a missed sign-out or a failed write, and
drift in a ratio does not report itself as broken — it reports itself as compliant.

## Key Points

- **`client_uuid` is the whole idempotency contract.** Generated on the device *before* the
  first attempt and reused on every retry.
- **`at` is supplied by the client and has to be.** An offline sign-in flushed forty minutes
  later happened at 8:05, and attendance times decide funded hours. The database
  sanity-checks it instead: two hours of clock skew tolerated, the future refused,
  backdating past a fortnight refused.
- **The present roll is derived on every read**, scoped to today in the *centre's* timezone.
- **Staff *and* the child's own guardians can record attendance** — in New Zealand the
  attendance record underpinning a funding claim carries a parent's signature.
- **The adult count is an append-only event, not a setting** — see below.
- **The ratio bands are verified for one service type — the all-day centre-based schedule**
  (2026-08-18, Schedule 2 as at 29 June 2026), and the reading found a row the product was
  missing: three or fewer children of mixed ages need one adult, not the sum of the bands.
  The inputs are still narrower than the schedule — it counts every person present aged
  under 6. See [[unverified-claims]] item 1.
- **And that one schedule is still applied to every service — but the reason changed on
  2026-09-03, twice in one day.** `assessRatio` takes both tables as parameters so a different
  service type can supply different ones, three modules forward them faithfully, and **no call
  site has ever passed one** — so a sessional, home-based or hospital-based service gets the
  all-day centre-based figure. `ratioInputCaveat()` now says so on the screen rather than in a
  source comment.

  ~~`centres` has no service-type column for a caller to read.~~ **It does now: `0083` adds
  `licence_type` and `service_model`, and `/settings` can state both.** So the missing input
  exists and the caveat is no longer the whole story — what remains missing is the *tables*.
  Only the all-day centre-based bands have been transcribed from Schedule 2, so knowing a
  service is sessional still does not let this product compute its ratio; it lets it stop
  pretending the question was never asked. The next step is transcribing the sessional and
  home-based schedules with the same row-by-row discipline as 2026-08-18, at which point
  every caller already has the parameter waiting. [[unverified-claims]] item 51 stays open for
  that, and for the fact that two Crown pages disagree about what the licence types are.
- **There is now a third tense.** This page and the replay both answer what is or was; the
  roster forecast answers what *will be*, from bookings and shifts rather than events. It
  shares `assessRatio` and nothing else — see [[staff-as-people]].

## Details

### `staff_off_floor` (0094) — the hours an adult was present and not counted

**Schema 2026-09-05; the funding computation the same day; the ratio figure still does not use
it.** `ratioInputCaveat()` below is **unchanged and still correct**, and that is a decision rather
than an oversight — see *The caveat cannot be narrowed yet* at the end of this section.

§9-4 wants staff hours *"at times when they were counted towards regulated (ratio) staff"*. Three
tables each get close and none answers it: `staff_attendance_events` (0039) says when a person was
*here*, `staff_count_events` (0010) is a centre-level number somebody typed, and `staff_leave`
(0041) is day-granular so it cannot express a lunch break. `0010`'s own header called this out —
modelling *"who counts toward a ratio while on their break"* is *"a real feature that belongs with
the rest of centre operations, not smuggled in here"*.

**It records the exceptions, not the counted intervals.** Counted hours are the paired
`staff_attendance_events` **minus** these. The alternative was two new `attendance_kind` values,
and that enum is `('in','out')` shared by three things: children's attendance, staff attendance,
and the signature of `kiosk_sign_child(uuid, public.attendance_kind, …)`. Widening it would give
children's attendance two states that can never apply to a child, and change a function signature
the kiosk depends on, to model something that is neither an arrival nor a departure.

It is also how the fact is captured today — the adult-count note field's placeholder is literally
*"two on lunch break"*, which is the same information as free text nothing can read.

**Read is every colleague; write is owner or manager.** `caller_is_staff_for_member` for select,
because the ratio surfaces need it and a person's presence is not private from the people they work
beside; `caller_may_roster` for the write verbs, because marking somebody uncounted lowers a funding
figure and a ratio assessment. An educator marking *themselves* off the floor is the case the write
predicate exists to refuse, and it is a named assertion.

**`reason` is free text and deliberately not an enum.** Schedule 2 says *"at lunch, on a break, or
on non-contact time"* — a description, not a published code list — and §9-4 does not care which.

#### What it cannot do, and it is not a defect here

`centres.ratio_source` defaults to `'declared'` (0040), and a declared centre records **no
per-person staff attendance at all**. There is nothing for these intervals to subtract from, so
§9-4's two figures stay unavailable for such a centre and the return reports a named gap rather than
a zero.

#### The caveat cannot be narrowed yet, and narrowing it would be the familiar mistake

`countedStaffHours` uses these intervals for **§9-4's funding figures**. The **live ratio** does
not, and the reason is in `adults_present_now` (0040): on the `derived` source it counts staff whose
**latest** `staff_attendance_events` row is `in`. Somebody at lunch has not signed out, so they are
still counted — exactly what the caveat says.

So the last clause — *"an adult does not count while on a break or on non-contact time"* — remains
true of the figure it appears beside. Narrowing it now would put a false sentence on three screens,
which this repo has already done once: `exportDisclaimer` spent a day telling managers the product
could not record notice, the day after `0093` gave it exactly that.

**The remaining half of 3B**, then: teach `adults_present_now` to exclude a person whose current
time falls inside an off-floor interval, on the `derived` source only — a declared centre types a
number and there is nothing to subtract. That is a migration, and the caveat narrows with it.

#### Three things the drills found

- **3/4 policy mutations caught**, against the live database: a select policy opened to everybody, an
  educator allowed to write, and the overlap constraint dropped.
- **The fourth is an equivalent mutant, and the probe proved it rather than the argument.** Dropping
  `staff_off_floor_times_ordered` alone still refuses an inverted interval — the exclusion
  constraint's own `tsrange(from, to)` raises *"range lower bound must be less than or equal to
  range upper bound"*. Dropping **both** accepts it. So the CHECK is redundant while the exclusion
  exists; it is kept because it gives a comprehensible error instead of a bewildering one, and
  because it survives the exclusion being dropped. No test is claimed to cover it.
- **The migration's inline audit self-check did not run.** It skips with a notice when there are no
  staff members, and this project has **zero** — measured. So the audit wiring was verified
  separately instead, by inserting through a real staff member in a rolled-back transaction:
  one `audit_events` row, `action = insert`, and the centre resolved correctly through
  `staff_member_id`. That is the `0089` failure mode checked rather than assumed — and a self-check
  that silently no-ops is worth naming, because it looks like coverage in a diff.

### Three ratio states, because two are not enough

| State | Job |
|---|---|
| `breach` | Reports the **shortfall**. "You are non-compliant" is not actionable; "two more adults needed" is |
| `at-limit` | The one worth building. **The warning has to arrive while the parent is still at the door**, not after the child is in the room |
| `ok` | With headroom stated, so it is a number rather than a reassurance |

An empty, unstaffed room is `ok`, not `at-limit`. It satisfies "one more child would need an
adult" trivially, and an indicator that cries wolf on a closed centre is one people learn to
ignore. A test caught that.

### The adult count is an event (0010)

The obvious shortcut is a control on the attendance screen holding the number in local state
or a cookie. It works, and it quietly destroys what Phase 3 is built on: a ratio you cannot
reconstruct for 10:40 last Tuesday, because half of it was in somebody's browser, is not
evidence of anything.

It is a **count entered by a person**, not derived from staff sign-in. Modelling individual
staff attendance means rosters, qualifications and who counts while on a break — a real
feature that belongs with centre operations. An unrecorded count reads as **zero**, which
makes the room show a breach: the failure direction somebody notices and fixes, rather than
silently assuming yesterday's staffing.

### Ratio history is a replay, not a sample

`replayDay` in `packages/core/src/ratioHistory.ts`. Sampling every fifteen minutes and
storing the result is wrong twice: it stores derived data that can drift from the events,
**and** it misses breaches shorter than the interval — which are exactly the ones that
happen, because somebody notices and fixes it.

The ratio is a step function, so replaying the events in order produces every distinct state
with no gaps. Three details:

- **Ages are computed as at the date replayed.** A child who turned two in March was in the
  under-2 band in February; a report using today's ages rewrites history in the centre's
  favour.
- **A breach still open at the last event stays open.** `minutesInBreach` is `null` rather
  than a total that omits it, because a total that omits an open breach reads as a clean day.
- **A child with no date of birth is still counted**, banded as over 2. Omitting them would
  flatter the ratio; the weaker band is the honest direction for an assumption.

### Rejected: a `children.is_present` column

See the Overview. There is no cached presence anywhere and there should not be.

### Rejected: an insert that throws on conflict

`recordAttendance` uses `ON CONFLICT DO NOTHING` and reports `duplicate`. An insert that
raises would force the device to parse an error message to decide whether its write landed,
and getting that wrong either drops an event or duplicates one.

### Rejected: `upsert` without `ignoreDuplicates`

Found by a probe that passed for the wrong reason. A plain upsert needs `UPDATE` privilege,
which is not granted on an append-only table — so a future-dated event was refused with
`42501` before the `CHECK` constraint was ever evaluated. The test looked green and was
testing nothing. `ignoreDuplicates: true` produces `ON CONFLICT DO NOTHING`, which needs no
`UPDATE`.

### Append-only is enforced twice, including against the service role

No `UPDATE`/`DELETE` policy *and* no `UPDATE`/`DELETE` grant, for `authenticated` and
`service_role` alike. Discovered the hard way: the offline drill's first version began by
deleting the day's events with the service role and silently did nothing, so a count read 8
instead of 3. The fix was to assert on the run's own keys, not to widen the grant.

Clearing attendance requires the database owner, or `npm run seed:demo -- --purge`, which
cascades from the children.

## See Also

- [[offline-outbox]] — the queue that feeds this
- [[attendance-verification]] — the family's signature on these events, and why `created_at`
  rather than `at` decides whether an approval has gone stale
- [[compliance-and-evidence]] — where the history becomes evidence
- [[staff-as-people]] — the same arithmetic run forwards, over the planned roster
- [[unverified-claims]] — the ratio bands (item 1), and item 51: one schedule applied to every service type
- [[tenancy-and-rls]]

*Last updated: 2026-09-03*


> ### CORRECTED 2026-08-07: two of three readers ignored `corrects`
>
> `attendance_events` is append-only and a correction is a new row pointing at the one it supersedes,
> so every reader has to resolve that chain. Three readers existed and **one did**.
>
> `readFundingPeriod` selected `corrects` and called `resolveCorrections`. The other two did not:
>
> - **`readDayRatio` / `replayDay`** — `ReplayAttendanceEvent` was `{ childId, kind, at }`, with no
>   notion of a superseded row, and the query did not even select `corrects`. An educator signs a
>   child out at 15:00 by mistake, a manager records the correction the product asks for, and the
>   replay applied **both**: deleting the child from the present set at 15:00, then deleting an
>   already-absent id at 16:30. Every breach in that hour disappeared from `/compliance/binder` — the
>   one artefact here that is handed to a reviewer — and it disappeared in the flattering direction.
>   The more diligently a centre corrected its record, the more of its own breaches vanished.
> - **`attendance_today`** — the live roll. `distinct on (child_id) ... order by at desc` with no
>   notion of a superseded row, and the mechanism is counter-intuitive: **a correction usually carries
>   an EARLIER time than the row it replaces**, because it carries the time the event should have had.
>   So `order by at desc` preferred the superseded row, and the correction was ignored in exactly the
>   common case — somebody noticing at 15:00 that a child was never signed in that morning. The child
>   stayed off the roll and out of the ratio while standing in the room. `event_id` was also the
>   superseded one, so a second correction attached to an already-corrected event and the chain became
>   two siblings.
>
> Fixed in `0026` (the view, with a partial index on `corrects`) and in `packages/core` — where
> `resolveCorrections` is now generic over `{ id, corrects }` so the replay calls the same function
> rather than a second copy of the rule. Six tests plus two RLS assertions, all mutation-tested.
>
> The lesson is not "add `corrects` to that query". It is that an append-only table with a supersede
> pointer has an invariant every reader must honour, and nothing was enforcing it — so the count of
> readers that got it right was a coincidence.
