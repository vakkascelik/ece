'use server';

/**
 * Every Phase 1 mutation.
 *
 * All of them return `{ error }` rather than throwing, so the forms can show a
 * sentence in place of a Next error screen — which means the forms are client
 * components using `useActionState`, since a form `action` must return void.
 *
 * None of them check who the caller is beyond a capability gate for the redirect.
 * The policies in `0004_children.sql` are the enforcement: a parent calling
 * `saveChild` gets a refusal from Postgres, not from here. The gates exist so a
 * user never sees a button that would fail.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  acknowledgeIncident,
  addCustodyArrangement,
  addHealthCondition,
  addMedicationAuthority,
  archiveChild,
  createChild,
  createEnrolment,
  createGuardian,
  linkGuardian,
  recordAdministration,
  recordConsent,
  recordImmunisation,
  resolveHealthCondition,
  revokeGuardianLink,
  supersedeCustodyArrangement,
  updateChild,
  updateEnrolment,
  updateGuardian,
  updateGuardianLink,
} from '@ece/api';
import {
  CONSENT_KINDS,
  GENDERS,
  HEALTH_KINDS,
  HEALTH_SEVERITIES,
  IMMUNISATION_STATUSES,
  todayInZone,
  type ConsentKind,
  type Gender,
  type HealthKind,
  type HealthSeverity,
  type ImmunisationStatus,
} from '@ece/core';
import { actionError } from '@/lib/actionError';
import { requireCapability, requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

export type Result = { error: string } | { ok: true };

const str = (f: FormData, k: string): string => (f.get(k) ?? '').toString().trim();
const bool = (f: FormData, k: string): boolean => f.get(k) === 'on' || f.get(k) === 'true';

/** Fails closed on an unrecognised value rather than passing it to Postgres. */
function oneOf<T extends string>(value: string, allowed: readonly T[]): T | null {
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Child record
// ---------------------------------------------------------------------------

export async function enrolChild(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageChildren');
  const db = await serverDb();

  const firstName = str(form, 'firstName');
  const lastName = str(form, 'lastName');
  const dateOfBirth = str(form, 'dateOfBirth');

  if (!firstName || !lastName) return { error: 'A first and last name are both required.' };
  if (!ISO_DATE.test(dateOfBirth)) return { error: 'A date of birth is required.' };
  // The centre's date, not the server's. A Next server runs in UTC, which is
  // yesterday for the whole New Zealand morning — so this rejected a baby born
  // that morning as being "in the future".
  if (dateOfBirth > todayInZone(ctx.centre.timezone)) {
    return { error: 'That date of birth is in the future.' };
  }

  const gender = str(form, 'gender');

  try {
    const child = await createChild(db, ctx.centre.id, {
      firstName,
      lastName,
      preferredName: str(form, 'preferredName') || null,
      dateOfBirth,
      moeNsn: str(form, 'moeNsn') || null,
      // Up to three; the database enforces the cap too.
      ethnicities: str(form, 'ethnicities')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
        .slice(0, 3),
      iwi: str(form, 'iwi') || null,
      firstLanguage: str(form, 'firstLanguage') || null,
      gender: gender ? oneOf<Gender>(gender, GENDERS) : null,
    });
    redirect(`/children/${child.id}`);
  } catch (e) {
    // `redirect` throws by design, so it must not be swallowed as a failure.
    if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e;
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    const message = e instanceof Error ? e.message : 'Could not enrol the child.';
    if (message.includes('children_nsn_unique_per_centre')) {
      return { error: 'Another child at this centre already has that NSN.' };
    }
    return { error: message };
  }
}

export async function saveChild(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageChildren');
  const db = await serverDb();
  const childId = str(form, 'childId');
  if (!childId) return { error: 'Missing child.' };

  const gender = str(form, 'gender');

  try {
    await updateChild(db, childId, {
      firstName: str(form, 'firstName'),
      lastName: str(form, 'lastName'),
      preferredName: str(form, 'preferredName') || null,
      moeNsn: str(form, 'moeNsn') || null,
      ethnicities: str(form, 'ethnicities')
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean)
        .slice(0, 3),
      iwi: str(form, 'iwi') || null,
      firstLanguage: str(form, 'firstLanguage') || null,
      gender: gender ? oneOf<Gender>(gender, GENDERS) : null,
    });
  } catch (e) {
    return actionError(e, 'saveChild');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function archive(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageChildren');
  const db = await serverDb();
  const childId = str(form, 'childId');
  if (!childId) return { error: 'Missing child.' };
  try {
    await archiveChild(db, childId);
  } catch (e) {
    return actionError(e, 'archive');
  }
  revalidatePath('/children');
  redirect('/children');
}

// ---------------------------------------------------------------------------
// Whānau
// ---------------------------------------------------------------------------

export async function addGuardian(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageChildren');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const fullName = str(form, 'fullName');
  const relationship = str(form, 'relationship');
  if (!childId) return { error: 'Missing child.' };
  if (!fullName) return { error: 'A name is required.' };
  if (!relationship) {
    return { error: 'Say how they are related — "mother", "grandmother", "whāngai caregiver".' };
  }

  try {
    // A guardian record and the link to the child are two things, because one
    // person is often guardian to siblings and should not be entered twice.
    const guardian = await createGuardian(db, ctx.centre.id, {
      fullName,
      email: str(form, 'email') || null,
      phone: str(form, 'phone') || null,
      address: str(form, 'address') || null,
    });
    await linkGuardian(db, {
      childId,
      guardianId: guardian.id,
      relationship,
      isPrimary: bool(form, 'isPrimary'),
      canCollect: bool(form, 'canCollect'),
      isEmergencyContact: bool(form, 'isEmergencyContact'),
      contactPriority: Number(str(form, 'contactPriority')) || 100,
    });
  } catch (e) {
    return actionError(e, 'addGuardian');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

/**
 * Edit a guardian and their relationship to this child in one submit.
 *
 * Two tables, because one person is often guardian to siblings: their phone number
 * belongs to them and is shared across their children, while `can_collect` and the
 * ring order belong to the link and can differ per child. Splitting it into two
 * forms would make that distinction the user's problem.
 */
export async function editGuardian(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageChildren');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const guardianId = str(form, 'guardianId');
  const linkId = str(form, 'linkId');
  const fullName = str(form, 'fullName');
  const relationship = str(form, 'relationship');

  if (!childId || !guardianId || !linkId) return { error: 'Missing details.' };
  if (!fullName) return { error: 'A name is required.' };
  if (!relationship) return { error: 'Say how they are related.' };

  try {
    await updateGuardian(db, guardianId, {
      fullName,
      email: str(form, 'email') || null,
      phone: str(form, 'phone') || null,
      address: str(form, 'address') || null,
    });
    await updateGuardianLink(db, linkId, {
      relationship,
      isPrimary: bool(form, 'isPrimary'),
      canCollect: bool(form, 'canCollect'),
      isEmergencyContact: bool(form, 'isEmergencyContact'),
      contactPriority: Number(str(form, 'contactPriority')) || 100,
    });
  } catch (e) {
    return actionError(e, 'editGuardian');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function unlinkGuardian(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageChildren');
  const db = await serverDb();
  const linkId = str(form, 'linkId');
  const childId = str(form, 'childId');
  if (!linkId) return { error: 'Missing link.' };
  try {
    await revokeGuardianLink(db, linkId);
  } catch (e) {
    return actionError(e, 'unlinkGuardian');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Enrolment
// ---------------------------------------------------------------------------

export async function fileEnrolment(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCapability('manageEnrolment');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const startDate = str(form, 'startDate');
  const endDate = str(form, 'endDate');
  if (!childId) return { error: 'Missing child.' };
  if (!ISO_DATE.test(startDate)) return { error: 'A start date is required.' };
  if (endDate && !ISO_DATE.test(endDate)) return { error: 'That end date is not a date.' };
  if (endDate && endDate < startDate) return { error: 'The end date is before the start date.' };

  const hours = Number(str(form, 'fundedHoursPerWeek') || '0');
  if (!Number.isFinite(hours) || hours < 0 || hours > 50) {
    return { error: 'Funded hours must be between 0 and 50.' };
  }

  const days = form
    .getAll('days')
    .map((d) => Number(d.toString()))
    .filter((d) => d >= 1 && d <= 7);

  try {
    await createEnrolment(db, {
      childId,
      centreId: ctx.centre.id,
      startDate,
      endDate: endDate || null,
      fundedHoursPerWeek: hours,
      twentyHoursEce: bool(form, 'twentyHoursEce'),
      days,
      notes: str(form, 'notes') || null,
    });
  } catch (e) {
    // createEnrolment already translates the overlap constraint into a sentence a
    // centre manager can act on.
    return { error: e instanceof Error ? e.message : 'Could not file the enrolment.' };
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function endEnrolment(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageEnrolment');
  const db = await serverDb();
  const enrolmentId = str(form, 'enrolmentId');
  const childId = str(form, 'childId');
  const endDate = str(form, 'endDate');
  if (!enrolmentId) return { error: 'Missing enrolment.' };
  if (!ISO_DATE.test(endDate)) return { error: 'A last day is required.' };

  try {
    await updateEnrolment(db, enrolmentId, { endDate });
  } catch (e) {
    return actionError(e, 'endEnrolment');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function addCondition(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordHealth');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const name = str(form, 'name');
  const kind = oneOf<HealthKind>(str(form, 'kind'), HEALTH_KINDS);
  const severityRaw = str(form, 'severity');
  const severity = severityRaw ? oneOf<HealthSeverity>(severityRaw, HEALTH_SEVERITIES) : null;

  if (!childId) return { error: 'Missing child.' };
  if (!name) return { error: 'What is it? e.g. "Peanuts", "Asthma".' };
  if (!kind) return { error: 'Choose allergy, condition or dietary requirement.' };
  if (severityRaw && !severity) return { error: 'That severity is not one of the options.' };
  // The response plan is what an educator reads while it is happening. An
  // anaphylaxis entry without one is worse than no entry, because it looks handled.
  if (severity === 'anaphylaxis' && !str(form, 'responsePlan')) {
    return { error: 'Anaphylaxis needs a response plan — what to do, and where the EpiPen is.' };
  }

  try {
    await addHealthCondition(db, {
      childId,
      kind,
      name,
      severity,
      responsePlan: str(form, 'responsePlan') || null,
    });
  } catch (e) {
    return actionError(e, 'addCondition');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function resolveCondition(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordHealth');
  const db = await serverDb();
  const id = str(form, 'conditionId');
  const childId = str(form, 'childId');
  if (!id) return { error: 'Missing condition.' };
  try {
    await resolveHealthCondition(db, id);
  } catch (e) {
    return actionError(e, 'resolveCondition');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function addMedication(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordHealth');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const medicine = str(form, 'medicine');
  const dose = str(form, 'dose');
  const startsOn = str(form, 'startsOn');
  const expiresOn = str(form, 'expiresOn');
  const authorisedBy = str(form, 'authorisedBy');

  if (!childId) return { error: 'Missing child.' };
  if (!medicine) return { error: 'Which medicine?' };
  if (!dose) return { error: 'What dose?' };
  if (!ISO_DATE.test(startsOn)) return { error: 'A start date is required.' };
  if (expiresOn && expiresOn < startsOn) return { error: 'The expiry is before the start date.' };
  // Administering medicine without a guardian's authority is a licensing breach,
  // so the authority is not optional here.
  if (!authorisedBy) return { error: 'Record which guardian authorised this.' };

  try {
    await addMedicationAuthority(db, {
      childId,
      medicine,
      dose,
      route: str(form, 'route') || null,
      instructions: str(form, 'instructions') || null,
      authorisedBy,
      startsOn,
      expiresOn: expiresOn || null,
    });
  } catch (e) {
    return actionError(e, 'addMedication');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Record a grant or a withdrawal.
 *
 * `givenBy` is the guardian whose decision it is, which for staff is whichever
 * guardian signed the form and for a parent is themselves. The policy refuses a
 * parent naming anybody else, so the select shown to staff and the hidden field
 * shown to a parent are the same field with the same enforcement behind it.
 */
export async function setConsent(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCtx();
  const db = await serverDb();

  const childId = str(form, 'childId');
  const kind = oneOf<ConsentKind>(str(form, 'kind'), CONSENT_KINDS);
  const granted = str(form, 'granted') === 'true';
  const givenBy = str(form, 'givenBy');

  if (!childId) return { error: 'Missing child.' };
  if (!kind) return { error: 'That is not a consent we record.' };
  if (!givenBy) {
    return {
      error:
        ctx.role === 'parent'
          ? 'You are not recorded as a guardian for this child, so consent cannot be attributed to you.'
          : 'Choose which guardian gave this decision.',
    };
  }

  try {
    await recordConsent(db, { childId, kind, granted, givenBy, note: str(form, 'note') || null });
  } catch (e) {
    return actionError(e, 'setConsent');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Custody
// ---------------------------------------------------------------------------

export async function addCustody(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('viewCustody');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const detail = str(form, 'detail');
  if (!childId) return { error: 'Missing child.' };
  if (!detail) return { error: 'Describe the arrangement.' };

  try {
    await addCustodyArrangement(db, {
      childId,
      detail,
      courtOrderReference: str(form, 'courtOrderReference') || null,
    });
  } catch (e) {
    return actionError(e, 'addCustody');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function supersedeCustody(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('viewCustody');
  const db = await serverDb();
  const id = str(form, 'arrangementId');
  const childId = str(form, 'childId');
  if (!id) return { error: 'Missing arrangement.' };
  try {
    await supersedeCustodyArrangement(db, id);
  } catch (e) {
    return actionError(e, 'supersedeCustody');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Incidents — the one thing on this page a family authors
// ---------------------------------------------------------------------------

/**
 * A guardian's own acknowledgement of a finalised incident.
 *
 * `requireCtx`, not `requireCapability`. There is no capability for this and there
 * should not be: acknowledging is the one act on a child's record that only a
 * *guardian* may perform, and staff — including an owner — are refused by the
 * trigger in 0030 no matter what the app thinks. A capability gate here would
 * suggest the app decides, and it does not.
 *
 * `guardianId` comes from the page, which already resolves which guardian record
 * belongs to the caller for the consent panel. The trigger refuses anything that is
 * not the caller's own, so this is a convenience rather than a check — and an
 * educator whose own child attends the same centre goes through this path too,
 * because 0030 decides by what changed rather than by who called.
 *
 * The time is taken here rather than from the form. This records the moment somebody
 * pressed the button; a field would invite back-dating the only fact in the record
 * the centre is not the author of.
 */
export async function acknowledgeIncidentReport(
  _prev: unknown,
  form: FormData,
): Promise<Result> {
  await requireCtx();
  const db = await serverDb();

  const incidentId = str(form, 'incidentId');
  const childId = str(form, 'childId');
  const guardianId = str(form, 'guardianId');

  if (!incidentId) return { error: 'Missing incident.' };
  if (!guardianId) {
    return {
      error:
        'You are not recorded as a guardian for this child, so an acknowledgement cannot be attributed to you.',
    };
  }

  try {
    await acknowledgeIncident(db, incidentId, guardianId, new Date().toISOString());
  } catch (e) {
    return actionError(e, 'acknowledgeIncidentReport');
  }
  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

/**
 * Record that a medicine was given.
 *
 * The refusals here are worth reading, because two of them come from the database
 * and this function does not re-implement either: 0032's trigger rejects a dose
 * outside the window the guardian authorised, and rejects an unwitnessed dose where
 * the centre requires a witness. Checking those again here would put a second copy
 * of the rule in the app, and the copy would be the one that drifts.
 *
 * What it does do is turn those refusals into sentences. A constraint name on screen
 * to somebody holding a bottle of antibiotics is not an answer.
 */
export async function giveMedicine(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const authorityId = str(form, 'authorityId');
  const childId = str(form, 'childId');
  const doseGiven = str(form, 'doseGiven');
  const clientUuid = str(form, 'clientUuid');
  const witnessedBy = str(form, 'witnessedBy');

  if (!authorityId || !childId) return { error: 'Missing medicine.' };
  if (!doseGiven) return { error: 'Record what was actually given, not what was authorised.' };
  if (!clientUuid) return { error: 'The page did not finish loading. Reload and try again.' };

  try {
    const result = await recordAdministration(db, {
      authorityId,
      childId,
      givenAt: new Date().toISOString(),
      doseGiven,
      clientUuid,
      witnessedBy: witnessedBy || null,
    });
    /*
      A duplicate is not an error and must never be shown as one. The key was already
      recorded, so the dose is on the register — telling somebody the write failed is
      how a child gets a second dose.
    */
    if (result.outcome === 'duplicate') {
      revalidatePath(`/children/${childId}`);
      return { ok: true };
    }
  } catch (e) {
    return actionError(e, 'giveMedicine');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Immunisation
// ---------------------------------------------------------------------------

/**
 * Record what the centre was shown about a child's immunisation.
 *
 * `recordHealth` rather than `manageChildren`, matching health conditions and for
 * the same reason: a Well Child book handed over at the door at 8am has to be
 * recordable by the person who was handed it, not queued for whoever has office
 * access.
 *
 * Nothing here computes a due date. `nextDueOn` is whatever is printed on the
 * document in front of the person typing — this product holds no immunisation
 * schedule, deliberately, and 0036 says why at length.
 */
export async function saveImmunisation(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('recordHealth');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const status = oneOf<ImmunisationStatus>(str(form, 'status'), IMMUNISATION_STATUSES);
  const nextDueOn = str(form, 'nextDueOn');

  if (!childId) return { error: 'Missing child.' };
  if (!status) return { error: 'Record what you were shown.' };
  if (nextDueOn && !ISO_DATE.test(nextDueOn)) return { error: 'That next-due date is not a date.' };

  try {
    await recordImmunisation(db, {
      childId,
      status,
      // Two different claims, kept apart: "the family told us" and "somebody looked
      // at the certificate". Only the second survives a review.
      sighted: bool(form, 'sighted'),
      reference: str(form, 'reference') || null,
      nextDueOn: nextDueOn || null,
      note: str(form, 'note') || null,
      at: new Date().toISOString(),
    });
  } catch (e) {
    return actionError(e, 'saveImmunisation');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}
