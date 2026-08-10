'use client';

import { useActionState, useEffect, useState } from 'react';
import { INCIDENT_KINDS, INCIDENT_KIND_LABELS } from '@ece/core';
import { openDraft, saveDraft, type Result } from './actions';

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
 * The report this form is opened from — either to correct or to replace.
 *
 * One form serves all three acts. An amendment is a *full* report, not a patch: a
 * cut-down "what changed" form would produce a document that only makes sense beside
 * the original, and the family reads the amendment on its own.
 */
export interface BasedOn {
  /**
   * `edit` corrects a draft in place. `amend` writes a new report replacing a
   * finalised one.
   *
   * The same fields and two completely different acts, which is why the mode is
   * explicit rather than inferred from the source report's status. A draft has not
   * been shown to anybody, so fixing a typo in one leaves no trace worth keeping;
   * once final the same typo costs a superseding report that marks the original as
   * replaced forever. Inferring the mode would make that distinction an accident of
   * state rather than a decision.
   */
  mode: 'edit' | 'amend';
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
  basedOn,
}: {
  childOptions: ChildOption[];
  defaultWallClock: string;
  basedOn?: BasedOn | null;
}) {
  // Opened already when correcting or amending: the person arrived by pressing Edit
  // or Amend, and
  // making them press a second button to see the form they asked for is noise.
  const [open, setOpen] = useState(Boolean(basedOn));
  // One form, two server actions. An edit updates a row; an amendment inserts one.
  const [state, action, pending] = useActionState<Result | null, FormData>(
    basedOn?.mode === 'edit' ? saveDraft : openDraft,
    null,
  );

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

  const childName = basedOn ? childOptions.find((c) => c.id === basedOn.childId)?.name : null;

  return (
    <form action={action} className="card incident-form" style={{ marginBottom: '1rem' }}>
      <div className="incident-cols">
        {/*
          The left column: what this is, and what it has to end up saying. First in the source
          as well as on the left, so that when the columns collapse on a narrow tablet somebody
          filing their first report still reads the explanation before the fields.
        */}
        <div className="incident-guide">
          <div className="incident-eyebrow">
            {basedOn?.mode === 'edit'
              ? 'Correcting a draft'
              : basedOn
                ? 'Amending a finalised report'
                : 'New report'}
          </div>
          <h2 style={{ marginTop: 0 }}>
            {basedOn?.mode === 'edit'
              ? 'Correct this draft'
              : basedOn
                ? 'Amend a report'
                : 'Record an incident'}
          </h2>

          {basedOn?.mode === 'amend' ? (
            <>
              <input type="hidden" name="supersedes" value={basedOn.id} />
              <p>
                This replaces a report that has already been finalised. The original stays on
                the register and stays readable &mdash; that is what makes freezing it worth
                anything. This one starts as a draft and has to be finalised and sent like any
                other.
              </p>
            </>
          ) : basedOn?.mode === 'edit' ? (
            <>
              <input type="hidden" name="editing" value={basedOn.id} />
              <p>
                Correcting a draft nobody outside the centre can see. It stays a draft &mdash;
                finalising is a separate, deliberate step.
              </p>
            </>
          ) : (
            <p>
              Save a draft at any point. Nothing reaches whānau until somebody finalises it on
              the register, and a finalised report can only be corrected by an amendment that
              keeps the original.
            </p>
          )}

          {/*
            The three things this report has to end up saying — not form steps, and labelled
            so nobody reads them as a wizard. Two of them are fields below; the third happens
            on the register after finalising, and saying so here is the point. A person filing
            their first report otherwise finishes this form believing the family has been told.
          */}
          <ol className="incident-steps">
            <li>
              <span className="n">1</span>
              <span>What happened, and where</span>
            </li>
            <li>
              <span className="n">2</span>
              <span>What care was given</span>
            </li>
            <li>
              <span className="n">3</span>
              <span className="elsewhere">
                Who was told &mdash; recorded on the register, after this is finalised
              </span>
            </li>
          </ol>

          {/*
            AN AMENDMENT WRITTEN WITHOUT THE ORIGINAL IN VIEW IS HOW TWO RECORDS DISAGREE.

            The fields on the right are pre-filled with these same words, so editing over them
            destroys the only copy on screen of what the family actually read. Shown as a
            quotation rather than a second set of inputs: it is not editable, it is not what
            will be saved, and it must not look like either.
          */}
          {basedOn && (
            <div className="incident-original">
              <div className="incident-eyebrow">
                {basedOn.mode === 'edit' ? 'The draft as it stands' : 'What the original said'}
              </div>
              <div style={{ fontSize: 'var(--text-sm)' }}>
                {childName ?? 'A child no longer enrolled'} &middot;{' '}
                {basedOn.occurredWallClock.replace('T', ' ')}
              </div>
              <blockquote>{basedOn.description}</blockquote>
              {basedOn.firstAidGiven && (
                <div className="sub" style={{ fontSize: 'var(--text-sm)', marginTop: '0.5rem' }}>
                  First aid: {basedOn.firstAidGiven}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="incident-fields">
          {state && 'error' in state && (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {state.error}
            </p>
          )}

          <div className="field">
        <label htmlFor="childId">Child</label>
        <select id="childId" name="childId" required defaultValue={basedOn?.childId ?? ''}>
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
        <select id="kind" name="kind" required defaultValue={basedOn?.kind ?? 'injury'}>
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
          defaultValue={basedOn?.occurredWallClock ?? defaultWallClock}
        />
      </div>

      <div className="field">
        <label htmlFor="description">What happened</label>
        <textarea id="description" name="description" rows={4} required defaultValue={basedOn?.description ?? ''} />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Write it as the child&rsquo;s whānau will read it. Once this is final it cannot be
          edited — an amendment is a new report that replaces it.
        </p>
      </div>

      <div className="field">
        <label htmlFor="location">Where (optional)</label>
        <input id="location" name="location" type="text" defaultValue={basedOn?.location ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="firstAidGiven">First aid given (optional)</label>
        <input id="firstAidGiven" name="firstAidGiven" type="text" defaultValue={basedOn?.firstAidGiven ?? ''} />
      </div>

      <div className="field">
        <label htmlFor="witnessName">Witness (optional)</label>
        <input id="witnessName" name="witnessName" type="text" defaultValue={basedOn?.witnessName ?? ''} />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          A name, not an account — a witness is often a parent collecting another child.
        </p>
      </div>

        </div>
      </div>

      {/*
        THERE IS NO FINALISE BUTTON HERE, AND THAT IS THE POINT.

        The design handover asks that Save draft and Finalise "never look alike and never sit
        adjacent without the irreversibility warning between them". This form satisfies that
        more strongly than a warning could: the two acts are on different screens. Finalising
        is a control on the register row, pressed by somebody who has read the draft back —
        not by somebody standing up holding a crying child with a form still open.

        Adding a Finalise button here to match the mockup would be undoing a decision, so it
        was not added. The sentence on the right says where finalising happens, because a form
        with only a draft button and no explanation reads like an unfinished form.
      */}
      <div className="incident-actions">
        <button type="submit" disabled={pending}>
          {pending
            ? 'Saving…'
            : basedOn?.mode === 'edit'
              ? 'Save correction'
              : basedOn
                ? 'Save amendment as draft'
                : 'Save as draft'}
        </button>
        <button className="secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <p className="incident-consequence">
          Saves a draft. Whānau are told when it is finalised on the register, and a finalised
          report cannot be edited.
        </p>
      </div>
    </form>
  );
}
