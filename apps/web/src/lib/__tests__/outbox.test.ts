import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@ece/api';
import { deadEntries, discardDead, enqueue, flush, pending, snapshot } from '../outbox';

/** The signed-in educator for most of these tests. Every read and write is scoped to a person. */
const ME = 'educator-a';

/**
 * The web outbox, tested where the mobile one cannot be: `expo-sqlite` needs a device, this
 * needs a Map. So the properties that make a queue safe are asserted on this side even though
 * both apps depend on the same three — the key is generated once, a permanent refusal stops
 * being retried, and an already-landed write is not sent twice.
 */

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

/**
 * A stand-in shaped like the calls `recordAttendance` actually makes:
 * `auth.getUser()`, then `from(...).upsert(...).select(...)`.
 *
 * `rows` is what the select returns — an empty array is how PostgREST reports a conflict that
 * `ignoreDuplicates` swallowed, which `recordAttendance` reads as "already landed".
 */
function dbReturning(
  outcome: (attempt: number, row: Record<string, unknown>) => { error?: { message: string }; rows?: unknown[] },
): Db {
  let attempts = 0;
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: () => ({
      upsert: (row: Record<string, unknown>) => {
        attempts += 1;
        const result = outcome(attempts, row);
        return {
          select: async () => ({ data: result.rows ?? [{ id: 1 }], error: result.error ?? null }),
        };
      },
    }),
  } as unknown as Db;
}

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: fakeStorage(), dispatchEvent: () => true });
  vi.stubGlobal('crypto', { randomUUID: () => `uuid-${Math.random().toString(16).slice(2)}` });
});

