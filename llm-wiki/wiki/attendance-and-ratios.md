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
- **And that one schedule is applied to every service, because nothing records which service
  this is.** `assessRatio` takes both tables as parameters so a different service type can
  supply different ones, three modules forward them faithfully, and **no call site has ever
  passed one** — so a sessional, home-based or hospital-based service gets the all-day
  centre-based figure. `centres` has no service-type column for a caller to read. As of
  2026-09-03 `ratioInputCaveat()` says this on the screen instead of leaving it in a source
  comment; the column is deliberately *not* the fix, and [[unverified-claims]] item 51
  records why (the other schedules are not transcribed, and two Crown pages disagree on what
  the service types even are).
- **There is now a third tense.** This page and the replay both answer what is or was; the
  roster forecast answers what *will be*, from bookings and shifts rather than events. It
  shares `assessRatio` and nothing else — see [[staff-as-people]].

## Details

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
