'use client';

import { useActionState, useEffect, useState } from 'react';
import { correct, type Result } from './actions';
import { Status } from '../Status';

/**
 * One child, with the one action that makes sense for their current state.
 *
 * Deliberately not a toggle. "Sign in" and "Sign out" are separate labelled buttons, because a
 * mis-tap on a toggle silently records the opposite of what happened and attendance times
 * decide funded hours.
 *
 * No pending spinner and no disabled state while it saves. The write goes to a local queue and
 * returns in the same tick, so there is nothing to wait for — a spinner here would be theatre,
 * and a disabled button would make a working app feel broken on a bad connection. The SyncChip
 * carries the "not sent yet" information instead. Same reasoning as the mobile SignInButton,
 * which got there first.
 */
export function AttendanceRow({
  childId,
  name,
  monogram,
  age,
  underTwo,
  present,
  since,
  unsent,
  eventId,
  critical,
  healthCount,
  onToggle,
}: {
  childId: string;
  name: string;
  monogram: string;
  age: string;
  underTwo: boolean;
  present: boolean;
  since: string | null;
  /** This child's current state is still sitting in the outbox. */
  unsent: boolean;
  /**
   * The server event behind this state, when there is one.
   *
   * Null while the state is still queued — there is nothing on the server to correct yet, so
   * the correction control is not offered. Sending it first is the fix, and the strip above
   * the list is where that happens.
   */
  eventId: number | null;
  critical: { label: string; name: string } | null;
  /**
   * Every health condition on this child, critical or not.
   *
   * Only rendered when none of them is critical: a row carrying "▲ Anaphylaxis: peanuts"
   * does not also need "● Health: 2" beside it, and two flags on one name is how the
   * important one stops being read. Same rule the children list follows.
   */
  healthCount: number;
  onToggle: () => void;
}) {
  const [correcting, setCorrecting] = useState(false);

  return (
    <li>
      <div className="roll-row">
        {/* aria-hidden: the name is right beside it in text, and "AN" read aloud as letters is
            noise between the reader and the child's name. */}
        <span className="roll-initials" aria-hidden="true">
          {monogram}
        </span>

        <div className="roll-who">
          <span className="roll-name">{name}</span>
          <span className="roll-meta">
            <span>{age}</span>
            {underTwo && <Status tone="neutral">under 2</Status>}
            {/*
              No `title`. It was carrying the response plan, which is meaning available only to
              a mouse — not to a keyboard, not to a touch screen, and not to a screen reader in
              most engines. The plan belongs on the child's record where it can be read under
              pressure.

              role=note, per the pack: an aside about the child, read as words.
            */}
            {critical && (
              /*
                `role="note"` is why this one is not a `Status`: the role is the point, and
                a component that accepted arbitrary roles would be a `<span>` with extra
                steps. The tone and glyph are the same as `Status tone="breach"` renders.
              */
              <span className="flag flag-critical" role="note">
                <span aria-hidden="true">{'▲'}</span> {critical.label}: {critical.name}
              </span>
            )}
            {!critical && healthCount > 0 && (
              <Status tone="warn">
                Health: {healthCount}
              </Status>
            )}
            {/*
              The SyncChip. A real text node, not a dot and not a greyed row — "Waiting to
              send" is what it means, and the pack is explicit that when it lands the chip is
              *removed* rather than greyed out. A greyed chip is a state somebody has to learn.
            */}
            {unsent && <Status tone="pending">Waiting to send</Status>}
          </span>
        </div>

        <span className="roll-time">
          {present && since
            ? `In ${new Date(since).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' })}`
            : 'Not signed in'}
        </span>

        <span className="roll-action">
          <button
            className={present ? 'secondary' : undefined}
            type="button"
            onClick={onToggle}
            // The child's name is in the accessible name: there are twenty otherwise identical
            // buttons on this page. `aria-label` rather than a visually-hidden span, which put
            // the name in the DOM twice per row and broke anything matching on text.
            aria-label={present ? `Sign out ${name}` : `Sign in ${name}`}
          >
            {present ? 'Sign out' : 'Sign in'}
          </button>
          {eventId !== null && !unsent && (
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

/**
 * Fixing a time that was recorded wrongly.
 *
 * Still a server action, unlike the sign-in beside it. A correction is made at a desk by
 * somebody who has noticed a mistake — it is not the thing being tapped forty times in a
 * foyer with no signal — and it carries a mandatory reason, so there is nothing to gain from
 * queueing it and a whole class of "which correction won" questions to lose.
 */
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
      <p className="sub" style={{ margin: '0.5rem 0 0', fontSize: 'var(--text-sm)' }}>
        This adds a correcting entry. The original stays on the record, because after an
        incident the question is what was recorded at the time.
      </p>
    </form>
  );
}
