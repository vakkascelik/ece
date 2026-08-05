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
- **A refusal is classified three ways, not two.** Permanent, transient, and *retry-later* — the
  third exists because a device clock running fast is self-healing, and calling it permanent buried
  sign-ins.
- **A queued event belongs to the person who made it.** `recorded_by` is stamped at flush time, so
  an unowned row can be filed under the wrong educator, permanently.
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

### Permanent versus transient versus retry-later — and a correction

A queue that keeps re-sending something the server will always refuse is a **jammed queue**, and
it blocks everything behind it. So a refusal has to be classified.

**An earlier version of this page listed two verdicts and put every check violation under
`permanent`. That was wrong, and it was wrong in the direction that loses a child off the roll.**

`attendance_not_future` is a check violation, and it fires when a device's clock is more than the
two hours of allowed skew ahead of the server's. Classified permanent, a tablet whose clock had
drifted would have its sign-ins marked **dead on the first attempt**: the child stays off the roll,
the ratio is wrong all day, and the day is missing from the funding record — over a clock, with
nobody watching a mobile queue at 8am.

It is not permanent. Real time keeps advancing, so a fixed future timestamp becomes valid on its
own. But it must not be treated as "no signal" either, because that path **stops the flush** — and
one future-dated event at the head of the queue would then block every later sign-in behind it,
turning a drifted clock into a lost day rather than a delayed row.

Hence three verdicts, in `classifyWriteFailure` (`packages/core/src/writeFailure.ts`):

| Signal | Meaning here | Verdict |
|---|---|---|
| `attendance_not_future` | the device clock is ahead of the server's | **retry-later** — skip this row, keep draining the rest |
| `attendance_not_ancient` | the event aged past the 14-day window in a drawer | permanent |
| `23514`, `violates check constraint` | some other rule the row breaks | permanent |
| `42501`, `permission denied` | the membership was revoked | permanent |
| `23503` | foreign key — the child was archived or purged | permanent |
| `22P02` | malformed payload | permanent |
| anything else | no signal, server unreachable | transient — stop, the rest will fail the same way |

The two clock constraints look almost identical and behave in **opposite** directions, which is
exactly how one rule came to swallow both. There is a test asserting they are never classified the
same.

`23505` is deliberately absent from every list. A unique violation on `client_uuid` means the event
is already there, which is success, and the API layer reports it as `duplicate` rather than an
error. If it ever did throw, defaulting to transient retries harmlessly rather than burying a write
that landed.

The judgement lives in `@ece/core` rather than in the outbox because it is the most consequential
logic in the offline path and, being pure, the **only part of it this repo can test at all** —
`expo-sqlite` cannot run in the test runner. Ten tests against the real Postgres message text.

### A queued event belongs to the person who made it

`recordAttendance` stamps `recorded_by` from `auth.uid()` at **flush time**, not at enqueue time.
That one fact decides the whole shared-tablet story, and it was missed until a design review of the
sign-out work.

Leave educator A's three queued sign-ins on the tablet, let B sign in, and **B's token flushes A's
observations** — recorded as B's, in a table with no UPDATE grant for anybody, so the
misattribution is permanent. And if B is not a member of A's centre, RLS refuses the write:
classified transient, the flush loop breaks, so **every sign-in B makes for the rest of the day
queues behind A's row and never sends**, while the badge reports a number nobody reads as broken.

So the outbox carries a `user_id`, and `pending`, `pendingAttendance` and `flush` are all scoped to
the signed-in user. Rows wait for the person who made them and nobody else. That converts an
unanswerable policy question — *do we discard A's work when A signs out?* — into a mechanism where
nobody discards anything and nobody inherits anything.

Three things fall out of it: no misattribution, no jam, and A's queue stops counting into B's
ratio.

### Sign-out does not clear the queue, and `clearAll()`'s docstring was wrong

`clearAll()` describes itself as being "for signing out on a shared tablet". **It is not**, and the
first implementation of sign-out followed that docstring before a review caught it.

Clearing on sign-out means destroying the only record that children were in the building. With the
`user_id` scoping above there is no reason to: the rows are safe where they are. So sign-out does a
final flush while the token is still valid, and **refuses** if anything unsent remains — naming the
count, because "3 sign-ins" is a fact about children in a building and "you have unsaved changes"
is a dialogue people dismiss. `describeSignOut` in `@ece/core` holds that decision, with tests.

`clearAll()` keeps its place as a deliberate, confirmed wipe for a device being handed on.

Also `signOut({ scope: 'local' })`. The default is global, which revokes refresh tokens on every
device the person owns — so signing out of the staffroom tablet would sign them out of their own
phone. Remote revocation is a containment action for the breach runbook, not a side effect of a tap
on the device you are still holding.
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

*Last updated: 2026-08-05*
