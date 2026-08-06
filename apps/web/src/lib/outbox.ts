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
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Set when the server refused it in a way retrying cannot fix. */
  deadAt: string | null;
}

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
export function pending(): OutboxEntry[] {
  return read().filter((e) => e.deadAt === null);
}

export function deadEntries(): OutboxEntry[] {
  return read().filter((e) => e.deadAt !== null);
}

/** The shape `describeSignOut` in `@ece/core` wants. */
export function snapshot(): { unsent: number; dead: number } {
  const all = read();
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
export function enqueue(input: { childId: string; kind: AttendanceKind }): OutboxEntry {
  const entry: OutboxEntry = {
    clientUuid: crypto.randomUUID(),
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
 * Try to send everything queued.
 *
 * Sequential rather than parallel: these are events about the same room and the database
 * orders them by their own `at`, but a burst of parallel inserts against a flaky connection
 * turns one failure into several and multiplies the retries. Nothing here is fast enough to
 * matter — the tap already returned.
 */
export async function flush(db: Db): Promise<FlushResult> {
  const all = read();
  const result: FlushResult = { sent: 0, failed: 0, died: 0 };
  if (all.length === 0) return result;

  const keep: OutboxEntry[] = [];

  for (const entry of all) {
    if (entry.deadAt !== null) {
      keep.push(entry);
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
        keep.push({
          ...entry,
          attempts: entry.attempts + 1,
          lastError: message,
          deadAt: new Date().toISOString(),
        });
        result.died += 1;
      } else {
        keep.push({ ...entry, attempts: entry.attempts + 1, lastError: message });
        result.failed += 1;
      }
    }
  }

  write(keep);
  return result;
}

/**
 * Forget the dead entries.
 *
 * Only the dead. There is no "clear the queue" here on purpose: the unsent entries are the
 * only record that children are in a building, and a function that discards them would
 * eventually be called by something trying to be helpful.
 */
export function discardDead(): void {
  write(read().filter((e) => e.deadAt === null));
}
