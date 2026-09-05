'use client';

import { useActionState } from 'react';
import { PARITY_ATTESTATION_CODES, type Rs7Declaration } from '@ece/core';
import { saveDeclaration } from './actions';

type Result = { ok: true } | { error: string };

/**
 * The RS7 declaration — six fields, none of them derivable.
 *
 * WHY RADIO GROUPS AND NOT CHECKBOXES, which is the only real design decision here.
 *
 * A checkbox posts nothing when it is unticked, so a form built from checkboxes cannot tell
 * *answered no* from *did not answer*. For an operational setting that distinction is pedantry.
 * For a legal attestation about how a service pays its teachers it is the whole thing: an
 * unsigned declaration is not a denial, and a checkbox would quietly turn one into the other
 * the first time somebody opened the page and saved.
 *
 * So each attestation is three explicit choices and *Not stated* is the default. It is more
 * clicks and it is the only shape that can represent what is actually true.
 *
 * Nothing here explains what a parity step means. The product does not know, and the six values
 * come from the Ministry's own schema — a helpful gloss would be this screen inventing
 * regulatory content in the place it matters most.
 */
export function DeclarationForm({
  periodStartDate,
  periodLabel,
  declaration,
}: {
  periodStartDate: string;
  periodLabel: string;
  declaration: Rs7Declaration | null;
}) {
  const [state, submit, saving] = useActionState<Result | null, FormData>(saveDeclaration, null);

  const tri = (value: boolean | null) => (value === true ? 'yes' : value === false ? 'no' : '');

  return (
    <form action={submit} className="stack">
      <input type="hidden" name="periodStartDate" value={periodStartDate} />

      <p className="sub">
        Every field below is a statement by your service. Nothing here is worked out from your
        records, and nothing is filled in for you — including the answer <em>no</em>.
      </p>

      <fieldset>
        <legend>Registered teachers&rsquo; salaries attestation</legend>
        {(
          [
            ['', 'Not stated'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ] as const
        ).map(([value, label]) => (
          <label key={`sal-${value}`} className="choice">
            <input
              type="radio"
              name="salariesAttestation"
              value={value}
              defaultChecked={tri(declaration?.salariesAttestation ?? null) === value}
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Pay parity attestation</legend>
        {(
          [
            ['', 'Not stated'],
            ['yes', 'Yes'],
            ['no', 'No'],
          ] as const
        ).map(([value, label]) => (
          <label key={`par-${value}`} className="choice">
            <input
              type="radio"
              name="parityAttestation"
              value={value}
              defaultChecked={tri(declaration?.parityAttestation ?? null) === value}
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>

      <label htmlFor="parityAttestationCode">Pay parity step</label>
      <select
        id="parityAttestationCode"
        name="parityAttestationCode"
        defaultValue={declaration?.parityAttestationCode ?? ''}
      >
        <option value="">Not stated</option>
        {PARITY_ATTESTATION_CODES.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>

      <label htmlFor="submitterName">Submitted by</label>
      <input
        id="submitterName"
        name="submitterName"
        defaultValue={declaration?.submitterName ?? ''}
        autoComplete="off"
      />

      <label htmlFor="contactNumber">Contact number</label>
      <input
        id="contactNumber"
        name="contactNumber"
        defaultValue={declaration?.contactNumber ?? ''}
        autoComplete="off"
      />

      <label htmlFor="designation">Designation</label>
      <input
        id="designation"
        name="designation"
        defaultValue={declaration?.designation ?? ''}
        autoComplete="off"
      />

      <div>
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : `Save the declaration for ${periodLabel}`}
        </button>
      </div>

      {state && 'error' in state && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {state && 'ok' in state && (
        <p role="status" className="sub">
          Saved. This is still preparation — nothing has been submitted.
        </p>
      )}
    </form>
  );
}
