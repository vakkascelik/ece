import { classifyWriteFailure } from '@ece/core';
import { describe, expect, it } from 'vitest';

import { recordAdultsPresent, recordAttendance, type Db } from '../index';

/**
 * The one thing the two outbox writes must get right when they fail.
 *
 * WHY THIS TEST EXISTS
 *
 * `recordAttendance` and `recordAdultsPresent` are the writes behind both offline outboxes.
 * When the server refuses a row, the *only* thing either outbox has to decide with is the
 * message thrown here: `classifyWriteFailure` reads that string and answers `permanent`,
 * `retry-later` or `transient`.
 *
 * `transient` does not mean "try again shortly". It means "the network is down, nothing after
 * this will do better" — so the flush **stops**. A permanent refusal misread as transient
 * therefore does not merely retry one doomed write; it parks the entire queue behind it. On a
 * tablet, that is a roll that silently stops recording sign-ins.
 *
 * Until 2026-09-04 both functions threw `error.message` and discarded `error.code`, and four of
 * the classifier's six rules key on that code. Three of those four have no message-text
 * fallback, so all three were answered `transient`. Measured against live Postgres, not
 * reasoned about — the strings below were read off the database inside a rolled-back
 * transaction:
 *
 *   | refusal                          | code  | before    | after     |
 *   |----------------------------------|-------|-----------|-----------|
 *   | RLS: not a member of the centre  | 42501 | transient | permanent |
 *   | the child was purged (FK)        | 23503 | transient | permanent |
 *   | a malformed uuid                 | 22P02 | transient | permanent |
 *   | the 14-day trigger (0078/0079)   | 23514 | permanent | permanent |
 *
 * The last row is a correction to what I first wrote here: I claimed the 14-day case was the
 * broken one, on the theory that `0078`'s trigger message carried no identifier. It carries
 * one — `0079` exists to put `tg_name` at the front — so that case was always classified
 * correctly. Kept in the table because a test that only covers the three broken cases invites
 * someone to "simplify" the rule that covers the fourth.
 *
 * WHY THE ASSERTIONS ARE ON THE VERDICT, NOT THE STRING
 *
 * Asserting the exact wording would have passed throughout the period the behaviour was wrong —
 * the wording was never the problem. So each test asks the outbox's actual question.
 *
 * WHY A FAKE CLIENT
 *
 * These refusals need conditions a unit suite cannot arrange: a revoked membership mid-session,
 * a row 20 days old, a uuid that got past the type checker. `drill:offline` exercises them
 * against real Postgres and real JWTs; it needs credentials and a network. This runs in
 * `npm test` on every change and pins the contract between the two packages.
 */

/**
 * The smallest thing these functions will accept: an auth stub, and a chain ending in a
 * `PostgrestError`-shaped rejection. Built per test so nothing leaks between them.
 */
function dbFailingWith(error: { message: string; code?: string }): Db {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'stub-user' } } }) },
    from: () => ({
      upsert: () => ({
        select: async () => ({ data: null, error }),
      }),
    }),
  } as unknown as Db;
}

/** Verbatim from Postgres, 2026-09-04. */
const REFUSALS = {
  rls: {
    message: 'new row violates row-level security policy for table "attendance_events"',
    code: '42501',
  },
  purgedChild: {
    message:
      'insert or update on table "attendance_events" violates foreign key constraint "attendance_events_child_id_fkey"',
    code: '23503',
  },
  malformedUuid: { message: 'invalid input syntax for type uuid: "not-a-uuid"', code: '22P02' },
  ancient: {
    message:
      'attendance_not_ancient : row is older than the 14 day window (at on public.attendance_events)',
    code: '23514',
  },
  driftedClock: {
    message:
      'new row for relation "attendance_events" violates check constraint "attendance_not_future"',
    code: '23514',
  },
} as const;

const ATTENDANCE_INPUT = {
  childId: '00000000-0000-0000-0000-000000000001',
  kind: 'in' as const,
  at: '2026-09-04T08:05:00+12:00',
  clientUuid: '11111111-1111-1111-1111-111111111111',
};

const ADULTS_INPUT = {
  centreId: '00000000-0000-0000-0000-000000000002',
  adults: 3,
  clientUuid: '22222222-2222-2222-2222-222222222222',
};

async function messageFrom(
  write: (db: Db) => Promise<unknown>,
  error: { message: string; code?: string },
): Promise<string> {
  try {
    await write(dbFailingWith(error));
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('the write resolved on an error result');
}

const viaRecordAttendance = (db: Db) => recordAttendance(db, ATTENDANCE_INPUT);
const viaRecordAdultsPresent = (db: Db) => recordAdultsPresent(db, ADULTS_INPUT);

describe('recordAttendance failure messages', () => {
  for (const [label, refusal] of [
    ['an RLS refusal — the writer is no longer a member', REFUSALS.rls],
    ['a purged child, so the reference no longer resolves', REFUSALS.purgedChild],
    ['a malformed uuid', REFUSALS.malformedUuid],
    ['the 14-day trigger', REFUSALS.ancient],
  ] as const) {
    it(`lets the outbox park the queue's entry rather than stall on ${label}`, async () => {
      expect(classifyWriteFailure(await messageFrom(viaRecordAttendance, refusal))).toBe(
        'permanent',
      );
    });
  }

  it('carries the sqlstate, so a refusal nobody has seen yet still classifies', async () => {
    // The structural half of the fix, and the half that survives the next migration: this has
    // to hold for a message with nothing recognisable in it at all.
    const m = await messageFrom(viaRecordAttendance, {
      message: 'some wording nobody has written yet',
      code: '23514',
    });
    expect(m).toContain('23514');
    expect(classifyWriteFailure(m)).toBe('permanent');
  });

  it('keeps a drifted clock retryable rather than burying the day', async () => {
    // The opposite direction, and the reason the classifier has three verdicts instead of two.
    // A tablet whose clock runs hours fast produces this; the row becomes valid on its own as
    // real time advances. Buried as `permanent`, the child stays off the roll all day.
    expect(classifyWriteFailure(await messageFrom(viaRecordAttendance, REFUSALS.driftedClock))).toBe(
      'retry-later',
    );
  });

  it('does not manufacture a permanent verdict out of a network failure', async () => {
    // `fetch failed` carries no code. If the formatting ever appended one unconditionally —
    // `[undefined]` — no assertion on the string would notice, so the verdict is asserted.
    expect(classifyWriteFailure(await messageFrom(viaRecordAttendance, { message: 'TypeError: fetch failed' }))).toBe(
      'transient',
    );
  });
});

describe('recordAdultsPresent failure messages', () => {
  /*
    The mobile outbox flushes adult counts through `recordAdultsPresent`, classifies the result
    with the same function, and had the same defect. Asserted separately because the fix is a
    separate line of code in a separate function — sharing a helper in the test does not make
    them share an implementation.
  */
  it('lets the outbox park an RLS refusal instead of stalling the queue', async () => {
    expect(classifyWriteFailure(await messageFrom(viaRecordAdultsPresent, REFUSALS.rls))).toBe(
      'permanent',
    );
  });

  it('carries the sqlstate for a refusal with no recognisable text', async () => {
    const m = await messageFrom(viaRecordAdultsPresent, {
      message: 'staff_count_events said no',
      code: '23503',
    });
    expect(classifyWriteFailure(m)).toBe('permanent');
  });

  it('leaves a network failure transient', async () => {
    expect(
      classifyWriteFailure(await messageFrom(viaRecordAdultsPresent, { message: 'fetch failed' })),
    ).toBe('transient');
  });
});
