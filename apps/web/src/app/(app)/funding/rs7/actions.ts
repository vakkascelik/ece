'use server';

import { revalidatePath } from 'next/cache';
import { saveRs7Declaration } from '@ece/api';
import { PARITY_ATTESTATION_CODES, type ParityAttestationCode } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { actionError } from '@/lib/actionError';

/**
 * Record the RS7 declaration for a period.
 *
 * THE THREE-STATE READ OF A CHECKBOX, which is the whole difficulty here. A checkbox posts
 * nothing when unticked, so a form cannot tell "answered no" from "did not answer" — and for a
 * legal attestation those are entirely different statements. So the attestations are radio
 * groups with an explicit *Not stated* option, and this action maps the missing case to `null`
 * rather than to `false`.
 *
 * A service that has not answered has not answered no, and an attestation defaulted to false
 * would be this product making a statement to the Crown on the service's behalf.
 */
export async function saveDeclaration(_state: unknown, form: FormData) {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();

  const periodStartDate = String(form.get('periodStartDate') ?? '');
  if (!/^\d{4}-(02|06|10)-01$/.test(periodStartDate)) {
    // The pattern is the schema's own `RS7PeriodStartDate`. A value outside it could only come
    // from a hand-edited form, and the database would refuse it anyway.
    return actionError(new Error('That is not an RS7 period start date.'), 'saveDeclaration');
  }

  const tri = (name: string): boolean | null => {
    const raw = form.get(name);
    if (raw === 'yes') return true;
    if (raw === 'no') return false;
    return null;
  };

  const text = (name: string): string | null => {
    const value = String(form.get(name) ?? '').trim();
    return value.length > 0 ? value : null;
  };

  const rawCode = String(form.get('parityAttestationCode') ?? '');
  /*
    Validated against the shared list rather than passed through. An unlisted step would be
    refused by 0096's CHECK with a message naming a constraint; catching it here lets the screen
    say which field is wrong. `PARITY_ATTESTATION_CODES` is the one source — the CHECK and this
    list are the same six values, and a third copy is how they start to disagree.
  */
  const parityAttestationCode =
    rawCode === ''
      ? null
      : (PARITY_ATTESTATION_CODES as readonly string[]).includes(rawCode)
        ? (rawCode as ParityAttestationCode)
        : undefined;

  if (parityAttestationCode === undefined) {
    return actionError(
      new Error('That is not one of the pay parity steps the RS7 return allows.'),
      'saveDeclaration',
    );
  }

  try {
    await saveRs7Declaration(db, ctx.centre.id, periodStartDate, {
      salariesAttestation: tri('salariesAttestation'),
      parityAttestation: tri('parityAttestation'),
      parityAttestationCode,
      submitterName: text('submitterName'),
      contactNumber: text('contactNumber'),
      designation: text('designation'),
    });
  } catch (e) {
    return actionError(e, 'saveDeclaration');
  }

  revalidatePath('/funding/rs7');
  return { ok: true as const };
}
