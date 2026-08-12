'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeSignOut } from '@ece/core';
import { browserDb } from '@/lib/supabaseBrowser';
import { deadEntries, discardDead, flush, pending, snapshot, OUTBOX_EVENT } from '@/lib/outbox';

/**
 * Sign out, and screen 5: the refusal.
 *
 * WHAT THIS PROTECTS
 *
 * Signing out clears the outbox — on a centre's shared tablet the next educator must not
 * inherit the previous one's queue. Which means **sign-out can destroy the only record that a
 * child is in the building**. Three sign-ins made in the foyer while the wifi was down are
 * three children whose parents have left, who are on nobody's roll, and who are not counted in
 * the ratio.
 *
 * So an unsent queue **blocks** sign-out and names the number. The verdict comes from
 * `describeSignOut` in `@ece/core`, which is tested there and is shared with the mobile app —
 * the wording of a refusal about children in a building is not something to reimplement per
 * surface.
 *
 * THERE IS NO "SIGN OUT ANYWAY", DELIBERATELY
 *
 * The pack lists this among the decisions not to soften and it is right. Attendance is the
 * source of the funding return, and a destructive escape hatch on a control tapped dozens of
 * times a day will eventually be tapped by accident. The two ways out are "send them" and
 * "stay signed in". Escape resolves to staying.
 *
 * Dead entries do not block. An entry the server has permanently refused cannot be rescued by
 * waiting, so holding somebody on the device forever to protect a row that will never land
 * would be a queue that can never be emptied. They are named, then discarded on sign-out.
 */
