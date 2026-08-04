import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { recordAdultsPresent, recordAttendance, type AttendanceKind, type Db } from '@ece/api';

/**
 * The offline outbox.
 *
 * A sign-in made in the carpark with no signal has to survive, arrive once, and keep
 * the time it actually happened. That is the whole job.
 *
 * WHY THIS RATHER THAN A SYNC ENGINE
 *
 * PowerSync, ElectricSQL and WatermelonDB all solve a harder problem than this one:
 * bidirectional sync with conflict resolution. Attendance is append-only, so there
 * are no conflicts to resolve — two tablets in the same room cannot disagree about
 * whether a child arrived, only about the order events are written in, and the
 * database orders them. A queue of pending inserts is the entire requirement, and it
 * costs a table rather than a dependency, a service and a set of conflict semantics
 * to reason about.
 *
 * THE THREE PROPERTIES THAT MATTER
 *
 * 1. **The key is generated once, at enqueue.** Never per attempt. `client_uuid` is
 *    what makes a retry a no-op instead of a second sign-in, and regenerating it on
 *    retry is exactly the bug it exists to prevent.
 *
 * 2. **A permanently rejected write is not retried forever.** A queue that keeps
 *    re-sending something the server will always refuse is a stuck queue, and it
 *    blocks everything behind it. Postgres tells us which kind of failure it was;
 *    see `isPermanent`.
 *
 * 3. **Queued events count toward the ratio.** Not a UI nicety. If an offline
 *    sign-in is invisible to the ratio, an educator sees a lower child count than the
 *    room contains — wrong in the dangerous direction. `pendingAttendance()` is read
 *    alongside the server state for exactly this.
 */

const DB_NAME = 'ece-outbox.db';

export type OutboxKind = 'attendance' | 'adults';

export interface OutboxEntry {
  clientUuid: string;
  kind: OutboxKind;
  /** JSON. Shape depends on `kind`. */
  payload: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  /** Set when the server refused it in a way retrying cannot fix. */
  deadAt: string | null;
}

export interface AttendancePayload {
  childId: string;
  kind: AttendanceKind;
  at: string;
}

export interface AdultsPayload {
  centreId: string;
  adults: number;
  at: string;
}

let handle: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (handle) return handle;
  handle = await SQLite.openDatabaseAsync(DB_NAME);
  // WAL so a flush reading the queue does not block a sign-in writing to it. An
  // educator tapping during a flush must never see a lock.
  await handle.execAsync('pragma journal_mode = WAL;');
  await handle.execAsync(`
    create table if not exists outbox (
      client_uuid text primary key not null,
      kind        text not null,
      payload     text not null,
      created_at  text not null,
      attempts    integer not null default 0,
      last_error  text,
      dead_at     text
    );
  `);
  return handle;
}

/**
 * Queue a write and return immediately.
 *
 * Returns the `client_uuid` so the caller can show the event optimistically and
 * match it up later. Nothing here waits on the network: the point is that tapping
 * "sign in" is instant whether there is signal or not.
 */
