'use client';

import { useActionState } from 'react';
import {
  ADDRESS_FIELD_MAX,
  ADDRESS_KIND_LABELS,
  ADDRESS_KINDS,
  type ChildAddress,
} from '@ece/core';
import { removeChildAddress, saveChildAddress, type Result } from '../actions';

/**
 * Where the child lives.
 *
 * §6-1 requires an enrolment record to contain *"the child's official name, date of birth, and
 * home/residential address"*, and ELI's `ChildEnrolment` carries `PrimaryResidentialAddress` as a
 * **required** element with an optional `SecondaryResidentialAddress` beside it. `0086` is the
 * table; this is the only way in or out of it.
 *
 * ON THE WHĀNAU TAB, NOT THE DOCUMENTS TAB where the enrolment and the booking schedule live.
 * Deliberate, and the reason is that this is the one field on the record that a person will look
 * for by thinking *"where does this child live"* rather than *"what does the enrolment say"* — the
 * guardian addresses are already on this tab and somebody comparing the two should not have to
 * change tabs to do it. It is also why the panel says out loud that a guardian address is not this
 * address: the case `0086` exists for is a child living with a grandparent while the primary
 * contact is a parent somewhere else, and before today that child had no recorded address at all.
 *
 * FIVE FIELDS RATHER THAN ONE BOX, and that is the schema's doing rather than a preference.
 * `ChildEnrolmentAddress` requires `Address1Line` and `AddressCity` as separate elements. A single
 * free-text box would have to be split at the boundary, and splitting a New Zealand address by
 * guesswork puts the suburb in the street field — on a Crown return that then validates perfectly.
 * `guardians.address` stays one box because it never goes on the wire.
 *
 * TWO NAMED SLOTS, NOT A LIST. `unique (child_id, kind)` means one primary and one secondary, so
 * each form saves over whatever is there. There is no "end this address" gesture: no funding figure
 * is computed against an address, which is why `0086` replaces in place where `0085` supersedes.
 *
 * REMOVAL IS OFFERED FOR THE SECOND HOUSEHOLD ONLY. Every field of the primary is overwritable, so
 * removing it can only ever leave the enrolment record incomplete against §6-1 — whereas "this
 * child no longer has a second household" is a real change that editing cannot express, because the
 * two required fields cannot be blanked. The API function is not restricted this way; the screen is
 * the policy and Postgres is the boundary, the same split as capability-versus-RLS everywhere else.
 */
