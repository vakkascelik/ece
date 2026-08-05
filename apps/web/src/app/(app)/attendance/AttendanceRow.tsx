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
  monogram,
  age,
  underTwo,
  present,
  since,
  eventId,
  critical,
}: {
  childId: string;
  name: string;
  monogram: string;
  age: string;
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
    <li>
      <div className="roll-row">
        {/* aria-hidden: the name is right beside it in text, and "AN" read aloud as
            letters is noise between the reader and the child's name. */}
        <span className="roll-initials" aria-hidden="true">
          {monogram}
        </span>

        <div className="roll-who">
          <span className="roll-name">{name}</span>
          <span className="roll-meta">
            <span>{age}</span>
            {underTwo && <span className="flag flag-quiet">under 2</span>}
            {/*
              No `title`. It was carrying the response plan, which is meaning available
              only to a mouse — not to a keyboard, not to a touch screen, and not to a
              screen reader in most engines. The design pack forbids it outright, and the
              plan belongs on the child's record where it can be read under pressure.

              role=note, per the pack's annotation: this is an aside about the child, and
              it reads as words — "Allergy: peanuts" — never as a colour or a dot.
            */}
            {critical ? (
              <span className="flag flag-critical" role="note">
                {'▲'} {critical.label}: {critical.name}
              </span>
            ) : null}
          </span>
          {error && (
            <span className="error" role="alert">
              {error}
            </span>
          )}
        </div>

        <span className="roll-time">
          {present && since
            ? `In ${new Date(since).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}`
            : 'Not signed in'}
        </span>

        <span className="roll-action">
          {present ? (
            <form action={outAction}>
              <input type="hidden" name="childId" value={childId} />
              {/*
                The child's name goes in the accessible name, so a screen reader user is
                never asked to sign out an unnamed button — there are twenty of these on
                the page and they are otherwise identical.
                `aria-label` rather than a visually-hidden text node, which was the first
                attempt: that put the child's name into the DOM twice per row, and the
                second copy is indistinguishable from the first to anything matching on
                text. It broke a test that expected one match, and it would equally have
                broken a find-in-page. The visible label is a prefix of the accessible
                one, which is what WCAG 2.5.3 asks for.
              */}
              <button
                className="secondary"
                type="submit"
                disabled={outPending}
                aria-label={`Sign out ${name}`}
              >
                {outPending ? '…' : 'Sign out'}
              </button>
            </form>
          ) : (
            <form action={inAction}>
              <input type="hidden" name="childId" value={childId} />
              <button type="submit" disabled={inPending} aria-label={`Sign in ${name}`}>
                {inPending ? '…' : 'Sign in'}
              </button>
            </form>
          )}
          {eventId !== null && (
            <button
              className="secondary small"
              type="button"
              onClick={() => setCorrecting((v) => !v)}
              aria-label={`Fix time for ${name}`}
              aria-expanded={correcting}
            >
              Fix time
            </button>
          )}
        </span>
      </div>

      {correcting && eventId !== null && (
        <div className="roll-correct">
          <CorrectionForm
            childId={childId}
            eventId={eventId}
            kind={present ? 'in' : 'out'}
            onDone={() => setCorrecting(false)}
          />
        </div>
      )}
    </li>
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
