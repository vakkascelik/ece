import { classifyWriteFailure, type AttendanceKind, type QueuedAttendance } from '@ece/core';
import { recordAttendance, type Db } from '@ece/api';

/**
 * The web outbox.
 *
 * WHY THE WEB APP NEEDS ONE AT ALL
 *
 * Because the same build runs on a tablet bolted to the wall by the door, and that tablet
 * loses wifi. Until now a sign-in made while it was down simply failed: the tap errored, the
 * child was on nobody's roll, and the ratio counted one fewer person than the room held —
 * wrong in the dangerous direction. `attendance/actions.ts` used to justify having no queue
 * with "there is no offline gap to preserve, unlike on a tablet". The tablet *is* this app.
 *
 * SAME CONTRACT AS `apps/mobile/lib/outbox.ts`, DELIBERATELY
 *
 * Different storage, identical rules, because these are the rules that make a queue safe and
 * they were learned once already:
 *
 * 1. **The key is generated once, at enqueue** — never per attempt. `client_uuid` is what
 *    makes a retry a no-op instead of a second sign-in. A unique violation on it means the
 *    write already landed, so it is treated as success, not as an error.
 * 2. **A permanently refused write is not retried forever.** `classifyWriteFailure` reads the
 *    Postgres error; a dead entry stops blocking everything behind it.
 * 3. **Queued events count toward the ratio.** `buildRoll` in `@ece/core` does that merge, and
 *    it is the reason the ratio is computed on the client here rather than on the server.
 *
 * WHY localStorage AND NOT IndexedDB
 *
 * The queue holds attendance events — roughly 150 bytes each, a few dozen at worst on the
 * worst morning. IndexedDB buys asynchronous access and a schema for a payload that fits in a
 * fraction of a percent of the 5MB localStorage budget, at the cost of a wrapper nobody would
 * enjoy reading. If this ever queues media, that trade changes.
 *
 * It is synchronous, which is a feature here: the roll re-renders from the queue in the same
 * tick as the tap, so the row shows its chip immediately.
 */

const KEY = 'ece.outbox.attendance';
/** Fired on the window so every component reading the queue re-renders together. */
export const OUTBOX_EVENT = 'ece:outbox';

export interface OutboxEntry extends QueuedAttendance {
  /**
   * WHO MADE THIS TAP. Every read and every write is scoped to it.
   *
   * `recordAttendance` stamps `recorded_by` from `auth.uid()` at **flush time**, not at enqueue
   * time, and that single fact decides the whole shared-tablet story. Without this field: leave
   * educator A's three queued sign-ins on the tablet by the door, let B sign in, and **B's token
   * flushes A's observations** — recorded as B, in a table with no UPDATE grant for anybody, so the
   * misattribution is permanent. A's queue also counted into B's ratio, because `pending()` returned
   * everything in the browser.
   *
   * `llm-wiki/wiki/offline-outbox.md` has described this scoping as a property of the outbox since
   * the mobile queue was built. It was true of mobile and **not** of this one — on the app that
   * actually runs on the tablet by the door, which is the argument that justified building a web
   * outbox at all.
   *
   * An entry written by the previous build has no `userId` and therefore matches nobody, so it sits
   * inert. Acceptable rather than migrated: the web outbox shipped a day before this fix and nobody
   * has used the product — there are no child records in any centre. Inventing a migration for data
   * that does not exist would be the worse choice.
   */
  userId: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Set when the server refused it in a way retrying cannot fix. */
  deadAt: string | null;
}

/** Scoping predicate, in one place so no reader can forget it. */
const mine = (userId: string) => (e: OutboxEntry) => e.userId === userId;

function read(): OutboxEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as OutboxEntry[]) : [];
  } catch {
    // A corrupt or quota-blocked store must not take the roll down with it. An unreadable
    // queue is treated as empty rather than thrown, because the roll still has to render.
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* Private mode, or the quota is gone. Nothing useful to do from here. */
  }
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

/** Everything still worth showing on the roll — dead entries are not pending, they are stuck. */
export function pending(userId: string): OutboxEntry[] {
  return read().filter(mine(userId)).filter((e) => e.deadAt === null);
}

export function deadEntries(userId: string): OutboxEntry[] {
  return read().filter(mine(userId)).filter((e) => e.deadAt !== null);
}

/** The shape `describeSignOut` in `@ece/core` wants. */
export function snapshot(userId: string): { unsent: number; dead: number } {
  const all = read().filter(mine(userId));
  return {
    unsent: all.filter((e) => e.deadAt === null).length,
    dead: all.filter((e) => e.deadAt !== null).length,
  };
}

/**
 * Record a sign-in or sign-out locally.
 *
 * `at` is stamped here, at the moment of the tap, and never at flush time. The whole point of
 * a queue is that the time survives the gap — a child who arrived at 8:05 did not arrive when
 * the wifi came back at 9:20, and attendance times decide funded hours.
 */
export function enqueue(input: {
  childId: string;
  kind: AttendanceKind;
  userId: string;
}): OutboxEntry {
  const entry: OutboxEntry = {
    clientUuid: crypto.randomUUID(),
    userId: input.userId,
    childId: input.childId,
    kind: input.kind,
    at: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    deadAt: null,
  };
  write([...read(), entry]);
  return entry;
}

export interface FlushResult {
  sent: number;
  failed: number;
  died: number;
}

