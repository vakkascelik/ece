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

## The web has an outbox too, since 2026-08-06

For five phases "the offline path" meant the mobile app, and `attendance/actions.ts` justified
having no queue on the web with a comment saying there was "no offline gap to preserve, unlike
on a tablet". **The web app is what runs on the tablet.** It is the build bolted to the wall by
the door, and until this change a sign-in made while the wifi was down simply failed: the tap
errored, the child was on nobody's roll, and the ratio counted the room one person short —
wrong in the dangerous direction.

`apps/web/src/lib/outbox.ts` now mirrors the mobile contract with different storage. What is
shared is what matters:

| | Mobile | Web |
|---|---|---|
| Storage | `expo-sqlite` | `localStorage` |
| Key fixed at enqueue | yes | yes |
| Dead-lettering | `classifyWriteFailure` | same function |
| Ratio counts queued events | `buildRoll` | same function |
| Survives an app restart | **yes** | **no — see below** |

`localStorage` rather than IndexedDB because the queue holds attendance events at roughly 150
bytes each: IndexedDB buys asynchrony and a schema for a payload that fits in a fraction of a
percent of the 5MB budget. Being synchronous is a feature here — the row shows its chip in the
same tick as the tap.

### The one place the web is genuinely weaker, and it is not the queue

**The web app cannot re-render while offline.** It is server-rendered with no service worker,
so a reload with the network down gives the browser's own error page. Found while writing the
e2e: `page.reload()` failed with `ERR_INTERNET_DISCONNECTED`, which is exactly what a wall
tablet would show after a power cut.

The queue survives — it is in `localStorage` and the test asserts it directly rather than
through a reload. What does not survive is the *page*. So the honest statement of the web
offline story is: **work made offline is safe as long as the tab stays open.** Mobile is a
binary and does survive a restart. Closing that gap means a service worker, which is a
different piece of work and is not pretended to exist.

### One write path, not two

Every tap enqueues locally and then tries to flush. There is no separate online branch, and
that is deliberate: a fallback path only exercised when the wifi drops is a path nobody has
ever seen work. The cost is that sign-in no longer goes through a server action, so
`router.refresh()` pulls the server's view back down once the queue drains — and the old
`signIn`/`signOut` server actions were removed rather than left as a second way in.

Corrections and the adult count **stay** server actions. A correction is made at a desk by
somebody who has noticed a mistake and must give a reason; queueing it would buy nothing and
cost a class of "which correction won" questions. The adult count is one number for the whole
centre rather than a per-child event, so a queued copy would fight the server's rather than
merge with it.

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

### Three of the classifier's six rules were unreachable, and `transient` stops the flush

**2026-09-04, measured against live Postgres.** `recordAttendance` threw `error.message` and
discarded `error.code`. Four of `classifyWriteFailure`'s six rules key on a sqlstate; three of
those four have no message-text fallback, so all three fell through to the default:

| Refusal | Code | Message text | Before | After |
|---|---|---|---|---|
| RLS refused the row | `42501` | `new row violates row-level security policy for table "attendance_events"` | `transient` | `permanent` |
| the child was purged | `23503` | `insert or update on table "attendance_events" violates foreign key constraint "attendance_events_child_id_fkey"` | `transient` | `permanent` |
| a malformed uuid | `22P02` | `invalid input syntax for type uuid: "not-a-uuid"` | `transient` | `permanent` |
| the 14-day trigger | `23514` | `attendance_not_ancient : row is older than the 14 day window (...)` | `permanent` | `permanent` |

Every string above was read off the database by attempting the write inside a rolled-back
transaction, not written from memory.

**Why `transient` is the damaging verdict, not a harmless one.** It does not mean "retry in a
minute". Its whole purpose is to say *nothing after this will do better right now*, so the flush
**stops** — see the three-verdict section above, where that distinction is the bug it was
introduced to fix. A permanent refusal misread as transient therefore parks the entire queue
behind it, indefinitely. Not one lost write: a tablet that quietly stops recording sign-ins.