export function AddressPanel({
  childId,
  addresses,
  canEdit,
}: {
  childId: string;
  addresses: ChildAddress[];
  canEdit: boolean;
}) {
  const [saveState, save, saving] = useActionState<Result | null, FormData>(saveChildAddress, null);
  const [removeState, remove, removing] = useActionState<Result | null, FormData>(
    removeChildAddress,
    null,
  );
  // One message, beside the controls that produced it — the same narrowing `BookingSchedulePanel`
  // uses, because `Result` is a union and `.error` does not exist on the ok arm.
  const error = [saveState, removeState].find(
    (s): s is { error: string } => !!s && 'error' in s,
  )?.error;

  const byKind = new Map(addresses.map((a) => [a.kind, a]));
  const primary = byKind.get('primary') ?? null;

  return (
    <div className="card">
      {/*
        Named as a gap rather than left blank. A missing residential address is not a cosmetic
        omission: it is one of §6-1's required contents and a required element on the ELI event,
        so a record without one cannot be submitted even once submission exists.
      */}
      {!primary && (
        <p className="sub">
          <span className="flag flag-warn">Not recorded</span> The child&rsquo;s home address is
          required by the Funding Handbook as part of the enrolment record. A guardian&rsquo;s
          address above is not the same fact &mdash; a child may live with a grandparent while the
          first contact is a parent elsewhere.
        </p>
      )}

      {ADDRESS_KINDS.map((kind) => {
        const existing = byKind.get(kind) ?? null;

        // The second household is not drawn at all for somebody who cannot edit and where none is
        // recorded. An empty "Second household" heading invites the reading that there is one.
        if (kind === 'secondary' && !existing && !canEdit) return null;

        return (
          <section key={kind} style={kind === 'secondary' ? { marginTop: '1.5rem' } : undefined}>
            <h3>{ADDRESS_KIND_LABELS[kind]}</h3>

            {existing ? (
              /*
                Read back as one line, in the order a person says an address, rather than five
                stacked fields. The structure exists for the wire — the form below is where it is
                visible, and where it has to be. Nothing new in the stylesheet for this: the
                repo's own no-duplication rule cuts against a class that only one panel uses.
              */
              <p>
                {[
                  existing.address1Line,
                  existing.address2Line,
                  existing.addressCity,
                  existing.addressPostCode,
                  existing.addressCountry,
                ]
                  .filter((line): line is string => Boolean(line))
                  .join(', ')}
              </p>
            ) : (
              <p className="empty">
                {kind === 'primary' ? 'No home address recorded.' : 'No second household recorded.'}
              </p>
            )}

            {canEdit && (
              /*
                KEYED ON THE ROW, so React remounts the inputs when the row underneath them is
                replaced by a different one — or by none.

                Without it the fields are uncontrolled and keep whatever was last typed, so
                removing the second household leaves a panel reading "No second household
                recorded" above a form still holding the address that was just deleted. The
                read-back is correct and the form is a ghost, which is the worse of the two
                failures because it looks like the removal did not work.

                `existing?.id` and not `kind`: on a save that replaces an address the id does not
                change, so the form is not remounted and nothing flickers under the cursor.
              */
              <form action={save} key={existing?.id ?? 'none'}>
                <input type="hidden" name="childId" value={childId} />
                <input type="hidden" name="kind" value={kind} />
                <div className="row">
                  <div>
                    <label htmlFor={`${kind}-line1`}>Street address</label>
                    <input
                      id={`${kind}-line1`}
                      name="address1Line"
                      maxLength={ADDRESS_FIELD_MAX}
                      defaultValue={existing?.address1Line ?? ''}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor={`${kind}-line2`}>Suburb or unit (optional)</label>
                    <input
                      id={`${kind}-line2`}
                      name="address2Line"
                      maxLength={ADDRESS_FIELD_MAX}
                      defaultValue={existing?.address2Line ?? ''}
                    />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <label htmlFor={`${kind}-city`}>Town or city</label>
                    <input
                      id={`${kind}-city`}
                      name="addressCity"
                      maxLength={ADDRESS_FIELD_MAX}
                      defaultValue={existing?.addressCity ?? ''}
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor={`${kind}-postcode`}>Postcode (optional)</label>
                    <input
                      className="narrow"
                      id={`${kind}-postcode`}
                      name="addressPostCode"
                      maxLength={ADDRESS_FIELD_MAX}
                      defaultValue={existing?.addressPostCode ?? ''}
                    />
                  </div>
                  <div>
                    {/*
                      Left empty rather than defaulted to New Zealand. The element is optional and
                      nillable, and a value nobody typed is exactly the kind of figure AGENTS.md §7
                      forbids seeding — a return would then assert a country the service never
                      stated. Blank is stored as null, which is the honest answer.
                    */}
                    <label htmlFor={`${kind}-country`}>Country (optional)</label>
                    <input
                      id={`${kind}-country`}
                      name="addressCountry"
                      maxLength={ADDRESS_FIELD_MAX}
                      defaultValue={existing?.addressCountry ?? ''}
                    />
                  </div>
                  <button type="submit" disabled={saving}>
                    {existing ? 'Save' : 'Record'}
                  </button>
                </div>
              </form>
            )}

            {canEdit && existing && kind === 'secondary' && (
              <form action={remove} className="inline">
                <input type="hidden" name="childId" value={childId} />
                <input type="hidden" name="kind" value={kind} />
                <button className="secondary small" type="submit" disabled={removing}>
                  Remove the second household
                </button>
              </form>
            )}
          </section>
        );
      })}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
