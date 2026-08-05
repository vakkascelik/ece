/**
 * What must be true before somebody signs out of a shared tablet.
 *
 * WHY THIS IS A PURE FUNCTION IN `core` RATHER THAN A BRANCH IN THE BUTTON
 *
 * Because it is the only part of sign-out that can be tested. The rest — clearing SecureStore,
 * emptying a SQLite queue, revoking a push token — needs a device, and `expo-sqlite` cannot run
 * in this repo's test runner. The precedent is `classifyWriteFailure`, which was extracted from
 * the outbox for exactly this reason and immediately turned out to be wrong in a way nobody had
 * noticed.
 *
 * THE DECISION IT ENCODES
 *
 * Signing out clears the outbox. On a centre's shared tablet that is the right thing to do —
 * the next educator must not inherit the previous one's queue — and it means **sign-out can
 * destroy the only record that a child is in the building.**
 *
 * Three sign-ins made in the foyer while the wifi was down are three children whose parents
 * have left, who are on nobody's roll, and who will not be counted in the ratio. Discarding
 * that silently to log somebody out is not a trade worth making, so an unsent queue **blocks**
 * sign-out and names the number.
 *
 * Dead entries are counted separately and do NOT block. A dead entry is one the server has
 * permanently refused — an event that aged past the fourteen-day window, or a membership that
 * was revoked. Retrying will never place it, so holding a person on the device forever to
 * protect a row that cannot land would be a queue that can never be emptied.
 */

export interface QueueSnapshot {
  /** Entries still worth sending. */
  unsent: number;
  /** Entries the server has permanently refused. These cannot be rescued by waiting. */
  dead: number;
}

export type SignOutVerdict =
  /** Nothing queued, or nothing that can still be sent. Proceed. */
  | { allowed: true; warning: string | null }
  /** Unsent work would be destroyed. Say how much, and offer to send it first. */
  | { allowed: false; unsent: number; message: string };

export function describeSignOut(queue: QueueSnapshot): SignOutVerdict {
  if (queue.unsent > 0) {
    const events = queue.unsent === 1 ? '1 sign-in or sign-out' : `${queue.unsent} sign-ins and sign-outs`;
    return {
      allowed: false,
      unsent: queue.unsent,
      // Names the number, because "you have unsaved changes" is a dialogue people dismiss.
      // "3 sign-ins" is a fact about children in a building.
      message:
        `This device is still holding ${events} that have not reached the centre. ` +
        `Signing out would discard them, and the children would not appear on the roll. ` +
        `Send them first, or ask a manager to record them by hand.`,
    };
  }

  if (queue.dead > 0) {
    const events = queue.dead === 1 ? '1 record' : `${queue.dead} records`;
    return {
      allowed: true,
      // A warning rather than a block: waiting cannot fix these, so refusing would trap
      // somebody on the device permanently.
      warning:
        `${events} on this device were refused by the centre and cannot be sent. ` +
        `They will be discarded. Tell a manager what happened so the roll can be corrected.`,
    };
  }

  return { allowed: true, warning: null };
}