**The `42501` row is the one that happens.** An educator removed from a centre, a child moved to
another service, a membership ended while a tablet sat in a bag — the queue still holds those
events and the server is right to refuse every one. And PostgREST's RLS message carries neither
`permission denied` nor the code, so nothing matched it.

Fixed at both ends, deliberately:

- **`recordAttendance` and `recordAdultsPresent` now append the sqlstate** to the message. Both,
  because the mobile outbox flushes adult counts through the second one and classifies the result
  with the same function. The alternative — a typed error class — would have to be learned by
  every caller and both outboxes; the classifier already reads strings, so this makes the string
  true.
- **A text rule for the RLS wording**, which survives a third write being added to an outbox by
  someone who does not know the code has to be put into the message by hand.

The other `throw new Error(\`fn: ${error.message}\`)` sites in `packages/api` were left alone —
161 of exactly that shape, counted, plus a few multi-line variants. Only these two reach an outbox; the rest are server actions where a thrown error becomes a
message on a screen, and widening the change would have been a refactor rather than a fix.

#### A test that contradicted its own name, and pinned the defect

`writeFailure.test.ts` already had this:

    it('treats a revoked membership as permanent', () => {
      // 42501. Retrying will not restore a membership somebody deliberately revoked...
      expect(classifyWriteFailure('new row violates row-level security policy')).toBe('transient');

The gap had been **noticed and then pinned**: the title says permanent, the comment explains why
it is permanent, and the assertion was written to match the code. That is worse than no test,
because the name is what the next reader greps for and finds reassurance in.

#### The correction: the 14-day case was never broken

The red drill assertion that started this was read, by me, as a live outbox defect, and I said so
before checking. It was not. `0079` puts `tg_name` at the front of the trigger's message and
`classifyWriteFailure` matches on that name, so the 14-day refusal has classified as `permanent`
throughout. The section above already said this and I did not read it closely enough.

What was actually broken was the drill — see below — and, separately and genuinely, the three
rows in the table above.

### `drill:offline` was testing its own copy of the rule

The assertion that a permanently refused write is not retried read:

    permanent = /\b23514\b/.test(message) || /violates check constraint/i.test(message);

under a comment claiming *"the same classification `outbox.ts#isPermanent` applies"*. It was a
copy, not a call. `0078` changed the message to the trigger's own sentence, which matches neither
pattern, so the drill went red while the product was correct.

**A copy of a rule cannot verify the rule.** It can only report that two things have drifted,
without saying which of them is wrong — and the first guess will be the product. The assertion
now calls `classifyWriteFailure` itself, the same function both outboxes call.

The drill also gained the assertion that would have caught the real defect: a write RLS refuses
must classify as `permanent`, not stall the queue. Mutation-tested against the live database by
removing both halves of the fix, which produced `got transient` and a red drill. **11/11.**

### `attendance_not_ancient` is a trigger now, and that nearly broke this table quietly

**2026-08-31.** `0078` moved six `_not_ancient` rules from CHECK constraints to `BEFORE INSERT`
triggers, because a time-relative CHECK is enforced while a dump's rows land and made the whole
operational core unrestorable more than a fortnight after a backup. See
[[unverified-claims]] item 44.

A trigger phrases its own refusal, and `0078`'s first wording was *"row is older than the 14 day
window (at on public.attendance_events)"* — **carrying neither constraint name**. The row above
matches on the name.

**The verdict would still have been right, by luck.** The trigger raises `check_violation`, the
generic `23514` row catches it, and `permanent` is the correct answer. Nothing would have broken
for a user.

**What would have rotted is this table.** The named row becomes dead code matching a string the
database can no longer emit; its unit test goes on passing because it feeds a synthetic message;
and this page would have described a distinction that was no longer being made. That is the same
decay this page has already been through once — it spent a day telling readers every check
violation was a permanent failure, which was the opposite of the fix that had just been made.

`0079` puts the name back, taken from `tg_name`, which `0078` had deliberately kept equal to the
old constraint name. So both spellings now occur in the wild and both are asserted:

| Spelling | Where it comes from |
|---|---|
| `... violates check constraint "attendance_not_ancient"` | a device that has been offline since before 0078 and is flushing an old queue |
| `attendance_not_ancient : row is older than the 14 day window (...)` | the trigger, today |

The lesson generalises past this table: **the message text of a database refusal is an interface**
the moment anything parses it, and moving a rule from a constraint to a trigger changes that text
without changing a line of the code that reads it.

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

> **CORRECTED 2026-08-07. Everything above was true of MOBILE and not of the web outbox**, which is
> the app that actually runs on the tablet by the door — the argument that justified building a web
> queue at all. `OutboxEntry` had no `userId`, and `pending`, `snapshot` and `flush` read the whole
> browser store. So educator A's queued sign-ins were flushed under whoever was signed in when the
> wifi returned, recorded as them, permanently; and A's queue counted into B's ratio. Found by
> tracing this page against the code rather than by using either app.
>
> Fixed: the web entry carries `userId` and every read and write is scoped to it, mirroring mobile.
> An entry written by the previous build matches nobody and sits inert — acceptable rather than
> migrated, because nobody has used the product and there are no child records in any centre.
>
> The web queue did **not** have mobile's jam problem: its flush loop continues past a failed entry
> instead of breaking, so one stuck row never blocked the rest.

### The write-back was a lost update, and it lost children

Also 2026-08-07, and the worse of the two. `flush` read a snapshot, awaited the network per entry,
then wrote the snapshot's survivors back **wholesale** — erasing anything enqueued during that
window:

```
08:00:00  flush A starts, snapshot [ana], POST in flight on a slow connection
08:00:02  educator taps "Sign in Ben"  -> store is [ana, ben]
08:00:03  a second flush fails transiently and writes [ana, ben]
08:00:08  flush A's already-delivered POST returns ok; its survivors are [] -> writes []
```

Ben's sign-in is gone from localStorage, was never sent, his row reads "Not signed in", the pending
count is 0 so nothing is shown and sign-out is not blocked. A child in the room, on nobody's roll and
out of the ratio — the exact failure this whole mechanism exists to prevent, arrived at by the
mechanism itself. A dead-letter recorded by the concurrent flush vanished the same way.

Mobile never had it: it deletes by `client_uuid` row by row rather than rewriting the queue.

The fix re-reads at commit time and applies the flush's outcomes to the store as it is *then*, keyed
by `clientUuid`. That holds for any interleaving, which matters because the reentrancy guard added
alongside it **cannot help across tabs** — localStorage is shared between them, and two open copies
of the roll on one tablet is ordinary. Three tests, all mutation-tested against the old write.

`enqueue` is still a read-then-write, so two tabs enqueuing in the same instant can lose one. Stated
rather than fixed: it needs a lock, and localStorage has no transaction.

### A permanently-refused sign-in was discarded with no message

`describeSignOut` returns `allowed: true` **with a warning** when the queue holds only dead entries —
they cannot be rescued by waiting, so they must not hold somebody on the device, but they are still
records of children that will never reach the server. `SignOutControl` branched on `allowed` alone,
went straight to sign-out, and called `discardDead()`. So the warning branch was unreachable and the
comment saying dead entries "are named in the dialog and then let go" described something that could
not happen: the dialog only ever opened when the verdict was `allowed: false`. It now opens for the
warning too, naming each stuck record and what refused it, with a primary action that says it
discards them.


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

> **The web app was doing the thing this paragraph says not to do**, until 2026-08-07:
> `login/actions.ts` called `db.auth.signOut()` with no argument, and the default scope is global. So
> signing out of the staffroom tablet revoked the person's refresh token on their own phone. Now
> `scope: 'local'`. `/account` and `/reset-password` keep `scope: 'others'` after a password change,
> which is the opposite case and deliberate.
>
> A second leak found next to it: the throwaway client `changePassword` builds to verify the current
> password used `createAnonClient`, whose defaults were `persistSession: true, autoRefreshToken:
> true`. Every password change therefore started a refresh ticker firing every thirty seconds against
> a client nobody would use again, and left a live session on the auth server. **Every caller of
> `createAnonClient` is server-side** — the defaults were right for the browser named in its comment
> and wrong for all three real callers — so they are now server-safe, a browser caller opts in, and
> the throwaway session is signed out explicitly.

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

### The roll is optimistic, so "the row moved" is not "the server has it"

`toggle` in `RollClient.tsx` enqueues, re-renders from the local queue, and calls `void
send()` — **unawaited, on purpose**. The row moves in the same tick because a spinner on a
foyer tablet with no signal is theatre, and the SyncChip carries the "not sent yet" fact
instead.

The consequence is easy to forget one page later: **anything server-rendered will not show
that sign-in until the queue drains.** Navigating immediately after a tap cancels the POST
in flight. Nothing is lost — the entry stays queued and the next visit to the roll retries
it, which is the entire point of the outbox — but the write has not happened yet.

This cost a long diagnosis on 2026-08-09. `sleep.spec.ts` signed a child in on `/attendance`
and went straight to `/sleep`, which reads the server; the trace showed `POST
/rest/v1/attendance_events` with **status -1, aborted by the navigation**. Standalone the
POST won the race and the spec passed; behind a longer suite the database was slower and it
lost, and the failure surfaced on the sleep register — a page with nothing wrong with it.

So a test that signs a child in and then asserts anything server-side must **wait for the
write**, not for the row:

```ts
const landed = page.waitForResponse(
  (r) => r.url().includes('/rest/v1/attendance_events') && r.request().method() === 'POST',
);
await page.getByRole('button', { name: new RegExp(`^Sign in ${t.childName}`) }).click();
await expect(arrived).toBeVisible();   // the local queue took it
expect((await landed).ok()).toBe(true); // and so did the server
```

There is a product question left open rather than answered: the unsent-work strip lives on
the roll only, so an educator who signs a child in and walks to the sleep register sees no
indication that the write is still queued. Small, and not worth a cross-page banner until
somebody hits it — recorded so the next person does not rediscover it as a bug.

### What the drill covers, and what it does not

`npm run drill:offline` replays exactly what the outbox does — keys fixed up front, reused on
retry, a flush repeated — against the real database through the same `recordAttendance` the
app calls. 10/10 as at 2026-08-11, including that the times survived the outage and that two
clients agree.

**It does not exercise `expo-sqlite`.** A real airplane-mode drill on a tablet is still
required. See [[unverified-claims]].

### It no longer needs anybody's password, 2026-08-11

The drill signed in as a named person and demanded `ECE_DRILL_PASSWORD`. That made it
**unrunnable by anybody who is not them** — Supabase stores `auth.users.encrypted_password` as a
bcrypt hash and no key, service role or PAT returns it, so the credential can only be reset,
never recovered. It also could never have run in CI, which is most of what a drill is for, and it
would break silently the day that password changed.

It provisions its own account now: a `.invalid` address that cannot receive mail (RFC 2606, the
convention `seed-demo.ts` already uses), an **educator** membership on the demo centre, and a
fresh random password set per run and stored nowhere. `ECE_DRILL_PASSWORD` and `ECE_DRILL_EMAIL`
still override for anybody wanting to drill as a real person. Educator rather than owner, because
`recordDailyPractice` is everything the drill exercises and a drill account with more rights than
the act it drills is a standing invitation.

**A defect the change surfaced, worth knowing before anybody debugs it again.** The second-device
client called `signInWithPassword` and never checked the error, so a stale credential left it
*anonymous* — and the failure appeared three lines later as
`permission denied for table staff_count_events`. That reads like an RLS defect and is nothing of
the kind: `anon` has `revoke all` on that table, so the **grant** refuses before any policy is
consulted and the message never mentions sign-in. Anybody meeting it would start by reading 0010
and find nothing wrong there.

### WAL, and why

`pragma journal_mode = WAL` so a flush reading the queue never blocks a sign-in writing to
it. An educator tapping during a flush must not see a lock.

## See Also

- [[attendance-and-ratios]] — what is queued, and the idempotency contract
- [[unverified-claims]] — the missing device drill
- [[conventions]]

*Last updated: 2026-08-11 (the drill no longer needs a human credential)*
