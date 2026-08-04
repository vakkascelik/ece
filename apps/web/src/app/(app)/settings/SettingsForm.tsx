'use client';

import { useActionState } from 'react';
import { saveCentre } from './actions';

type Result = { error?: string; ok?: boolean } | null;

export function SettingsForm({ name, moeServiceNumber }: { name: string; moeServiceNumber: string | null }) {
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

      {state?.error && <p className="error" style={{ marginTop: 0 }}>{state.error}</p>}
      {state?.ok && <p className="sub" style={{ marginTop: 0 }}>Saved.</p>}

      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
