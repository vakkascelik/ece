import { describe, expect, it } from 'vitest';
import { classifyWriteFailure } from '../writeFailure';

/**
 * The real messages, as Postgres and PostgREST actually phrase them. Written out rather than
 * shortened, because the classifier matches on their text and a test against a paraphrase would
 * pass while the product mis-read the real thing.
 */
const NOT_FUTURE =
  'new row for relation "attendance_events" violates check constraint "attendance_not_future"';
/**
 * **This message can no longer be produced, and is kept on purpose.** 0078 moved the six
 * `_not_ancient` rules from CHECK constraints to triggers so the operational core could be
 * restored more than a fortnight after a backup, and a trigger phrases its own refusal. Any
 * device still carrying a queue written against the old schema will report this text, and a
 * classifier that stopped recognising it would bury those events differently from the ones
 * beside them in the same queue.
 */
const NOT_ANCIENT_LEGACY_CHECK =
  'new row for relation "attendance_events" violates check constraint "attendance_not_ancient"';
/**
 * What the database says today, copied from a live refusal rather than reconstructed — the
 * discipline the comment above demands, and the reason 0079 exists at all. 0078's first wording
 * carried neither constraint name, and while the generic 23514 rule would still have answered
 * `permanent` by luck, the named rule below would have quietly become dead code with its unit
 * test passing against a string the database could no longer emit.
 */
const NOT_ANCIENT =
  'attendance_not_ancient : row is older than the 14 day window (at on public.attendance_events)';
const CORRECTION_NEEDS_NOTE =
  'new row for relation "attendance_events" violates check constraint "attendance_correction_has_note"';

