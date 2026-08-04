'use client';

import { useActionState, useEffect, useState } from 'react';
import { correct, signIn, signOut, type Result } from './actions';

/**
 * One child, with the one action that makes sense for their current state.
 *
 * Deliberately not a toggle. "Sign in" and "Sign out" are separate labelled buttons,
 * because a mis-tap on a toggle silently records the opposite of what happened and
 * attendance times decide funded hours.
 */
export function AttendanceRow({
  childId,
  name,
  underTwo,
  present,
  since,
  eventId,
  critical,
}: {
  childId: string;
  name: string;
  underTwo: boolean;
  present: boolean;
  since: string | null;
  eventId: number | null;
  critical: { label: string; name: string; plan: string | null } | null;
}) {
  const [inState, inAction, inPending] = useActionState<Result | null, FormData>(signIn, null);
  const [outState, outAction, outPending] = useActionState<Result | null, FormData>(signOut, null);
  const [correcting, setCorrecting] = useState(false);

  const error =
    (inState && 'error' in inState ? inState.error : null) ??
    (outState && 'error' in outState ? outState.error : null);

  return (
    <>
      <tr>
        <td>
          <strong>{name}</strong>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
        </td>
        <td>{underTwo ? <span className="flag flag-quiet">under 2</span> : '2+'}</td>
        <td>
          {present && since ? (
            new Date(since).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })
          ) : (
            <span className="empty">&mdash;</span>
          )}
        </td>
        <td>
          {critical ? (
            <span className="flag flag-critical" title={critical.plan ?? undefined}>
              {'▲'} {critical.label}: {critical.name}
            </span>
          ) : null}
        </td>
        <td>
          <span className="inline">
            {present ? (
              <form action={outAction}>
                <input type="hidden" name="childId" value={childId} />
                <button className="secondary small" type="submit" disabled={outPending}>
                  {outPending ? '…' : 'Sign out'}
                </button>
              </form>
            ) : (
              <form action={inAction}>
                <input type="hidden" name="childId" value={childId} />
                <button className="small" type="submit" disabled={inPending}>
                  {inPending ? '…' : 'Sign in'}
                </button>
              </form>
            )}
            {eventId !== null && (
              <button
                className="secondary small"
                type="button"
                onClick={() => setCorrecting((v) => !v)}
              >
                Fix time
              </button>
            )}
          </span>
        </td>
      </tr>
      {correcting && eventId !== null && (
        <tr>
          <td colSpan={5}>
            <CorrectionForm
              childId={childId}
              eventId={eventId}
              kind={present ? 'in' : 'out'}
              onDone={() => setCorrecting(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function CorrectionForm({
  childId,
  eventId,
  kind,
  onDone,
}: {
  childId: string;
  eventId: number;
  kind: 'in' | 'out';
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(correct, null);
  const error = state && 'error' in state ? state.error : null;
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action}>
      <input type="hidden" name="childId" value={childId} />
      <input type="hidden" name="eventId" value={eventId} />
      <input type="hidden" name="kind" value={kind} />
      <div className="row">
        <div>
          <label htmlFor={`at-${eventId}`}>Actual time</label>
          <input className="narrow" id={`at-${eventId}`} name="at" type="datetime-local" required />
        </div>
        <div style={{ flex: 1, minWidth: '14rem' }}>
          <label htmlFor={`why-${eventId}`}>Why</label>
          <input
            id={`why-${eventId}`}
            name="note"
            required
            placeholder="tablet was flat, signed in on arrival"
          />
        </div>
        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record correction'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
        This adds a correcting entry. The original stays on the record, because after an
        incident the question is what was recorded at the time.
      </p>
    </form>
  );
}
