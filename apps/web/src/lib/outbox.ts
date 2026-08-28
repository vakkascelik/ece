import { classifyWriteFailure } from '@ece/core';
import { recordAttendance, type Db } from '@ece/api';
import { OUTBOX_EVENT, type OutboxEntry } from './outboxStore';

/**
 * The outbox's sending half.
 *
 * Re-exports the storage half so existing importers are untouched — `RollClient` wants
 * both and always did. Anything that only needs to *read* the queue should import
 * `./outboxStore` directly: this module reaches `@supabase/supabase-js`, which is not a
 * dependency a component living in a layout should hold statically. See the header of
 * `outboxStore.ts` — including the measurement showing the current bundle overage is
 * pre-existing and is NOT caused by this.
 */

export * from './outboxStore';

const KEY = 'ece.outbox.attendance';

function read(): OutboxEntry[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

function write(entries: OutboxEntry[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Storage full or blocked. Nothing useful to do here; the roll still shows the tap.
  }
  window.dispatchEvent(new Event(OUTBOX_EVENT));
}

const mine = (userId: string) => (e: OutboxEntry) => e.userId === userId;

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