describe('the web outbox', () => {
  it('stamps the time at the tap, not at the flush', () => {
    const before = Date.now();
    const entry = enqueue({ childId: 'c1', kind: 'in', userId: ME });
    const at = new Date(entry.at).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('reuses the same client_uuid across attempts, which is what makes a retry safe', async () => {
    const entry = enqueue({ childId: 'c1', kind: 'in', userId: ME });
    const keys: unknown[] = [];
    const db = dbReturning((_n, row) => {
      keys.push(row.client_uuid);
      return { error: { message: 'TypeError: Failed to fetch' } };
    });

    await flush(db, ME);
    await flush(db, ME);

    expect(keys).toEqual([entry.clientUuid, entry.clientUuid]);
    // Still queued: a transient failure is not a refusal.
    expect(pending(ME)).toHaveLength(1);
    expect(pending(ME)[0].attempts).toBe(2);
  });

  it('drops an entry the server reports as already landed', async () => {
    enqueue({ childId: 'c1', kind: 'in', userId: ME });
    // No rows back: `ignoreDuplicates` swallowed the conflict, so this exact event exists.
    const db = dbReturning(() => ({ rows: [] }));

    const result = await flush(db, ME);
    expect(result.sent).toBe(1);
    expect(pending(ME)).toHaveLength(0);
  });

  it('kills an entry the server will never accept, so it stops blocking the queue', async () => {
    enqueue({ childId: 'c1', kind: 'in', userId: ME });
    enqueue({ childId: 'c2', kind: 'in', userId: ME });

    const db = dbReturning((n) =>
      n === 1
        ? { error: { message: 'violates check constraint "attendance_not_ancient"' } }
        : {},
    );

    const result = await flush(db, ME);
    expect(result.died).toBe(1);
    expect(result.sent).toBe(1);

    // A dead entry is not "pending" — it must not hold sign-out hostage forever.
    expect(pending(ME)).toHaveLength(0);
    expect(snapshot(ME)).toEqual({ unsent: 0, dead: 1 });
  });

  it('retries a future-dated event rather than killing it, because a clock can be fixed', async () => {
    enqueue({ childId: 'c1', kind: 'in', userId: ME });
    const db = dbReturning(() => ({
      error: { message: 'violates check constraint "attendance_not_future"' },
    }));

    const result = await flush(db, ME);
    expect(result.died).toBe(0);
    expect(result.failed).toBe(1);
    expect(snapshot(ME)).toEqual({ unsent: 1, dead: 0 });
  });

  it('does not retry a dead entry on the next flush', async () => {
    enqueue({ childId: 'c1', kind: 'in', userId: ME });
    let attempts = 0;
    const db = dbReturning(() => {
      attempts += 1;
      return { error: { message: 'permission denied for table attendance_events' } };
    });

    await flush(db, ME);
    await flush(db, ME);
    expect(attempts).toBe(1);
  });

  it('discards only the dead, never the unsent', async () => {
    enqueue({ childId: 'c1', kind: 'in', userId: ME });
    await flush(dbReturning(() => ({ error: { message: 'permission denied' } })), ME);
    enqueue({ childId: 'c2', kind: 'out', userId: ME });

    expect(snapshot(ME)).toEqual({ unsent: 1, dead: 1 });
    discardDead(ME);
    expect(snapshot(ME)).toEqual({ unsent: 1, dead: 0 });
  });

  it('survives a corrupt store rather than taking the roll down', () => {
    window.localStorage.setItem('ece.outbox.attendance', 'not json');
    expect(pending(ME)).toEqual([]);
    expect(snapshot(ME)).toEqual({ unsent: 0, dead: 0 });
  });

  it('does nothing when the queue is empty', async () => {
    const db = dbReturning(() => {
      throw new Error('should not have been called');
    });
    expect(await flush(db, ME)).toEqual({ sent: 0, failed: 0, died: 0 });
  });
});

/**
 * The interleaving that lost a child's sign-in.
 *
 * `flush` read a snapshot, awaited the network, then wrote the snapshot's survivors back wholesale
 * — erasing anything enqueued during that window. The queue exists so that a sign-in made with the
 * wifi down survives; this is the case where it silently did not.
 *
 * Every earlier test in this file awaits one flush at a time, which is exactly why none of them
 * could see it.
 *
 * Note what is NOT simulated with two concurrent `flush()` calls: the reentrancy guard makes the
 * second call await the first, which is the guard doing its job. The interleaving that remains
 * possible is a **second tab** — localStorage is shared between them, and two open copies of the
 * roll on one tablet is ordinary. A second tab enqueuing is a synchronous read-then-write against
 * the same store, which is precisely what `enqueue()` does here while a flush is in the air.
 */
describe('a write that lands while a flush is in the air', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: () => true });
    vi.stubGlobal('localStorage', storage);
  });

  /** A db whose request for `holdUuid` hangs until released; everything else succeeds. */
  function heldDb(holdUuid: () => string) {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const db = {
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
      from: () => ({
        upsert: (row: Record<string, unknown>) => ({
          select: async () => {
            if (row.client_uuid === holdUuid()) await held;
            return { data: [{ id: 1 }], error: null };
          },
        }),
      }),
    } as unknown as Db;
    return { db, release: () => release() };
  }

  it('keeps a sign-in enqueued by another tab while the first flush is still waiting', async () => {
    const ana = enqueue({ childId: 'ana', kind: 'in', userId: ME });
    const { db, release } = heldDb(() => ana.clientUuid);

    // Flush starts on the snapshot [ana] and blocks inside the network call.
    const inAir = flush(db, ME);
    await Promise.resolve();

    // Another tab signs Ben in. Same store, synchronous read-then-write.
    const ben = enqueue({ childId: 'ben', kind: 'in', userId: ME });
    expect(pending(ME)).toHaveLength(2);

    // Ana's request completes. Under the old code the flush wrote its own survivors — [] — and
    // Ben's sign-in disappeared: no error, no pending chip, his row back to "Not signed in", and a
    // child in the room off the roll and out of the ratio.
    release();
    await inAir;

    const left = pending(ME);
    expect(left.map((e) => e.childId)).toEqual(['ben']);
    expect(left[0]?.clientUuid).toBe(ben.clientUuid);
  });

  it('keeps a dead-letter that was already in the store', async () => {
    // A permanently-refused write has to stay visible so somebody deals with it. Losing it means
    // nobody ever finds out.
    const doomed = enqueue({ childId: 'doomed', kind: 'in', userId: ME });
    await flush(dbReturning(() => ({ error: { message: 'permission denied (42501)' } })), ME);
    expect(snapshot(ME)).toEqual({ unsent: 0, dead: 1 });

    const ana = enqueue({ childId: 'ana', kind: 'in', userId: ME });
    const { db, release } = heldDb(() => ana.clientUuid);
    const inAir = flush(db, ME);
    await Promise.resolve();
    enqueue({ childId: 'ben', kind: 'in', userId: ME });
    release();
    await inAir;

    expect(snapshot(ME)).toEqual({ unsent: 1, dead: 1 });
    expect(deadEntries(ME)[0]?.clientUuid).toBe(doomed.clientUuid);
    expect(pending(ME)[0]?.childId).toBe('ben');
  });

  it('does not drop a flush requested while one is already running', async () => {
    /*
     * `RollClient` fires a flush on every tap, so overlapping requests are the normal case. The
     * guard returns the in-flight promise instead of starting a second run — but it must also
     * remember that it was asked, or the entry enqueued by that tap sits unsent until something
     * else happens to trigger a flush.
     */
    const ana = enqueue({ childId: 'ana', kind: 'in', userId: ME });
    const { db, release } = heldDb(() => ana.clientUuid);

    const first = flush(db, ME);
    await Promise.resolve();

    // The tap: enqueue, then ask for a flush while one is running.
    enqueue({ childId: 'ben', kind: 'in', userId: ME });
    const second = flush(db, ME);

    release();
    const result = await first;
    await second;

    // Both were sent, by two rounds of the same in-flight run.
    expect(result.sent).toBe(2);
    expect(pending(ME)).toHaveLength(0);
  });
});

