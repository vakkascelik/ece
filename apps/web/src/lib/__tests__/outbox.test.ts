import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@ece/api';
import { discardDead, enqueue, flush, pending, snapshot } from '../outbox';

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
    const entry = enqueue({ childId: 'c1', kind: 'in' });
    const at = new Date(entry.at).getTime();
    expect(at).toBeGreaterThanOrEqual(before - 1000);
    expect(at).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it('reuses the same client_uuid across attempts, which is what makes a retry safe', async () => {
    const entry = enqueue({ childId: 'c1', kind: 'in' });
    const keys: unknown[] = [];
    const db = dbReturning((_n, row) => {
      keys.push(row.client_uuid);
      return { error: { message: 'TypeError: Failed to fetch' } };
    });

    await flush(db);
    await flush(db);

    expect(keys).toEqual([entry.clientUuid, entry.clientUuid]);
    // Still queued: a transient failure is not a refusal.
    expect(pending()).toHaveLength(1);
    expect(pending()[0].attempts).toBe(2);
  });

  it('drops an entry the server reports as already landed', async () => {
    enqueue({ childId: 'c1', kind: 'in' });
    // No rows back: `ignoreDuplicates` swallowed the conflict, so this exact event exists.
    const db = dbReturning(() => ({ rows: [] }));

    const result = await flush(db);
    expect(result.sent).toBe(1);
    expect(pending()).toHaveLength(0);
  });

  it('kills an entry the server will never accept, so it stops blocking the queue', async () => {
    enqueue({ childId: 'c1', kind: 'in' });
    enqueue({ childId: 'c2', kind: 'in' });

    const db = dbReturning((n) =>
      n === 1
        ? { error: { message: 'violates check constraint "attendance_not_ancient"' } }
        : {},
    );

    const result = await flush(db);
    expect(result.died).toBe(1);
    expect(result.sent).toBe(1);

    // A dead entry is not "pending" — it must not hold sign-out hostage forever.
    expect(pending()).toHaveLength(0);
    expect(snapshot()).toEqual({ unsent: 0, dead: 1 });
  });

  it('retries a future-dated event rather than killing it, because a clock can be fixed', async () => {
    enqueue({ childId: 'c1', kind: 'in' });
    const db = dbReturning(() => ({
      error: { message: 'violates check constraint "attendance_not_future"' },
    }));

    const result = await flush(db);
    expect(result.died).toBe(0);
    expect(result.failed).toBe(1);
    expect(snapshot()).toEqual({ unsent: 1, dead: 0 });
  });

  it('does not retry a dead entry on the next flush', async () => {
    enqueue({ childId: 'c1', kind: 'in' });
    let attempts = 0;
    const db = dbReturning(() => {
      attempts += 1;
      return { error: { message: 'permission denied for table attendance_events' } };
    });

    await flush(db);
    await flush(db);
    expect(attempts).toBe(1);
  });

  it('discards only the dead, never the unsent', async () => {
    enqueue({ childId: 'c1', kind: 'in' });
    await flush(dbReturning(() => ({ error: { message: 'permission denied' } })));
    enqueue({ childId: 'c2', kind: 'out' });

    expect(snapshot()).toEqual({ unsent: 1, dead: 1 });
    discardDead();
    expect(snapshot()).toEqual({ unsent: 1, dead: 0 });
  });

  it('survives a corrupt store rather than taking the roll down', () => {
    window.localStorage.setItem('ece.outbox.attendance', 'not json');
    expect(pending()).toEqual([]);
    expect(snapshot()).toEqual({ unsent: 0, dead: 0 });
  });

  it('does nothing when the queue is empty', async () => {
    const db = dbReturning(() => {
      throw new Error('should not have been called');
    });
    expect(await flush(db)).toEqual({ sent: 0, failed: 0, died: 0 });
  });
});
