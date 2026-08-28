import type { AttendanceKind, QueuedAttendance } from '@ece/core';

/**
 * The outbox's storage half: localStorage, and nothing else.
 *
 * SPLIT OUT OF `outbox.ts` SO WATCHING THE QUEUE COSTS NOTHING.
 *
 * `flush` needs `recordAttendance` from `@ece/api`, which reaches
 * `@supabase/supabase-js`. That was contained while the only importer was `RollClient`
 * — one route's chunk. `SyncStatus` sits in `(app)/layout.tsx` so the queue is visible
 * on every screen, and a component in a layout is the one place a heavy static import
 * is guaranteed to be paid for on the first paint of every page, login included.
 *
 * MEASURED, NOT ASSUMED, AND THE FIRST MEASUREMENT SAID THE OPPOSITE OF WHAT I EXPECTED.
 *
 * `check:bundle` reported apps/web at 113.0kB against a 106kB budget with the static
 * import in place — and reported exactly 113.0kB with it removed, and again on a clean
 * checkout of `main` with none of this work applied. The overage is pre-existing and
 * has nothing to do with this component; Next was already splitting the layout's client
 * chunk such that the import did not land in first-load.
 *
 * The split stays anyway, because it is correct by construction rather than by accident
 * of what the bundler chose to do: reading the queue genuinely imports nothing at
 * runtime — every value below is a string, a localStorage call, or a type that erases —
 * and sending it genuinely does. Relying on the bundler to keep making the same choice
 * is not a property anybody can assert.
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

export function discardDead(userId: string): void {
  // Only this person's dead entries. Another educator's stuck record is not this person's to
  // discard, and it stays for them to deal with.
  write(read().filter((e) => e.deadAt === null || e.userId !== userId));
}