/**
 * Apply the outcomes of one flush to whatever is in the store *now*.
 *
 * THIS IS THE FIX FOR A LOST SIGN-IN, and the reason it is not just `write(keep)`.
 *
 * `flush` reads a snapshot, awaits the network per entry, then writes. The old code wrote the
 * snapshot's survivors back wholesale, which silently erased anything enqueued during that window:
 *
 *   08:00:00  flush A starts, snapshot [a], POST for `a` in flight on a slow connection
 *   08:00:02  educator taps "Sign in Ben" -> store is [a, b]; flush B starts, snapshot [a, b]
 *   08:00:03  wifi drops; flush B's attempts both fail transiently; it writes [a, b]
 *   08:00:08  flush A's already-delivered POST for `a` returns ok; its `keep` is [] -> writes []
 *
 * Ben's sign-in is gone from localStorage, was never sent, his row reads "Not signed in", the
 * pending count is 0 so nothing is shown and sign-out is not blocked. A child who is in the room is
 * on nobody's roll and out of the ratio — precisely what the queue exists to prevent. A dead-letter
 * recorded by the concurrent flush disappears the same way.
 *
 * Re-reading at commit time fixes it for any interleaving, which matters more than it sounds: the
 * reentrancy guard below cannot help across TABS, and localStorage is shared between them. Two open
 * copies of the roll on one tablet is an ordinary thing.
 *
 * Mobile never had this bug because it mutates SQLite row by row —
 * `delete from outbox where client_uuid = ?` — rather than rewriting the whole queue.
 *
 * `null` in the map means "sent, drop it"; an entry means "replace it with this".
 *
 * WHAT THIS STILL DOES NOT FIX, stated rather than implied: `enqueue` is itself a read-then-write.
 * Within one tab that is synchronous and therefore atomic, but two tabs enqueuing in the same
 * instant can still lose one, because localStorage has no transaction. That needs a lock and is not
 * this function's job.
 */
function commit(handled: Map<string, OutboxEntry | null>): void {
  const current = read();
  const next: OutboxEntry[] = [];

  for (const entry of current) {
    if (!handled.has(entry.clientUuid)) {
      // Enqueued while this flush was in the air, or already updated by another one. Untouched.
      next.push(entry);
      continue;
    }
    const replacement = handled.get(entry.clientUuid) ?? null;
    if (replacement !== null) next.push(replacement);
  }

  write(next);
}

/*
 * One flush at a time, and never a dropped request.
 *
 * `RollClient` fires `void send()` on every tap, so overlapping flushes were the normal case rather
 * than an edge. Returning early without remembering the request would leave the newest entry
 * unsent until something else happened to trigger a flush — so a request that arrives mid-flight
 * sets `again`, and the in-flight run loops once more before finishing.
 *
 * Module-level rather than per-call: the point is that there is one queue.
 */
let inFlight: Promise<FlushResult> | null = null;
let again = false;

/**
 * Try to send everything queued.
 *
 * Sequential rather than parallel: these are events about the same room and the database
 * orders them by their own `at`, but a burst of parallel inserts against a flaky connection
 * turns one failure into several and multiplies the retries. Nothing here is fast enough to
 * matter — the tap already returned.
 */
export async function flush(db: Db, userId: string): Promise<FlushResult> {
  if (inFlight) {
    again = true;
    return inFlight;
  }

  inFlight = (async () => {
    const total: FlushResult = { sent: 0, failed: 0, died: 0 };
    do {
      again = false;
      const round = await flushOnce(db, userId);
      total.sent += round.sent;
      total.failed += round.failed;
      total.died += round.died;
      // A tap that landed mid-flight is picked up here rather than waiting for the next trigger.
    } while (again);
    return total;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
    again = false;
  }
}

async function flushOnce(db: Db, userId: string): Promise<FlushResult> {
  /*
   * Only this person's rows. Somebody else's wait for them: nobody inherits anything and nobody
   * discards anything, which is what turns "do we throw away A's work when A signs out?" from a
   * policy question into a non-question.
   */
  const all = read().filter(mine(userId));
  const result: FlushResult = { sent: 0, failed: 0, died: 0 };
  if (all.length === 0) return result;

  // Keyed by `clientUuid` so the outcomes can be applied to the store as it is at commit time
  // rather than to the snapshot this loop started from.
  const handled = new Map<string, OutboxEntry | null>();

  for (const entry of all) {
    if (entry.deadAt !== null) {
      // Left exactly as it is. `discardDead` is the only thing that removes these.
      handled.set(entry.clientUuid, entry);
      continue;
    }

    try {
      await recordAttendance(db, {
        childId: entry.childId,
        kind: entry.kind,
        at: entry.at,
        // Reused, not regenerated. This is the property that makes a retry safe.
        clientUuid: entry.clientUuid,
      });
      handled.set(entry.clientUuid, null);
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      /*
        A unique violation on `client_uuid` means a previous attempt already landed and we
        never saw the acknowledgement. That is success, not failure — dropping the entry is
        correct and retrying it forever would be the bug. `classifyWriteFailure` deliberately
        omits 23505 from every list for this reason.
      */
      if (/\b23505\b/.test(message) || /duplicate key/i.test(message)) {
        result.sent += 1;
        continue;
      }

      const verdict = classifyWriteFailure(message);
      if (verdict === 'permanent') {
        handled.set(entry.clientUuid, {
          ...entry,
          attempts: entry.attempts + 1,
          lastError: message,
          deadAt: new Date().toISOString(),
        });
        result.died += 1;
      } else {
        handled.set(entry.clientUuid, { ...entry, attempts: entry.attempts + 1, lastError: message });
        result.failed += 1;
      }
    }
  }

  commit(handled);
  return result;
}

/**
 * Forget the dead entries.
 *
 * Only the dead. There is no "clear the queue" here on purpose: the unsent entries are the
 * only record that children are in a building, and a function that discards them would
 * eventually be called by something trying to be helpful.
 */
export function discardDead(userId: string): void {
  // Only this person's dead entries. Another educator's stuck record is not this person's to
  // discard, and it stays for them to deal with.
  write(read().filter((e) => e.deadAt === null || e.userId !== userId));
}
