'use client';

import { useActionState } from 'react';
import { RATIO_SOURCES, type RatioSource } from '@ece/core';
import { saveCentre } from './actions';

type Result = { error?: string; ok?: boolean } | null;

export function SettingsForm({
  name,
  moeServiceNumber,
  medicationRequiresWitness,
  sleepCheckMinutes,
  drillIntervalDays,
  ratioSource,
}: {
  name: string;
  moeServiceNumber: string | null;
  medicationRequiresWitness: boolean;
  /** `null` means the centre has stated no interval. Rendered as blank, not as 0. */
  sleepCheckMinutes: number | null;
  /** `null` means the centre has stated none. Rendered blank, not as 0. */
  drillIntervalDays: number | null;
  ratioSource: RatioSource;
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

      {/*
        The one setting on this page that changes what an existing record MEANS.

        Everything else here adds a rule going forward. This changes where the adult
        half of every ratio comes from — including, on screens that replay history,
        days already recorded. The wording says so, and the binder marks days whose
        source differs from the one in force. See 0040.
      */}
      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="ratioSource">Where the adult count comes from</label>
        <select id="ratioSource" name="ratioSource" defaultValue={ratioSource}>
          {RATIO_SOURCES.map((s) => (
            <option key={s} value={s}>
              {s === 'declared'
                ? 'A number staff enter on the attendance screen'
                : 'The staff who have signed themselves in'}
            </option>
          ))}
        </select>
        <p className="sub" style={{ fontSize: '0.8125rem', margin: '0.25rem 0 0' }}>
          These never mix. If you choose staff sign-in and nobody signs in, the ratio reads zero
          adults and shows a breach &mdash; that is deliberate, and it is the point of choosing
          it. Changing this also changes how days already recorded are read back, so the evidence
          binder marks any day that used the other source.
        </p>
      </div>

      <div style={{ marginBottom: '1.25rem' }}>
        <label htmlFor="drill">Days between emergency drills</label>
        <input
          id="drill"
          name="drillIntervalDays"
          type="number"
          min={1}
          max={730}
          inputMode="numeric"
          defaultValue={drillIntervalDays ?? ''}
          placeholder="not set"
        />
        <p className="sub" style={{ fontSize: '0.8125rem', margin: '0.25rem 0 0' }}>
          Leave blank and the drill log shows how long it has been without calling it late. Same
          as the sleep interval: this product does not know the required frequency and will not
          guess one.
        </p>
      </div>

      {state?.error && <p className="error" style={{ marginTop: 0 }}>{state.error}</p>}
      {state?.ok && <p className="sub" style={{ marginTop: 0 }}>Saved.</p>}

      <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
    </form>
  );
}
