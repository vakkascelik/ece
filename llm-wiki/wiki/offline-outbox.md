# Offline outbox

A SQLite queue on the device, and the merge that reconciles it with the server.

## Overview

The writes that must work offline are all append-only: signing a child in, signing out,
recording an adult count. That is the entire reason this is a queue and not a sync engine —
append-only data has no conflicts, so the hard part of offline never arises.

A tap writes to `expo-sqlite` and returns. No spinner, no disabled button: on a bad
connection those make a working app feel broken, and the write has genuinely already
succeeded — locally. The card carries a "not sent yet" badge instead.

A flush runs on mount, on return to the foreground, and after each tap. There is no
connectivity library, because the flush attempt *is* the connectivity check.

## Key Points

- **The key is generated once, at enqueue** — never per attempt. Regenerating it on retry is
  the exact bug the mechanism exists to prevent.
- **Queued events count toward the ratio.** Not a UI nicety: an invisible offline sign-in
  means an educator sees fewer children than are in the room, which is wrong in the dangerous
  direction.
- **A permanently refused write is set aside, not retried forever.** This is the property
  that gets forgotten.
- **The merge rule is "latest by the event's own timestamp wins"**, either side. Both obvious
  shortcuts are wrong.
- A flush **stops at the first transient failure** rather than grinding through the queue
  offline.

## Details

### Rejected: PowerSync, ElectricSQL, WatermelonDB

All three solve bidirectional sync with conflict resolution — a harder problem than this one.
Attendance is append-only, so two tablets cannot disagree about whether a child arrived, only
about the order events are written in, and the database orders them. A queue of pending
inserts is the entire requirement, and it costs a table rather than a dependency, a service
and a set of conflict semantics to reason about.

Escalating later is not foreclosed: the outbox does not prevent it.

### Permanent versus transient failure

A queue that keeps re-sending something the server will always refuse is a **jammed queue**,
and it blocks everything behind it. Postgres says which kind of failure it was:

| Code | Meaning here | Verdict |
|---|---|---|
| `23514` | check violation — the event aged past the 14-day window while the device sat in a drawer | permanent |
| `42501` | insufficient privilege — the membership was revoked | permanent |
| `23503` | foreign key — the child was archived or purged | permanent |
| `22P02` | malformed payload | permanent |
| anything else | no signal, server unreachable | transient, stays queued |

`23505` is deliberately absent. A unique violation on `client_uuid` means the event is
already there, which is success, and the API layer reports it as `duplicate` rather than an
error.

Discarding a dead entry takes a deliberate act by a person, because attendance silently going
missing is the failure this whole mechanism exists to prevent.

### The merge rule, and why both shortcuts fail

`buildRoll` in `packages/core/src/roll.ts` — pure, and tested, because this is the part of
offline that is easy to get subtly wrong.

| Rule | Fails how |
|---|---|
| "Queued always wins" | A child signed in offline at 8:05 and signed out on a working tablet at 15:00 shows present all evening |
| "Server always wins" | The offline sign-in is lost entirely |
| **Latest by the event's own `at`** | Correct, and it is also what the database does deriving `attendance_today` — so device and server *converge* rather than merely resemble each other |

The convergence property is asserted directly: replaying a queue and reading the drained
server state produce the same answer.

### Why `buildRoll` lives in `@ece/core` and the outbox does not

`buildRoll` is pure domain logic and testable in the existing vitest setup. It takes
structural types rather than importing from `@ece/api`, so `@ece/core` does not end up
depending on the thing that depends on it.

The outbox itself needs `expo-sqlite` and stays in `apps/mobile`. That is also why the drill
below cannot cover it.

### What the drill covers, and what it does not

`npm run drill:offline` replays exactly what the outbox does — keys fixed up front, reused on
retry, a flush repeated — against the real database through the same `recordAttendance` the
app calls. 10/10 as at 2026-08-04, including that the times survived the outage and that two
clients agree.

**It does not exercise `expo-sqlite`.** A real airplane-mode drill on a tablet is still
required. See [[unverified-claims]].

### WAL, and why

`pragma journal_mode = WAL` so a flush reading the queue never blocks a sign-in writing to
it. An educator tapping during a flush must not see a lock.

## See Also

- [[attendance-and-ratios]] — what is queued, and the idempotency contract
- [[unverified-claims]] — the missing device drill
- [[conventions]]

*Last updated: 2026-08-04*