describe('classifyWriteFailure', () => {
  it('retries a future-dated event instead of burying it', () => {
    // The bug this function was extracted to fix. A tablet three hours fast had its sign-ins
    // marked permanently dead on the first attempt — child off the roll, ratio wrong all day,
    // day missing from the funding record, because of a clock.
    expect(classifyWriteFailure(NOT_FUTURE)).toBe('retry-later');
  });

  it('gives up on an event that aged out of the window', () => {
    // The mirror case, and the one that really is hopeless: time only makes it worse.
    expect(classifyWriteFailure(NOT_ANCIENT)).toBe('permanent');
  });

  it('reads the trigger and the old constraint the same way', () => {
    // A tablet that has been in a drawer since before 0078 will flush a queue whose refusals
    // are phrased the old way, alongside new ones phrased by the trigger. Two spellings of one
    // situation must not produce two outcomes in the same flush.
    expect(classifyWriteFailure(NOT_ANCIENT_LEGACY_CHECK)).toBe('permanent');
    expect(classifyWriteFailure(NOT_ANCIENT)).toBe(classifyWriteFailure(NOT_ANCIENT_LEGACY_CHECK));
  });

  it('keeps the two clock constraints apart', () => {
    // They look almost identical and behave in opposite directions, which is exactly why the
    // original single check-violation rule swallowed both.
    expect(classifyWriteFailure(NOT_FUTURE)).not.toBe(classifyWriteFailure(NOT_ANCIENT));
    // And the trigger's wording must not accidentally read as the future case — they now share
    // a prefix (`attendance_not_`) that the old constraint messages did not put side by side.
    expect(classifyWriteFailure(NOT_ANCIENT)).toBe('permanent');
  });

  it('treats any other check violation as needing a person', () => {
    expect(classifyWriteFailure(CORRECTION_NEEDS_NOTE)).toBe('permanent');
    expect(classifyWriteFailure('ERROR: 23514: something else entirely')).toBe('permanent');
  });

  it('treats a revoked membership as permanent', () => {
    /*
      42501. Retrying will not restore a membership somebody deliberately revoked, and the
      queue must not keep offering the write to a server that is right to refuse it.

      THE FIRST ASSERTION SAID `transient` UNTIL 2026-09-04, in a test called "treats a revoked
      membership as permanent", under a comment explaining why it is permanent. The gap had been
      noticed and then **pinned** rather than closed: PostgREST's RLS message carries neither
      `permission denied` nor `42501`, so it fell through to the default, and the assertion was
      written to match the code instead of the requirement.

      A test that contradicts its own name is worse than a missing test, because the name is
      what the next reader greps for. What made it visible was measuring the real messages: with
      `recordAttendance` now propagating the sqlstate, and a text rule for the RLS wording, the
      bare message classifies as this test always said it should.
    */
    expect(classifyWriteFailure('new row violates row-level security policy')).toBe('permanent');
    expect(classifyWriteFailure('ERROR: 42501: permission denied for table attendance_events')).toBe(
      'permanent',
    );
    expect(classifyWriteFailure('permission denied for table attendance_events')).toBe('permanent');
  });

  it('treats a purged child as permanent', () => {
    expect(
      classifyWriteFailure('insert or update on table "attendance_events" violates foreign key constraint "attendance_events_child_id_fkey" (23503)'),
    ).toBe('permanent');
  });

  it('treats a malformed payload as permanent', () => {
    expect(classifyWriteFailure('ERROR: 22P02: invalid input syntax for type uuid: "not-a-uuid"')).toBe(
      'permanent',
    );
  });

  it('treats the network as transient', () => {
    for (const m of [
      'TypeError: fetch failed',
      'Network request failed',
      'ETIMEDOUT',
      'socket hang up',
      'FetchError: request to https://…/rest/v1/attendance_events failed',
      '503 Service Unavailable',
      '',
    ]) {
      expect(classifyWriteFailure(m), m || '(empty)').toBe('transient');
    }
  });

  it('never calls a duplicate permanent', () => {
    // 23505 on client_uuid means the event is already there — success wearing an error's clothes.
    // The API layer reports it as a duplicate, but if it ever threw, the one outcome that must
    // not happen is the row being written off as needing a person.
    const dup =
      'duplicate key value violates unique constraint "attendance_events_client_uuid_key" (23505)';
    expect(classifyWriteFailure(dup)).not.toBe('permanent');
  });

  /*
    THE FOUR REFUSALS THIS PRODUCT ACTUALLY PRODUCES, READ OFF THE DATABASE.

    Every string below was captured from live Postgres on 2026-09-04 by attempting the write
    inside a rolled-back transaction, not written from memory. That distinction is the entire
    reason these tests are shaped this way. `0079`'s header warns that a rule in the classifier
    "becomes dead code matching a string the database can no longer produce, and its unit test
    goes on passing because it feeds a synthetic message rather than a real one" - and the first
    version of this block, written an hour earlier, was precisely that: it asserted the 14-day
    message *without* its trigger name, which is what 0078 briefly emitted and 0079 put back. It
    passed, while asserting something untrue about the database.

    Three of the four were classified `transient` until this commit, because `recordAttendance`
    threw `error.message` and dropped `error.code`. `transient` is not "retry later" - it is
    "the network is down, stop flushing" - so any one of them at the head of a queue stopped the
    queue.
  */
  const REAL: Array<[string, string, string]> = [
    [
      'the 14-day trigger, which was the one already classified correctly',
      'attendance_not_ancient : row is older than the 14 day window (at on public.attendance_events)',
      '23514',
    ],
    [
      'RLS refused the row, because the writer is not a member of that centre',
      'new row violates row-level security policy for table "attendance_events"',
      '42501',
    ],
    [
      'the child was purged, so the reference no longer resolves',
      'insert or update on table "attendance_events" violates foreign key constraint "attendance_events_child_id_fkey"',
      '23503',
    ],
    [
      'a malformed uuid, which no amount of retrying repairs',
      'invalid input syntax for type uuid: "not-a-uuid"',
      '22P02',
    ],
  ];

  for (const [label, message, code] of REAL) {
    it(`treats as permanent: ${label}`, () => {
      // Exactly as the API layer now hands it over: prefix, message, sqlstate.
      expect(classifyWriteFailure(`recordAttendance: ${message} [${code}]`)).toBe('permanent');
    });
  }

  it('still recognises the pre-0078 constraint name, because an old queue will send it', () => {
    // A device offline since before 0078 flushes refusals phrased the old way. 0079's header
    // makes the same point from the migration side.
    expect(classifyWriteFailure('violates check constraint "attendance_not_ancient"')).toBe(
      'permanent',
    );
  });

  it('survives a message it has never seen', () => {
    // Defaulting to transient means an unknown failure is retried rather than discarded. For a
    // queue holding the only record that a child is in the building, losing a write is worse
    // than retrying one that will never succeed — the second wastes battery, the first
    // loses a child off the roll.
    expect(classifyWriteFailure('something nobody predicted')).toBe('transient');
    // @ts-expect-error — deliberately passing what a caller might if a client returned no message
    expect(classifyWriteFailure(undefined)).toBe('transient');
  });
});
