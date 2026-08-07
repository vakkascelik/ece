'use client';

import { useActionState, useEffect, useState } from 'react';
import { INCIDENT_KINDS, INCIDENT_KIND_LABELS } from '@ece/core';
import { openDraft, type Result } from './actions';

export interface ChildOption {
  id: string;
  name: string;
}

/**
 * Opening a report.
 *
 * Collapsed behind a button rather than sitting open, because this page is read far
 * more often than it is written to — the common visit is a manager checking what is
 * outstanding, not somebody filing.
 *
 * The submit button says "Save as draft" and there is no second button beside it.
 * A "save and send" would be pressed by somebody standing up holding a crying child,
 * and final is the version a family reads and nobody can edit afterwards.
 */
// Named `childOptions`, not `children`. In this domain that word means the tamariki at the
// centre AND React's own slot prop, and a component whose `children` is a select list is a
// trap for whoever edits it next.
/**
 * The report being replaced, when this form is opened as an amendment.
 *
 * A finalised report freezes — 0030's trigger refuses an edit — so a correction is a
 * new row carrying `supersedes`. Reusing this form rather than building a second one
 * is deliberate: an amendment is a full report, not a patch, and a cut-down "what
 * changed" form would produce a document that only makes sense next to the original.
 * The family reads the amendment on its own.
 */
export interface Amending {
  id: string;
  childId: string;
  kind: string;
  occurredWallClock: string;
  description: string;
  location: string | null;
  firstAidGiven: string | null;
  witnessName: string | null;
}

export function NewIncident({
  childOptions,
  defaultWallClock,
  amending,
}: {
  childOptions: ChildOption[];
  defaultWallClock: string;
  amending?: Amending | null;
}) {
  // Opened already when amending: the person arrived here by pressing Amend, and
  // making them press a second button to see the form they asked for is noise.
  const [open, setOpen] = useState(Boolean(amending));
  const [state, action, pending] = useActionState<Result | null, FormData>(openDraft, null);

  // In an effect, not during render. Closing the form is a consequence of the action
  // having succeeded, and calling setState in the render body to react to it is the
  // shape React warns about — it happens to work for this component and stops working
  // the moment anything else subscribes to the same state.
  useEffect(() => {
    if (state && 'ok' in state) setOpen(false);
  }, [state]);

  if (!open) {
    return (
      <p style={{ margin: '0 0 1rem' }}>
        <button className="secondary" type="button" onClick={() => setOpen(true)}>
          Record an incident
        </button>
      </p>
    );
  }

  return (
    <form action={action} className="card" style={{ marginBottom: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>{amending ? 'Amend a report' : 'Record an incident'}</h2>
      {amending && (
        <>
          <input type="hidden" name="supersedes" value={amending.id} />
          <p className="sub">
            This replaces a report that has already been finalised. The original stays on the
            register and stays readable &mdash; that is what makes freezing it worth anything.
            This one starts as a draft and has to be finalised and sent like any other.
          </p>
        </>
      )}

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor="childId">Child</label>
        <select id="childId" name="childId" required defaultValue={amending?.childId ?? ''}>
          <option value="" disabled>
            Choose a child
          </option>
          {childOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="kind">What kind</label>
        <select id="kind" name="kind" required defaultValue={amending?.kind ?? 'injury'}>
          {INCIDENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {INCIDENT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="occurredAt">When it happened</label>
        {/*
          Defaulted to now in the CENTRE's zone, computed on the server and passed in.
          `new Date()` in the browser would use the device's zone, which is right on a
          tablet in the room and wrong on a laptop somebody has taken to a conference.
        */}
        <input
          id="occurredAt"
          name="occurredAt"
          type="datetime-local"
          required
          defaultValue={amending?.occurredWallClock ?? defaultWallClock}
        />
      </div>

      <div className="field">
        <label htmlFor="description">What happened</label>
        <textarea id="description" name="description" rows={4} required defaultValue={amending?.description ?? ''} />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Write it as the child&rsquo;s whānau will read it. Once this is final it cannot be
          edited — an amendment is a new report that replaces it.
        </p>
      </div>

      <div className="field">
        <label htmlFor="location">Where (optional)</label>
        <input id="location" name="location" type="text" defaultValue={amending?.location ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="firstAidGiven">First aid given (optional)</label>
        <input id="firstAidGiven" name="firstAidGiven" type="text" defaultValue={amending?.firstAidGiven ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="witnessName">Witness (optional)</label>
        <input id="witnessName" name="witnessName" type="text" defaultValue={amending?.witnessName ?? ''} />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          A name, not an account — a witness is often a parent collecting another child.
        </p>
      </div>

      <div className="inline">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : amending ? 'Save amendment as draft' : 'Save as draft'}
        </button>
        <button className="secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