/**
 * The shared tablet, which is what the web app actually is: the thing by the door.
 *
 * `recordAttendance` stamps `recorded_by` from `auth.uid()` at FLUSH time, not at enqueue time. So
 * without scoping, educator A's queued sign-ins are sent under whoever is signed in when the wifi
 * returns — recorded as them, in a table with no UPDATE grant for anybody, so the misattribution is
 * permanent.
 *
 * `llm-wiki/wiki/offline-outbox.md` has described this scoping as a property of the outbox since the
 * mobile queue was built. It was true of mobile and not of this one.
 */
describe('two people, one tablet', () => {
  const A = 'educator-a';
  const B = 'educator-b';

  beforeEach(() => {
    const storage = fakeStorage();
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: () => true });
    vi.stubGlobal('localStorage', storage);
  });

  it('does not show one educator the other’s queue, or count it into their ratio', () => {
    enqueue({ childId: 'ana', kind: 'in', userId: A });
    enqueue({ childId: 'ben', kind: 'in', userId: A });
    enqueue({ childId: 'cara', kind: 'in', userId: B });

    expect(pending(A).map((e) => e.childId)).toEqual(['ana', 'ben']);
    expect(pending(B).map((e) => e.childId)).toEqual(['cara']);
    // The count that reaches the ratio banner and the sign-out guard.
    expect(snapshot(A)).toEqual({ unsent: 2, dead: 0 });
    expect(snapshot(B)).toEqual({ unsent: 1, dead: 0 });
  });

  it('never flushes one educator’s taps under the other’s token', async () => {
    enqueue({ childId: 'ana', kind: 'in', userId: A });
    const sent: string[] = [];
    const db = {
      auth: { getUser: async () => ({ data: { user: { id: B } } }) },
      from: () => ({
        upsert: (row: Record<string, unknown>) => ({
          select: async () => {
            sent.push(String(row.child_id));
            return { data: [{ id: 1 }], error: null };
          },
        }),
      }),
    } as unknown as Db;

    // B signs in on the same tablet and a flush runs. A's row must not go with it.
    await flush(db, B);
    expect(sent).toEqual([]);
    expect(pending(A)).toHaveLength(1);

    // A's own flush sends it, and it is gone.
    await flush(db, A);
    expect(sent).toEqual(['ana']);
    expect(pending(A)).toHaveLength(0);
  });

  it('does not let one educator discard the other’s stuck record', async () => {
    enqueue({ childId: 'doomed-a', kind: 'in', userId: A });
    await flush(dbReturning(() => ({ error: { message: 'permission denied (42501)' } })), A);
    expect(snapshot(A)).toEqual({ unsent: 0, dead: 1 });

    // B signing out must not clear A's dead-letter — it is not theirs to throw away, and A still
    // has to be told about it.
    discardDead(B);
    expect(snapshot(A)).toEqual({ unsent: 0, dead: 1 });

    discardDead(A);
    expect(snapshot(A)).toEqual({ unsent: 0, dead: 0 });
  });

  it('leaves an entry written by the previous build inert rather than adopting it', () => {
    // No `userId`, as written before this fix. It must not be flushed under whoever happens to be
    // signed in. Acceptable to strand because nobody has used the product — there are no child
    // records in any centre — and adopting it is the exact misattribution being fixed.
    // The real key. A first attempt used 'ece.outbox.attendance.v1' and the test passed for the
    // wrong reason — the entry was never in the store, so of course nothing showed it.
    const KEY = 'ece.outbox.attendance';
    localStorage.setItem(
      KEY,
      JSON.stringify([
        {
          clientUuid: 'legacy-1',
          childId: 'legacy',
          kind: 'in',
          at: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          attempts: 0,
          lastError: null,
          deadAt: null,
        },
      ]),
    );
    // Present in the store...
    expect(localStorage.getItem(KEY)).toContain('legacy-1');
    // ...and invisible to everybody, rather than adopted by whoever asks.
    expect(pending(A)).toHaveLength(0);
    expect(snapshot(A)).toEqual({ unsent: 0, dead: 0 });
    expect(pending(B)).toHaveLength(0);
  });
});