export function SignOutControl({
  signOut,
  userId,
}: {
  signOut: () => Promise<void>;
  /** Whose queue to count. See the note on `OutboxEntry.userId`. */
  userId: string;
}) {
  const [queue, setQueue] = useState({ unsent: 0, dead: 0 });
  const [asking, setAsking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sync = () => setQueue(snapshot(userId));
    sync();
    window.addEventListener(OUTBOX_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  const stay = useCallback(() => {
    setAsking(false);
    opener.current?.focus();
  }, []);

  // Focus management, because this covers the page. Initial focus on the primary — "Try
  // sending now" — which is what the pack asks for and is also the thing somebody wants.
  useEffect(() => {
    if (!asking) return;
    const panel = dialog.current;
    panel?.querySelector<HTMLElement>('[data-primary]')?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        stay();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const stops = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [asking, stay]);

  const go = useCallback(async () => {
    // Dead entries are named in the dialog and then let go: they cannot land, and carrying
    // them to the next person's session would be worse than losing them.
    discardDead(userId);
    await signOut();
  }, [signOut, userId]);

  const attempt = useCallback(() => {
    const now = snapshot(userId);
    setQueue(now);
    const verdict = describeSignOut(now);
    /*
     * `allowed` is not the whole answer, and reading it as though it were made a branch of
     * `describeSignOut` unreachable.
     *
     * A queue holding only dead entries is `allowed: true` **with a warning** — dead entries cannot
     * be rescued by waiting, so they must not hold somebody on the device forever, but they are
     * still records of children that will never reach the server. This went straight to `go()`,
     * which calls `discardDead()`. So the sign-in was destroyed with nothing shown, and the comment
     * on `go` saying dead entries "are named in the dialog and then let go" described something that
     * could not happen: the dialog only ever opened when the verdict was `allowed: false`.
     */
    if (verdict.allowed && verdict.warning === null) {
      void go();
      return;
    }
    setAsking(true);
  }, [go, userId]);

  const sendNow = useCallback(async () => {
    setSyncing(true);
    try {
      await flush(browserDb(), userId);
      const now = snapshot(userId);
      setQueue(now);
      /*
       * THE SAME TEST `attempt` WAS FIXED FOR, LEFT WRONG IN THE SIBLING PATH — AND THIS IS THE
       * PATH WHERE IT IS MOST LIKELY TO BITE, BECAUSE THE FLUSH IS WHAT CREATES DEAD ENTRIES.
       *
       * This read `describeSignOut(now).allowed` alone. A queue holding only dead entries is
       * `allowed: true` **with a warning**, so an entry that the flush a few lines above had just
       * marked permanently refused went straight to `go()` — which calls `discardDead()`. The
       * record was destroyed, the dialog naming it never rendered because `setAsking(false)` ran
       * first, and nobody was told. A child signed in on a wall tablet then exists nowhere: absent
       * from the roll, absent from the ratio, and present in the building.
       *
       * "Emptied: the thing they were being held for is done" was the reasoning, and it is wrong
       * after a partial flush: unsent reaching zero is not the same as everything having landed.
       * The condition now matches `attempt` — leave immediately only when there is nothing left to
       * say. Otherwise fall through with the dialog still open, so the warning branch renders.
       */
      const verdict = describeSignOut(now);
      if (verdict.allowed && verdict.warning === null) {
        setAsking(false);
        await go();
      }
    } finally {
      setSyncing(false);
    }
  }, [go, userId]);

  const verdict = describeSignOut(queue);

  return (
    <>
      <button ref={opener} className="secondary auth-secondary" type="button" onClick={attempt}>
        Sign out
      </button>

      {/*
        The dead-only case: sign-out is allowed, but not silently.
        `describeSignOut` returns a warning here and nothing rendered it, so a permanently-refused
        sign-in was discarded with no message at all. Separate from the refusal dialogue below
        because it is a different act — this one confirms a loss rather than preventing one, so the
        primary action says what it destroys instead of offering to retry something that cannot land.
      */}
      {asking && verdict.allowed && verdict.warning !== null && (
        <>
          <div className="dialog-scrim" aria-hidden="true" />
          <div
            ref={dialog}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dead-title"
          >
            <span className="flag flag-pending">
              {'↻'} {queue.dead} stuck
            </span>

            <h2 id="dead-title">Some records cannot be saved</h2>
            <p>{verdict.warning}</p>

            <ul className="dialog-list">
              {deadEntries(userId).map((entry) => (
                <li key={entry.clientUuid}>
                  {entry.kind === 'in' ? 'Sign-in' : 'Sign-out'} at{' '}
                  {new Date(entry.at).toLocaleTimeString('en-NZ', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {entry.lastError && ` · ${entry.lastError}`}
                </li>
              ))}
            </ul>

            <div className="dialog-actions">
              <button type="button" data-primary onClick={() => void go()}>
                Discard them and sign out
              </button>
              <button type="button" className="secondary" onClick={stay}>
                Stay signed in
              </button>
            </div>
          </div>
        </>
      )}

      {asking && !verdict.allowed && (
        <>
          <div className="dialog-scrim" aria-hidden="true" />
          <div
            ref={dialog}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="refuse-title"
          >
            {/* The count, first and as a fact. "You have unsaved changes" is a sentence people
                dismiss; "3 sign-ins" is a statement about children. */}
            <span className="flag flag-pending">
              {'↻'} {verdict.unsent} not sent
            </span>

            <h2 id="refuse-title">You can&rsquo;t sign out yet</h2>
            <p>{verdict.message}</p>

            <ul className="dialog-list">
              {pending(userId).map((entry) => (
                <li key={entry.clientUuid}>
                  {entry.kind === 'in' ? 'Sign-in' : 'Sign-out'} at{' '}
                  {new Date(entry.at).toLocaleTimeString('en-NZ', {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                  {entry.attempts > 0 && ` · ${entry.attempts} attempt${entry.attempts === 1 ? '' : 's'}`}
                </li>
              ))}
            </ul>

            <div className="dialog-actions">
              <button type="button" data-primary onClick={() => void sendNow()} disabled={syncing}>
                {syncing ? 'Sending…' : 'Try sending now'}
              </button>
              <button type="button" className="secondary" onClick={stay}>
                Stay signed in
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
