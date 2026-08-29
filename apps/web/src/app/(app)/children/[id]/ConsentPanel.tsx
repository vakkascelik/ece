'use client';

import { useActionState, useState } from 'react';
import {
  CONSENT_DETAIL,
  CONSENT_KINDS,
  REQUIRED_CONSENTS,
  consentFor,
  consentProgress,
  missingConsents,
  type ConsentKind,
  type ConsentRequest,
  type ConsentState,
} from '@ece/core';
import { askForConsent, setConsent, type Result } from '../actions';

/**
 * Consent, one row per kind.
 *
 * Three states, not two. "Refused" and "never asked" are both falsy and are
 * completely different facts: one is a decision to respect, the other is an
 * enrolment that is not finished. Showing them the same way is how a centre ends
 * up believing it asked.
 *
 * Nothing here is ever edited. Withdrawing consent appends a new event, and the
 * history below is what "we had permission at the time" rests on — which is the
 * only question that matters once somebody complains about a photograph.
 */
export function ConsentPanel({
  childId,
  consents,
  history,
  requests,
  guardians,
  canRecord,
  isParent,
  ownGuardianId,
}: {
  childId: string;
  consents: ConsentState[];
  history: (ConsentState & { note: string | null })[];
  /** Every ask recorded for this child — 0073. Empty for a centre that has never used it. */
  requests: ConsentRequest[];
  guardians: { id: string; name: string }[];
  canRecord: boolean;
  isParent: boolean;
  ownGuardianId: string | null;
}) {
  const [showHistory, setShowHistory] = useState(false);
  /*
    `flatMap` rather than `filter` then `map`: the union narrows inside the callback, so
    `p.requestedAt` is reachable without a cast. A cast here would be the one place in this
    file where the compiler stops checking that the three states stay three.
  */
  const askedFor = new Map(
    consentProgress(consents, requests, CONSENT_KINDS).flatMap((p) =>
      p.state === 'awaiting' ? ([[p.kind, p.requestedAt]] as const) : [],
    ),
  );
  /*
    Drawn only when something is actually outstanding, which is what lets `askForConsent`
    treat a zero return as a race rather than a state. Withheld from a parent because asking
    is the centre's act — the definer function refuses them anyway, and this keeps the button
    off a screen where pressing it could only fail.
  */
  const outstanding = missingConsents(consents);
  const canAsk = !isParent && canRecord && outstanding.length > 0;

  return (
    <>
      <div className="card">
        {isParent && (
          <p className="sub" style={{ margin: '0 0 0.75rem' }}>
            These are your decisions to make, and you can change any of them at any time.
          </p>
        )}
        {isParent && !ownGuardianId && (
          <p className="error" role="alert">
            You are not recorded as a guardian for this child, so the centre needs to add you
            before you can record consent here.
          </p>
        )}

        {CONSENT_KINDS.map((kind) => (
          <ConsentRow
            key={kind}
            childId={childId}
            kind={kind}
            state={consentFor(consents, kind)}
            askedAt={askedFor.get(kind) ?? null}
            guardians={guardians}
            canRecord={canRecord && (!isParent || ownGuardianId !== null)}
            isParent={isParent}
            ownGuardianId={ownGuardianId}
          />
        ))}
      </div>

      {canAsk && <AskForm childId={childId} outstanding={outstanding.length} />}

      <p>
        <button className="secondary small" type="button" onClick={() => setShowHistory((v) => !v)}>
          {showHistory ? 'Hide history' : `History (${history.length})`}
        </button>
      </p>

      {showHistory && (
        <div className="card">
          {history.length === 0 ? (
            <p className="empty">Nothing recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>What</th>
                  <th>Decision</th>
                  <th>Given by</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h, i) => (
                  <tr key={`${h.kind}-${h.at}-${i}`}>
                    <td>{new Date(h.at).toLocaleString('en-NZ')}</td>
                    <td>{CONSENT_DETAIL[h.kind].label}</td>
                    <td>
                      {h.granted ? (
                        <span className="flag flag-ok">✓ given</span>
                      ) : (
                        <span className="flag flag-quiet">✗ withheld</span>
                      )}
                    </td>
                    <td>
                      {guardians.find((g) => g.id === h.givenBy)?.name ?? (
                        <span className="empty">not recorded</span>
                      )}
                      {h.note && <div className="sub" style={{ fontSize: '0.8125rem' }}>{h.note}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Send the family the questions they have not answered.
 *
 * One button for the whole set rather than one per row, and that is 0063's lesson applied:
 * four required consents across two guardians is eight letters for one enrolment, which is a
 * muted inbox — and a muted inbox takes the emergency channel down with it. The function
 * sends one notification per guardian however many kinds are outstanding.
 *
 * The family sees the questions on their own screen whether or not this is ever pressed.
 * This is the active nudge and the record that the centre did its part, not the only route.
 */
function AskForm({ childId, outstanding }: { childId: string; outstanding: number }) {
  const [result, action, pending] = useActionState<Result | null, FormData>(askForConsent, null);
  const error = result && 'error' in result ? result.error : null;
  const done = result !== null && 'ok' in result;

  return (
    <form action={action} className="card" style={{ marginTop: '0.75rem' }}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {done && (
        <p style={{ margin: '0 0 0.5rem' }}>
          <span className="flag flag-ok">✓ Asked</span>{' '}
          <span className="sub">
            Everyone listed as a guardian has been asked. Those without a login have been
            recorded as asked and will need a phone call.
          </span>
        </p>
      )}

      <div className="field">
        <label htmlFor="consent-ask-note">Anything to add (optional)</label>
        <input
          id="consent-ask-note"
          name="note"
          type="text"
          placeholder="We need these before the trip on the 12th"
        />
        <p className="sub" style={{ fontSize: '0.8125rem' }}>
          Goes to the family in their own words, so write it for them.
        </p>
      </div>

      <input type="hidden" name="childId" value={childId} />
      <button type="submit" disabled={pending}>
        {pending
          ? 'Asking…'
          : `Ask the whānau about ${outstanding} unanswered ${outstanding === 1 ? 'decision' : 'decisions'}`}
      </button>
    </form>
  );
}

function ConsentRow({
  childId,
  kind,
  state,
  askedAt,
  guardians,
  canRecord,
  isParent,
  ownGuardianId,
}: {
  childId: string;
  kind: ConsentKind;
  state: ConsentState | undefined;
  /** When the centre last asked, or null. Only meaningful while `state` is undefined. */
  askedAt: string | null;
  guardians: { id: string; name: string }[];
  canRecord: boolean;
  isParent: boolean;
  ownGuardianId: string | null;
}) {
  const [result, action, pending] = useActionState<Result | null, FormData>(setConsent, null);
  const error = result && 'error' in result ? result.error : null;
  const { label, detail } = CONSENT_DETAIL[kind];
  const required = REQUIRED_CONSENTS.includes(kind);

  return (
    <div className="consent">
      <div className="section-head">
        <div style={{ flex: 1 }}>
          <h3>
            {label}
            {required && !state && (
              <>
                {' '}
                <span className="flag flag-warn">◌ needed before their first day</span>
              </>
            )}
          </h3>
          <p>{detail}</p>

          {state ? (
            <p style={{ margin: 0, fontSize: '0.8125rem' }}>
              {state.granted ? (
                <span className="flag flag-ok">✓ Given</span>
              ) : (
                <span className="flag flag-quiet">✗ Withheld</span>
              )}{' '}
              <span className="sub">
                by {guardians.find((g) => g.id === state.givenBy)?.name ?? 'someone no longer listed'} on{' '}
                {new Date(state.at).toLocaleDateString('en-NZ')}
              </span>
            </p>
          ) : askedAt ? (
            /*
              The third state, and 0073 exists for it.

              "Nobody has answered" and "we asked on the 4th and nobody has answered" are
              different facts about the centre, not about the family — one is an unfinished
              enrolment, the other is a centre waiting on somebody. Showing them the same way
              is how a service tells a reviewer it never asked when it asked three times.
            */
            <p style={{ margin: 0 }}>
              <span className="flag flag-quiet">◌ Waiting for an answer</span>{' '}
              <span className="sub">
                asked {new Date(askedAt).toLocaleDateString('en-NZ')}
              </span>
            </p>
          ) : (
            <p style={{ margin: 0 }}>
              {/*
                Explicitly "not asked", never a default of no. A blank that reads as
                a refusal invents a decision the family never made.
              */}
              <span className="flag flag-quiet">Not asked</span>
            </p>
          )}
          {error && <p className="error" role="alert">{error}</p>}
        </div>

        {canRecord && (
          <form action={action} className="inline" style={{ alignItems: 'center' }}>
            <input type="hidden" name="childId" value={childId} />
            <input type="hidden" name="kind" value={kind} />
            {isParent ? (
              // A parent may only ever attribute a decision to themselves, and the
              // policy refuses anything else — this field and the select below are
              // the same field with the same enforcement behind them.
              <input type="hidden" name="givenBy" value={ownGuardianId ?? ''} />
            ) : (
              <select name="givenBy" required defaultValue={state?.givenBy ?? ''} aria-label="Given by">
                <option value="" disabled>
                  Given by
                </option>
                {guardians.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="small"
              type="submit"
              name="granted"
              value="true"
              disabled={pending || state?.granted === true}
            >
              Give
            </button>
            <button
              className="secondary small"
              type="submit"
              name="granted"
              value="false"
              disabled={pending || state?.granted === false}
            >
              Withhold
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
