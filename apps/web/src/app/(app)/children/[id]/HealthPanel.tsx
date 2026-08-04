'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  HEALTH_KINDS,
  HEALTH_KIND_LABELS,
  HEALTH_SEVERITIES,
  isMedicationCurrent,
  type HealthCondition,
  type MedicationAuthority,
} from '@ece/core';
import { addCondition, addMedication, resolveCondition, type Result } from '../actions';

/**
 * Allergies, conditions and medication authorities.
 *
 * Educators can write here, unlike enrolment details — something disclosed at the
 * door at 8am has to be recordable by the person who was told, not queued for
 * whoever has manager access.
 */
export function HealthPanel({
  childId,
  conditions,
  medications,
  guardians,
  canEdit,
  today,
}: {
  childId: string;
  conditions: HealthCondition[];
  medications: MedicationAuthority[];
  guardians: { id: string; name: string }[];
  canEdit: boolean;
  /** The date at the centre. Passed in rather than computed — see the child page. */
  today: string;
}) {
  const [adding, setAdding] = useState(false);
  const [addingMed, setAddingMed] = useState(false);

  return (
    <>
      <div className="card">
        {conditions.length === 0 ? (
          <p className="empty">Nothing recorded.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>What</th>
                <th>Type</th>
                <th>Severity</th>
                <th>What to do</th>
                {canEdit && <th style={{ width: '1%' }}>
                <span className="visually-hidden">Actions</span>
              </th>}
              </tr>
            </thead>
            <tbody>
              {conditions.map((c) => (
                <ConditionRow key={c.id} childId={childId} condition={c} canEdit={canEdit} />
              ))}
            </tbody>
          </table>
        )}

        {canEdit && !adding && (
          <p style={{ margin: '0.75rem 0 0' }}>
            <button className="secondary small" type="button" onClick={() => setAdding(true)}>
              Record an allergy or condition
            </button>
          </p>
        )}
        {canEdit && adding && <ConditionForm childId={childId} onDone={() => setAdding(false)} />}
      </div>

      <div className="card">
        <h3 style={{ fontSize: '0.9375rem', margin: '0 0 0.5rem' }}>Medication authorities</h3>
        {medications.length === 0 ? (
          <p className="empty">None. Medicine may not be given without one.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Medicine</th>
                <th>Dose</th>
                <th>Authorised by</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {medications.map((m) => {
                const current = isMedicationCurrent(m, today);
                return (
                  <tr key={m.id}>
                    <td>
                      <strong>{m.medicine}</strong>
                      {m.route && <span className="sub"> · {m.route}</span>}
                    </td>
                    <td>{m.dose}</td>
                    <td>{guardians.find((g) => g.id === m.authorisedBy)?.name ?? '—'}</td>
                    <td>
                      {/*
                        A lapsed authority shown the same way as a live one is how
                        medicine gets given without one, so the state is spelled out
                        with a symbol and a word rather than left to a date.
                      */}
                      {current ? (
                        <span className="flag flag-ok">
                          ✓ In force{m.expiresOn ? ` to ${m.expiresOn}` : ''}
                        </span>
                      ) : (
                        <span className="flag flag-warn">
                          ◌ {m.expiresOn && m.expiresOn < m.startsOn ? 'Invalid' : 'Expired'}
                          {m.expiresOn ? ` ${m.expiresOn}` : ''}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {canEdit && !addingMed && (
          <p style={{ margin: '0.75rem 0 0' }}>
            <button className="secondary small" type="button" onClick={() => setAddingMed(true)}>
              Record an authority
            </button>
          </p>
        )}
        {canEdit && addingMed && (
          <MedicationForm childId={childId} guardians={guardians} today={today} onDone={() => setAddingMed(false)} />
        )}
      </div>
    </>
  );
}

function ConditionRow({
  childId,
  condition,
  canEdit,
}: {
  childId: string;
  condition: HealthCondition;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(resolveCondition, null);
  const error = state && 'error' in state ? state.error : null;

  return (
    <tr>
      <td>
        <strong>{condition.name}</strong>
        {error && <div className="error" role="alert">{error}</div>}
      </td>
      <td>{HEALTH_KIND_LABELS[condition.kind]}</td>
      <td>
        {condition.severity === 'anaphylaxis' ? (
          <span className="flag flag-critical">▲ Anaphylaxis</span>
        ) : condition.severity === 'severe' ? (
          <span className="flag flag-critical">▲ Severe</span>
        ) : condition.severity ? (
          <span className="flag flag-warn">● {condition.severity}</span>
        ) : (
          <span className="empty">—</span>
        )}
      </td>
      <td>{condition.responsePlan ?? <span className="empty">No plan recorded</span>}</td>
      {canEdit && (
        <td>
          <form action={action}>
            <input type="hidden" name="conditionId" value={condition.id} />
            <input type="hidden" name="childId" value={childId} />
            <button className="secondary small" type="submit" disabled={pending}>
              Resolved
            </button>
          </form>
        </td>
      )}
    </tr>
  );
}

function ConditionForm({ childId, onDone }: { childId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addCondition, null);
  const [severity, setSeverity] = useState('');
  const error = state && 'error' in state ? state.error : null;
  // In an effect, not in the render body: calling the parent's setState during
  // render is a React error, and it is the kind that only shows up in the console.
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <input type="hidden" name="childId" value={childId} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="name">What</label>
            <input id="name" name="name" required placeholder="Peanuts" />
          </div>
          <div>
            <label htmlFor="kind">Type</label>
            <select id="kind" name="kind" defaultValue="allergy">
              {HEALTH_KINDS.map((k) => (
                <option key={k} value={k}>
                  {HEALTH_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="severity">Severity</label>
            <select
              className="narrow"
              id="severity"
              name="severity"
              value={severity}
              onChange={(e) => setSeverity(e.target.value)}
            >
              <option value="">Not applicable</option>
              {HEALTH_SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="responsePlan">
            What to do{severity === 'anaphylaxis' ? ' (required for anaphylaxis)' : ''}
          </label>
          <textarea
            id="responsePlan"
            name="responsePlan"
            rows={2}
            required={severity === 'anaphylaxis'}
            placeholder="EpiPen is in the office cupboard. Call an ambulance, then ring Mum."
          />
        </div>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="inline">
          <button type="submit" disabled={pending}>
            {pending ? 'Recording…' : 'Record'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}

function MedicationForm({
  childId,
  guardians,
  today,
  onDone,
}: {
  childId: string;
  guardians: { id: string; name: string }[];
  today: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState<Result | null, FormData>(addMedication, null);
  const error = state && 'error' in state ? state.error : null;
  // In an effect, not in the render body: calling the parent's setState during
  // render is a React error, and it is the kind that only shows up in the console.
  useEffect(() => {
    if (state && 'ok' in state) onDone();
  }, [state, onDone]);

  return (
    <form action={action} style={{ marginTop: '1rem', borderTop: '1px solid var(--line)', paddingTop: '1rem' }}>
      <input type="hidden" name="childId" value={childId} />
      <div className="stack">
        <div className="row">
          <div>
            <label htmlFor="medicine">Medicine</label>
            <input id="medicine" name="medicine" required />
          </div>
          <div>
            <label htmlFor="dose">Dose</label>
            <input className="narrow" id="dose" name="dose" required placeholder="5ml" />
          </div>
          <div>
            <label htmlFor="route">Route</label>
            <input className="narrow" id="route" name="route" placeholder="oral" />
          </div>
        </div>

        <div className="row">
          <div>
            <label htmlFor="authorisedBy">Authorised by</label>
            <select id="authorisedBy" name="authorisedBy" required defaultValue="">
              <option value="" disabled>
                Which guardian
              </option>
              {guardians.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="startsOn">From</label>
            <input className="narrow" id="startsOn" name="startsOn" type="date" defaultValue={today} required />
          </div>
          <div>
            <label htmlFor="expiresOn">Until</label>
            <input className="narrow" id="expiresOn" name="expiresOn" type="date" />
          </div>
        </div>

        <div>
          <label htmlFor="instructions">Instructions</label>
          <textarea id="instructions" name="instructions" rows={2} />
        </div>

        {guardians.length === 0 && (
          <p className="error" role="alert">Add a guardian first — an authority has to come from someone.</p>
        )}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="inline">
          <button type="submit" disabled={pending || guardians.length === 0}>
            {pending ? 'Recording…' : 'Record authority'}
          </button>
          <button className="secondary" type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </div>
    </form>
  );
}
