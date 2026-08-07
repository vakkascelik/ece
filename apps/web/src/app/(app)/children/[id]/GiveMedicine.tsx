'use client';

import { useActionState, useEffect, useState } from 'react';
import { giveMedicine, type Result } from '../actions';

export interface WitnessOption {
  userId: string;
  label: string;
}

/**
 * Recording that a dose was actually given.
 *
 * Separate from the authority table's row markup so the `client_uuid` lifecycle has
 * somewhere to live — see below, because it is the part of this that is dangerous to
 * get wrong.
 */
export function GiveMedicine({
  childId,
  authorityId,
  authorisedDose,
  requiresWitness,
  witnesses,
  currentUserId,
}: {
  childId: string;
  authorityId: string;
  authorisedDose: string;
  requiresWitness: boolean;
  witnesses: WitnessOption[];
  currentUserId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<Result | null, FormData>(giveMedicine, null);

  /*
    THE KEY, AND WHY IT IS REGENERATED RATHER THAN FIXED

    `client_uuid` is unique and the write is `ON CONFLICT DO NOTHING`, so a repeated
    key is silently treated as "already recorded". That is exactly right for a retry
    and exactly wrong for a second dose: generate the key once at mount and the 2pm
    paracetamol would be discarded as a duplicate of the 10am one, with the UI
    reporting success. A silently dropped dose is far worse than a duplicated record,
    which is visible and correctable with `corrects`.

    So the key is minted per submission — fresh after every success — and held stable
    while a submission is in flight, which is what makes a double-click safe.

    Generated in an effect rather than in `useState`'s initialiser because this
    component server-renders first: two different random values across the hydration
    boundary is a mismatch. The button is disabled until it exists.
  */
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(crypto.randomUUID()), []);
  useEffect(() => {
    if (state && 'ok' in state) {
      setKey(crypto.randomUUID());
      setOpen(false);
    }
  }, [state]);

  if (!open) {
    return (
      <button className="small" type="button" onClick={() => setOpen(true)}>
        Record a dose
      </button>
    );
  }

  return (
    <form action={action} style={{ marginTop: '0.5rem' }}>
      <input type="hidden" name="childId" value={childId} />
      <input type="hidden" name="authorityId" value={authorityId} />
      <input type="hidden" name="clientUuid" value={key ?? ''} />

      {state && 'error' in state && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="field">
        <label htmlFor={`dose-${authorityId}`}>Dose actually given</label>
        {/*
          Prefilled from the authority and editable, which is the point. Half a dose
          because the child spat it out is the entry a reviewer most wants to find,
          and a read-only field would force the person to record something untrue.
        */}
        <input
          id={`dose-${authorityId}`}
          name="doseGiven"
          type="text"
          required
          defaultValue={authorisedDose}
        />
      </div>

      {requiresWitness && (
        <div className="field">
          <label htmlFor={`witness-${authorityId}`}>Witnessed by</label>
          <select id={`witness-${authorityId}`} name="witnessedBy" required defaultValue="">
            <option value="" disabled>
              Who watched
            </option>
            {witnesses
              // A witness who is the person administering is not a witness, and the
              // CHECK in 0032 refuses it — so it is not offered.
              .filter((w) => w.userId !== currentUserId)
              .map((w) => (
                <option key={w.userId} value={w.userId}>
                  {w.label}
                </option>
              ))}
          </select>
          <p className="sub" style={{ fontSize: '0.8125rem' }}>
            This centre has chosen to require a second person. It is a centre setting, not a rule
            this product has verified.
          </p>
        </div>
      )}

      <div className="inline">
        <button type="submit" disabled={pending || key === null}>
          {pending ? 'Recording…' : 'Record dose'}
        </button>
        <button className="secondary" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
