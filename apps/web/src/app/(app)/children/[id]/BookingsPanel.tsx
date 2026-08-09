'use client';

import { useState, useTransition } from 'react';
import type { Booking } from '@ece/api';
import { reportChildAbsence } from '../actions';

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
      const result = await reportChildAbsence(childId, onDate);
      setMessage({ date: onDate, text: result.message });
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
        <p className="sub" style={{ margin: '0.75rem 0 0', fontSize: '0.8125rem' }}>
          Telling us your child is away does not change what you are charged for the day, and
          it does not cancel the booking. It lets the centre plan who is expected.
        </p>
      )}
    </>
  );
}
