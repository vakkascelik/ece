'use client';

import { useActionState, useState } from 'react';
import { AGE_BAND_LABELS, ENQUIRY_STATUSES, type Enquiry } from '@ece/api';
import { moveEnquiry, removeEnquiry, type Result } from './actions';

const DAY_LABELS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * One enquiry, with the two things the office does to it.
 *
 * The delete is armed rather than immediate — a confirm step in the markup, the same
 * pattern `/applications` uses. A one-click delete on a row holding a family's contact
 * details is the wrong default, and this row is the only evidence the enquiry exists once
 * it is gone (the audit row survives, but it holds no phone number to ring back).
 */
export function EnquiryRow({ enquiry }: { enquiry: Enquiry }) {
  const [moveState, moveAction, moving] = useActionState<Result | null, FormData>(
    moveEnquiry,
    null,
  );
  const [removeState, removeAction, removing] = useActionState<Result | null, FormData>(
    removeEnquiry,
    null,
  );
  const [armed, setArmed] = useState(false);

  const error =
    moveState && 'error' in moveState
      ? moveState.error
      : removeState && 'error' in removeState
        ? removeState.error
        : null;

  return (
    <tr>
      <td>
        <strong>{enquiry.contactName}</strong>
        <div className="sub" style={{ fontSize: '0.8125rem' }}>
          <a href={`mailto:${enquiry.email}`}>{enquiry.email}</a>
          {enquiry.phone ? ` · ${enquiry.phone}` : ''}
        </div>
        {error && (
          <p className="error" role="alert" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
            {error}
          </p>
        )}
      </td>

      <td>
        {/* The only thing this product knows about the child, and deliberately so — 0054. */}
        {enquiry.childAgeBand ? AGE_BAND_LABELS[enquiry.childAgeBand] : <span className="sub">Not said</span>}
      </td>

      <td>
        {enquiry.wantedFrom ?? <span className="sub">—</span>}
        {enquiry.wantedDays && enquiry.wantedDays.length > 0 && (
          <div className="sub" style={{ fontSize: '0.8125rem' }}>
            {enquiry.wantedDays.map((d) => DAY_LABELS[d]).join(', ')}
          </div>
        )}
      </td>

      <td>
        <form action={moveAction} className="inline">
          <input type="hidden" name="id" value={enquiry.id} />
          <label htmlFor={`status-${enquiry.id}`} className="visually-hidden">
            Status for {enquiry.contactName}
          </label>
          <select
            id={`status-${enquiry.id}`}
            name="status"
            defaultValue={enquiry.status}
            style={{ maxWidth: '9rem' }}
          >
            {ENQUIRY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="small secondary" type="submit" disabled={moving}>
            {moving ? 'Saving…' : 'Save'}
          </button>
        </form>
      </td>

      <td>
        {armed ? (
          <form action={removeAction} className="inline">
            <input type="hidden" name="id" value={enquiry.id} />
            <button className="small" type="submit" disabled={removing}>
              {removing ? 'Removing…' : 'Really remove'}
            </button>
            <button className="small secondary" type="button" onClick={() => setArmed(false)}>
              Keep
            </button>
          </form>
        ) : (
          <button className="small secondary" type="button" onClick={() => setArmed(true)}>
            Remove
          </button>
        )}
      </td>
    </tr>
  );
}