export async function enqueue(
  kind: OutboxKind,
  payload: AttendancePayload | AdultsPayload,
): Promise<string> {
  const clientUuid = randomUUID();
  const conn = await db();
  await conn.runAsync(
    'insert into outbox (client_uuid, kind, payload, created_at) values (?, ?, ?, ?)',
    clientUuid,
    kind,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
  return clientUuid;
}

/** Everything still waiting, oldest first. Dead entries included so they can be shown. */
export async function pending(): Promise<OutboxEntry[]> {
  const conn = await db();
  const rows = await conn.getAllAsync<{
    client_uuid: string;
    kind: string;
    payload: string;
    created_at: string;
    attempts: number;
    last_error: string | null;
    dead_at: string | null;
  }>('select * from outbox order by created_at');
  return rows.map((r) => ({
    clientUuid: r.client_uuid,
    kind: r.kind as OutboxKind,
    payload: r.payload,
    createdAt: r.created_at,
    attempts: r.attempts,
    lastError: r.last_error,
    deadAt: r.dead_at,
  }));
}

/**
 * Queued attendance, parsed, excluding dead entries.
 *
 * Read by the roll so a child signed in offline shows as present and is counted in
 * the ratio. Dead entries are excluded because they will never land — showing a child
 * as present on the strength of a write the server has refused would be worse than
 * showing them absent.
 */
export async function pendingAttendance(): Promise<(AttendancePayload & { clientUuid: string })[]> {
  const all = await pending();
  return all
    .filter((e) => e.kind === 'attendance' && !e.deadAt)
    .map((e) => ({ clientUuid: e.clientUuid, ...(JSON.parse(e.payload) as AttendancePayload) }));
}

export interface FlushReport {
  sent: number;
  /** Already on the server. Counted separately because it is the retry path working. */
  duplicates: number;
  /** Left queued — no signal, or the server was unreachable. */
  deferred: number;
  /** Refused in a way retrying cannot fix. Needs a person. */
  dead: number;
}

/**
 * Postgres error codes that will never succeed on retry.
 *
 * The distinction is the difference between a queue that drains and a queue that
 * jams. A check violation — an event that has aged past the 14-day window while the
 * device was in a drawer — is permanent, and re-sending it every thirty seconds
 * forever accomplishes nothing except keeping newer events behind it.
 *
 * `23505` is deliberately absent: a unique violation on `client_uuid` means the event
 * is already there, which is success, and the API layer reports it as a duplicate
 * rather than an error.
 */
function isPermanent(message: string): boolean {
  return (
    /\b23514\b/.test(message) || // check_violation — outside the allowed time window
    /\b42501\b/.test(message) || // insufficient_privilege — no longer a member, or revoked
    /\b23503\b/.test(message) || // foreign_key_violation — the child was archived or purged
    /\b22P02\b/.test(message) || // invalid_text_representation — a malformed payload
    /violates check constraint/i.test(message) ||
    /permission denied/i.test(message)
  );
}

/**
 * Try to send everything queued.
 *
 * Stops at the first *transient* failure rather than grinding through the whole queue
 * offline: if one write failed because there is no signal, the next will too, and
 * twenty pointless attempts drain the battery and inflate the attempt counters.
 * Permanent failures do not stop the run — they are set aside and the queue keeps
 * draining behind them.
 */
export async function flush(client: Db): Promise<FlushReport> {
  const conn = await db();
  const report: FlushReport = { sent: 0, duplicates: 0, deferred: 0, dead: 0 };

  for (const entry of await pending()) {
    if (entry.deadAt) {
      report.dead += 1;
      continue;
    }

    try {
      if (entry.kind === 'attendance') {
        const p = JSON.parse(entry.payload) as AttendancePayload;
        const result = await recordAttendance(client, {
          childId: p.childId,
          kind: p.kind,
          at: p.at,
          // The key from the queue, never a fresh one. This is the whole contract.
          clientUuid: entry.clientUuid,
        });
        if (result.outcome === 'duplicate') report.duplicates += 1;
        else report.sent += 1;
      } else {
        const p = JSON.parse(entry.payload) as AdultsPayload;
        const outcome = await recordAdultsPresent(client, {
          centreId: p.centreId,
          adults: p.adults,
          at: p.at,
          clientUuid: entry.clientUuid,
        });
        if (outcome === 'duplicate') report.duplicates += 1;
        else report.sent += 1;
      }

      // Landed, or already there. Either way it is done.
      await conn.runAsync('delete from outbox where client_uuid = ?', entry.clientUuid);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (isPermanent(message)) {
        await conn.runAsync(
          'update outbox set attempts = attempts + 1, last_error = ?, dead_at = ? where client_uuid = ?',
          message.slice(0, 500),
          new Date().toISOString(),
          entry.clientUuid,
        );
        report.dead += 1;
        continue;
      }

      await conn.runAsync(
        'update outbox set attempts = attempts + 1, last_error = ? where client_uuid = ?',
        message.slice(0, 500),
        entry.clientUuid,
      );
      report.deferred += 1;
      // No signal means no signal for the rest of the queue too.
      break;
    }
  }

  return report;
}

/**
 * Discard a dead entry.
 *
 * Requires a person, and it is the only way anything leaves this queue unsent. The
 * alternative — dropping refused writes silently — means attendance quietly going
 * missing, which is the one failure this whole mechanism exists to prevent.
 */
export async function discard(clientUuid: string): Promise<void> {
  const conn = await db();
  await conn.runAsync('delete from outbox where client_uuid = ? and dead_at is not null', clientUuid);
}

/** For the offline drill in the test plan, and for signing out on a shared tablet. */
export async function clearAll(): Promise<void> {
  const conn = await db();
  await conn.runAsync('delete from outbox');
}
