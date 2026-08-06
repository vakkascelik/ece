'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { describeSignOut } from '@ece/core';
import { browserDb } from '@/lib/supabaseBrowser';
import { discardDead, flush, pending, snapshot, OUTBOX_EVENT } from '@/lib/outbox';

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
export function SignOutControl({ signOut }: { signOut: () => Promise<void> }) {
  const [queue, setQueue] = useState({ unsent: 0, dead: 0 });
  const [asking, setAsking] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const sync = () => setQueue(snapshot());
    sync();
    window.addEventListener(OUTBOX_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

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
    discardDead();
    await signOut();
  }, [signOut]);

  const attempt = useCallback(() => {
    const now = snapshot();
    setQueue(now);
    if (describeSignOut(now).allowed) {
      void go();
      return;
    }
    setAsking(true);
  }, [go]);

  const sendNow = useCallback(async () => {
    setSyncing(true);
    try {
      await flush(browserDb());
      const now = snapshot();
      setQueue(now);
      // Emptied: the thing they were being held for is done, so leave rather than making them
      // press it again.
      if (describeSignOut(now).allowed) {
        setAsking(false);
        await go();
      }
    } finally {
      setSyncing(false);
    }
  }, [go]);

  const verdict = describeSignOut(queue);

  return (
    <>
      <button ref={opener} className="secondary auth-secondary" type="button" onClick={attempt}>
        Sign out
      </button>

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
              {pending().map((entry) => (
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
