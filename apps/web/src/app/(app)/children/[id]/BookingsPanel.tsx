'use client';

import { useState, useTransition } from 'react';
import type { Booking } from '@ece/api';
import { reportChildAbsence, reportChildAbsenceRange } from '../actions';

/**
 * The next few weeks of booked days, and — for a guardian — one button per day.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WORD IS "NOT COMING", NOT "CANCEL"
 *
 * Cancel is the word people reach for and it is the wrong one here, because it is a
 * different status with different consequences. 0018: `absent` is *booked and did not
 * attend, usually still charged*; `cancelled` is *withdrawn in time*. A parent pressing a
 * button labelled Cancel would reasonably believe they had stopped the charge.
 *
 * So the button says what happens — the centre is told they are not coming — and the note
 * underneath says the fee is unchanged. Getting this wording wrong is not a copy problem;
 * it is a family discovering a charge they thought they had avoided.
 */
export function BookingsPanel({
  bookings,
  isParent,
}: {
  bookings: Booking[];
  isParent: boolean;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ date: string; text: string } | null>(null);
  /*
    One optional note, shared by the per-day button and the range form. Optional because
    demanding a reason at 7am with a sick child is how the button stops being used — the
    phone call this replaces never required one either.
  */
  const [reason, setReason] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');

  if (bookings.length === 0) {
    return (
      <p className="sub" style={{ margin: 0 }}>
        No booked days in the next four weeks.
      </p>
    );
  }

  const report = (childId: string, onDate: string) => {
    setMessage(null);
    start(async () => {
      const result = await reportChildAbsence(childId, onDate, reason);
      setMessage({ date: onDate, text: result.message });
    });
  };

  const reportRange = () => {
    if (!rangeFrom || !rangeTo) return;
    setMessage(null);
    start(async () => {
      const result = await reportChildAbsenceRange(
        bookings[0]!.childId,
        rangeFrom,
        rangeTo,
        reason,
      );
      setMessage({ date: rangeFrom, text: result.message });
    });
  };

  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Status</th>
            {isParent && <th>Not coming?</th>}
          </tr>
        </thead>
        <tbody>
          {bookings.map((b) => (
            <tr key={b.id}>
              <td>{b.onDate}</td>
              <td>
                {b.status === 'absent' ? (
                  <span className="flag flag-quiet">Told you they are away</span>
                ) : b.status === 'cancelled' ? (
                  <span className="sub">Cancelled by the centre</span>
                ) : b.status === 'closed' ? (
                  <span className="sub">Centre closed</span>
                ) : (
                  'Booked'
                )}
              </td>
              {isParent && (
                <td>
                  {/*
                    Only a `booked` day offers the button. A day already marked, cancelled
                    or closed is somebody else's decision or already done, and an enabled
                    button that returns "you cannot do that" teaches people to distrust
                    every button on the page.
                  */}
                  {b.status === 'booked' ? (
                    <button
                      type="button"
                      className="small secondary"
                      disabled={pending}
                      onClick={() => report(b.childId, b.onDate)}
                    >
                      {pending ? 'Telling them…' : 'Tell the centre'}
                    </button>
                  ) : (
                    <span className="sub">—</span>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {message && (
        <p role="status" style={{ margin: '0.75rem 0 0' }}>
          {message.text}
        </p>
      )}

      {isParent && (
        <>
          <div style={{ margin: '0.75rem 0 0' }}>
            <label htmlFor="absence-reason">Anything we should know? (optional)</label>
            <input
              id="absence-reason"
              className="wide"
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. chickenpox, away with whānau"
              disabled={pending}
            />
          </div>

          {/*
            The range, for the week-of-chickenpox case. Per-day honest on the server
            (0063), and the sentence that comes back says how many days landed — a
            no-booking Wednesday must not silently vanish from what the family believes
            they told us.
          */}
          <div className="inline" style={{ margin: '0.75rem 0 0', alignItems: 'end', gap: '0.5rem' }}>
            <div>
              <label htmlFor="range-from">Away from</label>
              <input
                id="range-from"
                type="date"
                value={rangeFrom}
                onChange={(e) => setRangeFrom(e.target.value)}
                disabled={pending}
              />
            </div>
            <div>
              <label htmlFor="range-to">until</label>
              <input
                id="range-to"
                type="date"
                value={rangeTo}
                onChange={(e) => setRangeTo(e.target.value)}
                disabled={pending}
              />
            </div>
            <button
              type="button"
              className="small secondary"
              disabled={pending || !rangeFrom || !rangeTo}
              onClick={reportRange}
            >
              {pending ? 'Telling them…' : 'Tell the centre'}
            </button>
          </div>

          <p className="sub" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem' }}>
            Telling us your child is away does not change what you are charged for the day, and
            it does not cancel the booking. It lets the centre plan who is expected.
          </p>
        </>
      )}
    </>
  );
}
