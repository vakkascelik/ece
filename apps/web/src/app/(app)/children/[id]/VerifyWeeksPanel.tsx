'use client';

import { useState, useTransition } from 'react';
import { verifyWeekPortal } from '../actions';

/**
 * The portal half of §6-3: recent weeks, their times, and — for a named signatory — the
 * signature over them.
 *
 * The times are ON the panel before the buttons are, for the same reason the kiosk shows
 * the week before it signs (criterion 6): approving figures that were never displayed is a
 * rubber stamp. Every derived state renders, including the settled ones — a family reading
 * "confirmed" is a family that stops wondering whether the button worked last Tuesday.
 *
 * The buttons are drawn only for a signatory. That is display, not enforcement — 0061's
 * INSERT policy is the enforcement, and a caller who edits the DOM meets it.
 */

export interface VerifyWeekRow {
  periodStart: string;
  periodEnd: string;
  /** Derived server-side by summariseVerification, against the centre's today. */
  status: 'awaiting' | 'overdue' | 'in-review' | 'approved' | 'superseded';
  weekLabel: string;
  /** Pre-formatted per-day lines, oldest first: "Monday 4 August — in 8:05 am, out 3:12 pm". */
  dayLines: string[];
}

const STATUS_COPY: Record<VerifyWeekRow['status'], { label: string; tone: 'quiet' | 'ok' | 'warn' }> = {
  approved: { label: 'Confirmed', tone: 'ok' },
  awaiting: { label: 'Waiting for your confirmation', tone: 'warn' },
  overdue: { label: 'Waiting for your confirmation', tone: 'warn' },
  'in-review': { label: 'You told us something looked wrong — the office is checking', tone: 'quiet' },
  superseded: {
    // Their approval did not "expire"; the record moved. Say the true thing.
    label: 'The record changed after you confirmed it — please look again',
    tone: 'warn',
  },
};

/** The states a signatory can act on. `in-review` is included: a fixed week is re-approvable. */
const ACTIONABLE: readonly VerifyWeekRow['status'][] = [
  'awaiting',
  'overdue',
  'superseded',
  'in-review',
];

export function VerifyWeeksPanel({
  childId,
  ownGuardianId,
  isSignatory,
  weeks,
}: {
  childId: string;
  ownGuardianId: string | null;
  isSignatory: boolean;
  weeks: VerifyWeekRow[];
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [disputing, setDisputing] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  if (weeks.length === 0) {
    return (
      <p className="sub" style={{ margin: 0 }}>
        No attendance weeks to show yet.
      </p>
    );
  }

  const canSign = isSignatory && ownGuardianId !== null;

  const send = (week: VerifyWeekRow, outcome: 'approved' | 'disputed') => {
    if (!ownGuardianId) return;
    setMessage(null);
    start(async () => {
      const result = await verifyWeekPortal({
        childId,
        guardianId: ownGuardianId,
        periodStart: week.periodStart,
        periodEnd: week.periodEnd,
        outcome,
        comment,
      });
      if (result.message !== null) {
        setMessage(result.message);
        return;
      }
      setDisputing(null);
      setComment('');
      setDone(
        outcome === 'approved'
          ? `Thank you — the week of ${week.weekLabel} is confirmed.`
          : 'Thank you — the office will take a look and come back to you.',
      );
    });
  };

  return (
    <>
      {(message || done) && (
        <p role="status" className={message ? 'kiosk-problem' : undefined} style={{ margin: '0 0 0.75rem' }}>
          {message ?? done}
        </p>
      )}

      {weeks.map((week) => {
        const copy = STATUS_COPY[week.status];
        const actionable = canSign && ACTIONABLE.includes(week.status);
        return (
          <details key={week.periodStart} className="card" style={{ marginBottom: '0.75rem' }}>
            <summary style={{ cursor: 'pointer' }}>
              <strong>Week of {week.weekLabel}</strong>{' '}
              <span className={`flag ${copy.tone === 'ok' ? 'flag-ok' : copy.tone === 'warn' ? 'flag-critical' : 'flag-quiet'}`}>
                {copy.label}
              </span>
            </summary>

            <ul style={{ margin: '0.75rem 0 0', paddingLeft: '1.25rem' }}>
              {week.dayLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {actionable && (
              <div style={{ marginTop: '0.75rem' }}>
                {disputing === week.periodStart ? (
                  <>
                    <label>
                      What looks wrong?
                      <textarea
                        className="wide"
                        rows={2}
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        disabled={pending}
                      />
                    </label>
                    <div className="inline" style={{ marginTop: '0.5rem', gap: '0.5rem' }}>
                      <button
                        type="button"
                        className="small"
                        disabled={pending || comment.trim().length === 0}
                        onClick={() => send(week, 'disputed')}
                      >
                        Send to the office
                      </button>
                      <button
                        type="button"
                        className="small secondary"
                        disabled={pending}
                        onClick={() => setDisputing(null)}
                      >
                        Never mind
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="inline" style={{ gap: '0.5rem' }}>
                    <button
                      type="button"
                      className="small"
                      disabled={pending}
                      onClick={() => send(week, 'approved')}
                    >
                      That&rsquo;s right — confirm this week
                    </button>
                    <button
                      type="button"
                      className="small secondary"
                      disabled={pending}
                      onClick={() => {
                        setComment('');
                        setDisputing(week.periodStart);
                      }}
                    >
                      Something&rsquo;s not right
                    </button>
                  </div>
                )}
              </div>
            )}
          </details>
        );
      })}

      {!isSignatory && (
        <p className="sub" style={{ margin: 0, fontSize: '0.8125rem' }}>
          Only a guardian the centre has named as an attendance signatory can confirm these
          weeks. Ask the office if that should be you.
        </p>
      )}
    </>
  );
}
