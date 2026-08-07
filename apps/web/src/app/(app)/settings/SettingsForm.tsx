'use client';

import { useActionState } from 'react';
import { saveCentre } from './actions';

type Result = { error?: string; ok?: boolean } | null;

export function SettingsForm({
  name,
  moeServiceNumber,
  medicationRequiresWitness,
  sleepCheckMinutes,
}: {
  name: string;
  moeServiceNumber: string | null;
  medicationRequiresWitness: boolean;
  /** `null` means the centre has stated no interval. Rendered as blank, not as 0. */
  sleepCheckMinutes: number | null;
}) {
  const [state, action, busy] = useActionState(saveCentre, null as Result);

  return (
    <form action={action} className="card">
      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="name">Centre name</label>
        <input id="name" name="name" defaultValue={name} required />
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="moe">Ministry of Education service number</label>
        <input
          id="moe"
          name="moeServiceNumber"
          defaultValue={moeServiceNumber ?? ''}
          inputMode="numeric"
          placeholder="46365"
        />
      </div>

      <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '1.25rem 0' }} />

      <h2 style={{ fontSize: '0.9375rem', margin: '0 0 0.75rem' }}>Daily practice</h2>
      {/*
        Both of these are the CENTRE's decisions, and the wording says so in each case.
        This product has not read the licensing criteria — `criteria` ships empty for
        that reason — so a screen that presented either as a requirement would be
        asserting a regulation nobody here has sourced.
      */}

      <div style={{ marginBottom: '1rem' }}>
        <label htmlFor="witness" className="inline" style={{ gap: '0.5rem' }}>
          <input
            id="witness"
            name="medicationRequiresWitness"
            type="checkbox"
            defaultChecked={medicationRequiresWitness}
          />
          <span>Require a second person to witness every dose of medicine</span>
        </label>
        <p className="sub" style={{ fontSize: '0.8125rem', margin: '0.25rem 0 0' }}>
          Your centre&rsquo;s policy, not a rule this product has verified. With it on, a dose
          recorded without a witness is refused.
        </p>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="sleep">Minutes between sleep checks</label>
        <input
          id="sleep"
          name="sleepCheckMinutes"
          type="number"
          min={1}
          max={120}
          inputMode="numeric"
          defaultValue={sleepCheckMinutes ?? ''}
          placeholder="not set"
        />
        <p className="sub" style={{ fontSize: '0.8125rem', margin: '0.25rem 0 0' }}>
          Leave blank and the sleep register shows how long ago each child was checked without
          calling anything overdue. This product does not know what the required interval is and
          will not guess one &mdash; state your own and the register measures against it.
        </p>
      </div>

      {state?.error && <p className="error" style={{ marginTop: 0 }}>{state.error}</p>}
      {state?.ok && <p className="sub" style={{ marginTop: 0 }}>Saved.</p>}

      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
