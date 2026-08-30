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
    // 42501. Retrying will not restore a membership somebody deliberately revoked, and the
    // queue must not keep offering the write to a server that is right to refuse it.
    expect(classifyWriteFailure('new row violates row-level security policy')).toBe('transient');
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
