/**
 * Classifying a refused offline write.
 *
 * This lives in `@ece/core`, away from the outbox that uses it, for one reason: it is the most
 * consequential logic in the offline path and it is the only part of that path testable without
 * a device. `expo-sqlite` cannot be exercised in this repo's test runner, so everything else in
 * `apps/mobile/lib/outbox.ts` is verified by a drill that has never run on a tablet. A pure
 * function can be tested properly, so the judgement is here and the plumbing stays there.
 *
 * THREE OUTCOMES, NOT TWO
 *
 * The outbox originally had two: permanent, or transient. Transient meant "stop flushing, there
 * is no signal". That collapsed two genuinely different situations and produced a bug:
 *
 *   • `attendance_not_future` fires when a device's clock is ahead of the server's by more than
 *     the two hours of skew the constraint allows. It was classified **permanent**, so a tablet
 *     whose clock had drifted three hours forward would have its sign-ins marked dead on the
 *     first attempt. The child stays off the roll, the ratio is wrong all day, and the day is
 *     missing from the funding record — over a clock, and with nobody watching a queue at 8am.
 *
 *     It is not permanent. Real time keeps advancing, so a fixed future timestamp becomes valid
 *     on its own. It needs retrying, not burying.
 *
 *   • But it must not be treated as "no signal" either, because that stopped the flush. One
 *     future-dated event at the head of the queue would block every later sign-in behind it —
 *     turning a drifted clock into a lost day rather than a delayed row.
 *
 * So: `permanent` (needs a person), `retry-later` (will fix itself, skip it and keep draining),
 * `transient` (the network; stop, the rest will fail the same way).
 */

export type WriteFailure =
  /** Retrying cannot help. Set aside for somebody to look at. */
  | 'permanent'
  /** Will become valid without intervention. Skip this entry, keep flushing the rest. */
  | 'retry-later'
  /** The network or the server. Nothing after it will do better right now. */
  | 'transient';

export function classifyWriteFailure(message: string): WriteFailure {
  const m = message ?? '';

  /*
   * Order matters: the future check is a check violation, so it has to be recognised before the
   * generic check-violation rule claims it.
   *
   * Matched on the constraint NAME rather than the code, because the code says only "a CHECK
   * refused this" and the whole distinction is which check.
   */
  if (/attendance_not_future/i.test(m)) return 'retry-later';

  /*
   * The mirror case, and genuinely permanent: an event that aged past the fourteen-day window
   * while the device sat in a drawer. Time makes this worse, never better. Named explicitly so
   * the two clock-related constraints cannot be confused by a future reader — they look alike
   * and behave in opposite directions.
   */
  if (/attendance_not_ancient/i.test(m)) return 'permanent';

  if (
    /\b23514\b/.test(m) || // check_violation — some other rule the row breaks
    /violates check constraint/i.test(m) ||
    /\b42501\b/.test(m) || // insufficient_privilege — no longer a member, or revoked
    /permission denied/i.test(m) ||
    /\b23503\b/.test(m) || // foreign_key_violation — the child was archived or purged
    /\b22P02\b/.test(m) // invalid_text_representation — a malformed payload
  ) {
    return 'permanent';
  }

  /*
   * `23505` is deliberately absent from every list: a unique violation on `client_uuid` means
   * the event is already on the server, which is success. The API layer reports it as a
   * duplicate rather than throwing, and if it ever did throw, treating it as transient would
   * retry harmlessly rather than burying a write that landed.
   */
  return 'transient';
}
