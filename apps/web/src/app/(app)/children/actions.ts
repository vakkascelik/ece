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
  clearGuardianPin,
  addCustodyArrangement,
  setGuardianPin,
  addHealthCondition,
  addMedicationAuthority,
  archiveChild,
  confirmDetails,
  reportAbsence,
  reportAbsenceRange,
  createChild,
  addScheduleBlock as addScheduleBlockRow,
  createEnrolment,
  saveChildAddress as saveChildAddressRow,
  deleteChildAddress as deleteChildAddressRow,
  deleteScheduleBlock as deleteScheduleBlockRow,
  endScheduleBlock as endScheduleBlockRow,
  createGuardian,
  linkGuardian,
  recordAdministration,
  recordConsent,
  requestConsent,
  recordImmunisation,
  recordVerification,
  resolveHealthCondition,
  revokeGuardianLink,
  supersedeCustodyArrangement,
  updateChild,
  updateEnrolment,
  updateGuardian,
  updateGuardianLink,
} from '@ece/api';
import {
  ADDRESS_FIELD_MAX,
  ADDRESS_KINDS,
  CONSENT_KINDS,
  ENROLMENT_TYPES,
  GENDERS,
  HEALTH_KINDS,
  HEALTH_SEVERITIES,
  IMMUNISATION_STATUSES,
  REQUIRED_CONSENTS,
  todayInZone,
  type AddressKind,
  type ConsentKind,
  type EnrolmentType,
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
      isAuthorisedSignatory: bool(form, 'isAuthorisedSignatory'),
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
      isAuthorisedSignatory: bool(form, 'isAuthorisedSignatory'),
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

  /*
    Validated against the constant, and an unrecognised value becomes null rather than an
    error: the only way to send one is to edit the form, and silently not-stating is the
    safe reading. The CHECK in 0084 would refuse it anyway, and a raw 23514 reaching a
    centre manager is a worse message than a blank field.
  */
  const typeRaw = str(form, 'enrolmentType');
  const enrolmentType = (ENROLMENT_TYPES as readonly string[]).includes(typeRaw)
    ? (typeRaw as EnrolmentType)
    : null;

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
      enrolmentType,
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

/**
 * Ask this child's guardians for the decisions nobody has answered.
 *
 * The kinds are **not** taken from the form. Everything a caller could put there is decided
 * by `request_consent` (0073) anyway — it drops any kind that already has an answer — so
 * accepting a list here would be a parameter that looks like it does something and does not,
 * which is worse than no parameter. The office asks for what is outstanding; there is no
 * screen for asking selectively and no reason for one.
 *
 * Refused for a parent by the definer function's staff check rather than by this file. The
 * check here is the same one the nav uses, so the button is not drawn for somebody the
 * database would refuse — never the thing that actually stops them.
 */
export async function askForConsent(_prev: unknown, form: FormData): Promise<Result> {
  const ctx = await requireCtx();
  const db = await serverDb();

  const childId = str(form, 'childId');
  if (!childId) return { error: 'Missing child.' };
  if (ctx.role === 'parent') return { error: 'Only the centre can send this request.' };

  try {
    /*
      The return value is deliberately discarded, and zero is deliberately not an error.

      Zero means every kind offered already had an answer. The button is only drawn when
      something is outstanding, so reaching zero means the other guardian answered while this
      page was open — a race, and the right response to it is the re-render below showing the
      answer that arrived. A red box saying "failed" over a finished enrolment is how somebody
      presses the button four more times.
    */
    await requestConsent(db, {
      childId,
      kinds: [...REQUIRED_CONSENTS],
      note: str(form, 'note') || null,
    });
  } catch (e) {
    return actionError(e, 'askForConsent');
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

/**
 * Give a guardian a PIN for the door tablet, or take it away.
 *
 * `manageChildren` here and owner/manager in Postgres (`set_guardian_pin` calls
 * `caller_has_role` itself), which is the usual arrangement: the capability decides
 * whether a button is drawn, the function decides whether it works.
 *
 * The PIN is sent once and never read back. There is no action that returns one,
 * because there is no query that could — 0044 stores a bcrypt hash and grants nobody
 * SELECT on the table it lives in.
 */
export async function setPin(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageChildren');
  const db = await serverDb();

  const guardianId = str(form, 'guardianId');
  const childId = str(form, 'childId');
  const pin = str(form, 'pin');

  if (!guardianId) return { error: 'Which person?' };
  // Checked here so the message is a sentence, and again in Postgres because this is
  // reachable over RPC and a form is not a boundary.
  if (!/^[0-9]{4,8}$/.test(pin)) return { error: 'A PIN is 4 to 8 digits, and digits only.' };

  try {
    await setGuardianPin(db, guardianId, pin);
  } catch (e) {
    return actionError(e, 'children.setPin');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

export async function clearPin(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageChildren');
  const db = await serverDb();

  const guardianId = str(form, 'guardianId');
  const childId = str(form, 'childId');
  if (!guardianId) return { error: 'Which person?' };

  try {
    await clearGuardianPin(db, guardianId);
  } catch (e) {
    return actionError(e, 'children.clearPin');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

/**
 * A guardian tells the centre their child is not coming.
 *
 * `requireCtx`, not `requireCapability`: this is the one action here a **parent** is
 * meant to perform, and every capability in this file is office work. The enforcement is
 * `report_absence` in 0051, which checks guardianship itself and refuses a child that is
 * not the caller's — the gate here only ensures somebody is signed in.
 *
 * Returns a sentence rather than a status code. Every outcome is an ordinary thing that
 * can happen to a parent on a phone, so none of them is an error, and the wording of each
 * is the feature: a family must never come away believing they have changed what they owe.
 */
export async function reportChildAbsence(
  childId: string,
  onDate: string,
  reason?: string,
): Promise<{ message: string }> {
  await requireCtx();
  const db = await serverDb();

  try {
    const outcome = await reportAbsence(db, { childId, onDate, reason: reason?.trim() || null });
    revalidatePath(`/children/${childId}`);

    switch (outcome) {
      case 'recorded':
        return { message: `Thank you — the centre knows your child is away on ${onDate}.` };
      case 'already_absent':
        return { message: `You have already told the centre about ${onDate}.` };
      case 'no_booking':
        return { message: `Your child is not booked in on ${onDate}, so there is nothing to tell us.` };
      case 'past':
        return { message: 'That day has already been. Please talk to the centre about it.' };
      case 'not_bookable':
        return { message: 'That day is not one you can change here. Please talk to the centre.' };
      case 'reason_too_long':
        return { message: 'That note is too long — a sentence or two is plenty.' };
      // Includes any status this version of the app does not recognise, which
      // `reportAbsence` deliberately collapses into a refusal.
      case 'not_permitted':
      default:
        return { message: 'You cannot change that day.' };
    }
  } catch (e) {
    return { message: actionError(e, 'children.reportAbsence').error };
  }
}

/**
 * A run of away days in one submission.
 *
 * The sentence does the honesty work: the range is never all-or-nothing (0063), so the
 * family must hear exactly how many days landed and why the rest did not — "we marked
 * three of your five days" is actionable where a bare success or failure is misleading
 * in opposite directions.
 */
export async function reportChildAbsenceRange(
  childId: string,
  from: string,
  to: string,
  reason?: string,
): Promise<{ message: string }> {
  await requireCtx();
  const db = await serverDb();

  try {
    const result = await reportAbsenceRange(db, {
      childId,
      from,
      to,
      reason: reason?.trim() || null,
    });
    revalidatePath(`/children/${childId}`);

    if (result.status === 'bad_period') {
      return { message: 'Those dates do not make a range this form can take — up to a month, oldest first.' };
    }

    const outcomes = Object.values(result.days);
    const recorded = outcomes.filter((o) => o === 'recorded').length;
    const alreadyKnown = outcomes.filter((o) => o === 'already_absent').length;
    const noBooking = outcomes.filter((o) => o === 'no_booking').length;
    const refused = outcomes.length - recorded - alreadyKnown - noBooking;

    if (recorded === 0 && alreadyKnown === 0) {
      return { message: 'None of those days were booked days we could mark. Please talk to the centre.' };
    }

    const parts: string[] = [];
    if (recorded > 0) parts.push(`the centre now knows about ${recorded} day${recorded === 1 ? '' : 's'}`);
    if (alreadyKnown > 0) parts.push(`${alreadyKnown} ${alreadyKnown === 1 ? 'was' : 'were'} already marked`);
    if (noBooking > 0) parts.push(`${noBooking} had no booking (weekends count here)`);
    if (refused > 0) parts.push(`${refused} could not be changed from here`);
    return { message: `Thank you — ${parts.join(', ')}.` };
  } catch (e) {
    return { message: actionError(e, 'children.reportAbsenceRange').error };
  }
}

/**
 * A guardian records that their child's details are current.
 *
 * `requireCtx`, not `requireCapability` — like `reportChildAbsence`, this is one of the two
 * actions in this file a **parent** is meant to perform. The enforcement is 0055's insert
 * policy, which checks both halves in the database: the child must be the caller's ward,
 * and the guardian record must be the caller's own. The gate here only ensures somebody is
 * signed in.
 *
 * The `guardianId` arriving from the form is not trusted. It is resolved on the server for
 * the button that sends it, and the policy checks `guardians.user_id = auth.uid()` anyway —
 * so a forged one is refused by Postgres rather than by this function.
 */
export async function confirmChildDetails(_prev: unknown, form: FormData): Promise<Result> {
  await requireCtx();
  const db = await serverDb();

  const childId = str(form, 'childId');
  const guardianId = str(form, 'guardianId');
  if (!childId || !guardianId) return { error: 'Which child?' };

  try {
    await confirmDetails(db, { childId, guardianId });
  } catch (e) {
    return actionError(e, 'children.confirmDetails');
  }

  revalidatePath(`/children/${childId}`);
  return { ok: true };
}

/**
 * A signatory approves or disputes a week of attendance from the portal.
 *
 * The gate here is only "somebody is signed in" — the enforcement is 0061's INSERT
 * policy (their own ward, named signatory, attributed to themselves), and a second copy
 * of those conditions in TypeScript would be the drift 0062's header warns about.
 * A policy refusal surfaces as an error, mapped to one sentence: the panel is only drawn
 * for signatories, so anybody hitting it did not get there by tapping what we rendered.
 */
export async function verifyWeekPortal(input: {
  childId: string;
  guardianId: string;
  periodStart: string;
  periodEnd: string;
  outcome: 'approved' | 'disputed';
  comment: string;
}): Promise<{ message: string | null }> {
  await requireCtx();
  const db = await serverDb();

  if (input.outcome === 'disputed' && input.comment.trim().length === 0) {
    return { message: 'Please say what looks wrong, so the office knows what to check.' };
  }

  try {
    await recordVerification(db, input);
    revalidatePath(`/children/${input.childId}`);
    return { message: null };
  } catch {
    // 42501 from the policy, or a CHECK. Deliberately one sentence either way — the
    // distinctions are for the office, not for a screen that already filtered its offer.
    return { message: 'You cannot verify this week. Please talk to the centre.' };
  }
}

// ---------------------------------------------------------------------------
// The enrolment agreement — the weekday pattern (0085)
// ---------------------------------------------------------------------------

/*
  Three actions, mirroring `/census`'s block editor, because the tables are the same shape and the
  editing gestures are the same three: add a block, close an open one, delete a mistake.

  `manageEnrolment`, not `manageCentre`. The agreement is the thing funded hours are derived from,
  and this repo already gates enrolment writes on that capability — `EnrolmentPanel` uses it two
  sections up the same page. The database is narrower still and independent of this:
  `caller_may_enrol` in `0085` is owner-or-manager at the child's own centre, so an educator reads
  the agreement and cannot rewrite it. The capability decides whether a form is drawn; Postgres
  decides whether a row changes.

  Validation mirrors `census/actions.ts:127-190`: the same ISO_DATE and TIME shapes, weekday as an
  integer 1-7, and `toTime > fromTime` checked here as well as by the CHECK constraint — because a
  `23514` reaching a centre manager is a worse message than a sentence.
*/

const TIME = /^\d{2}:\d{2}(:\d{2})?$/;

export async function addScheduleBlock(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageEnrolment');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const weekday = Number(str(form, 'weekday'));
  const fromTime = str(form, 'fromTime');
  const toTime = str(form, 'toTime');
  const effectiveFrom = str(form, 'effectiveFrom');

  if (!childId) return { error: 'Missing child.' };
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    return { error: 'Choose a day of the week.' };
  }
  if (!TIME.test(fromTime) || !TIME.test(toTime)) {
    return { error: 'Give a start and end time, as HH:MM.' };
  }
  if (toTime <= fromTime) return { error: 'The end time has to be after the start time.' };
  if (!ISO_DATE.test(effectiveFrom)) return { error: 'Give the date this pattern starts from.' };

  const { data: auth } = await db.auth.getUser();
  try {
    await addScheduleBlockRow(
      db,
      { childId, weekday, fromTime, toTime, effectiveFrom },
      auth.user?.id ?? null,
    );
  } catch (e) {
    // `addScheduleBlockRow` already turns the 23P01 overlap into a sentence about ending the
    // existing block first, so this passes it through rather than replacing it.
    return actionError(e, 'children.addScheduleBlock');
  }
  revalidatePath(`/children/${childId}/documents`);
  return { ok: true };
}

export async function endScheduleBlock(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageEnrolment');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const id = str(form, 'blockId');
  const effectiveTo = str(form, 'effectiveTo');
  if (!id) return { error: 'Missing block.' };
  if (!ISO_DATE.test(effectiveTo)) return { error: 'Give the last day this pattern applies.' };

  try {
    await endScheduleBlockRow(db, id, effectiveTo);
  } catch (e) {
    return actionError(e, 'children.endScheduleBlock');
  }
  revalidatePath(`/children/${childId}/documents`);
  return { ok: true };
}

export async function removeScheduleBlock(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageEnrolment');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const id = str(form, 'blockId');
  if (!id) return { error: 'Missing block.' };

  try {
    await deleteScheduleBlockRow(db, id);
  } catch (e) {
    return actionError(e, 'children.removeScheduleBlock');
  }
  revalidatePath(`/children/${childId}/documents`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Where the child lives (0086)
// ---------------------------------------------------------------------------

/*
  Two actions rather than three, unlike the schedule above. An address is replaced in place — one
  primary and one secondary per child, `unique (child_id, kind)` — so recording and correcting are
  the same gesture and `saveChildAddressRow` upserts. There is no "end this address" because no
  funding figure is computed against an address, which is the whole reason `0086` chose replacement
  over the effective-dated chain `0085` needed.

  `manageEnrolment` again, not `manageCentre`: §6-1 puts the address *inside* the enrolment record,
  and `caller_may_enrol` in the migration is narrower still. An educator sees the address rendered
  and no form.

  THE LENGTH CHECK IS A DELIBERATE SECOND COPY of the database's `String100` CHECK, for the reason
  `addScheduleBlock` gives about `toTime > fromTime`: a `23514` naming
  `child_addresses_within_string100` reaching a centre manager is a worse message than a sentence.
  What is *not* duplicated is the decision — the database still refuses the row if this is ever
  wrong, and `ADDRESS_FIELD_MAX` is the one constant both this and the form read.
*/

export async function saveChildAddress(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageEnrolment');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const kind = oneOf<AddressKind>(str(form, 'kind'), ADDRESS_KINDS);
  const address1Line = str(form, 'address1Line');
  const address2Line = str(form, 'address2Line');
  const addressCity = str(form, 'addressCity');
  const addressCountry = str(form, 'addressCountry');
  const addressPostCode = str(form, 'addressPostCode');

  if (!childId) return { error: 'Missing child.' };
  if (!kind) return { error: 'Choose which address this is.' };

  // The two the ELI schema requires. `str` has already trimmed, so a box holding only spaces
  // fails here rather than reaching the trim CHECK — which is the same refusal, said better.
  if (!address1Line) return { error: 'Give the street address.' };
  if (!addressCity) return { error: 'Give the town or city.' };

  const overLong = (
    [
      ['The street address', address1Line],
      ['The second address line', address2Line],
      ['The town or city', addressCity],
      ['The country', addressCountry],
      ['The postcode', addressPostCode],
    ] as const
  ).find(([, value]) => value.length > ADDRESS_FIELD_MAX);
  if (overLong) {
    return { error: `${overLong[0]} has to be ${ADDRESS_FIELD_MAX} characters or fewer.` };
  }

  const { data: auth } = await db.auth.getUser();
  try {
    await saveChildAddressRow(
      db,
      {
        childId,
        kind,
        address1Line,
        address2Line,
        addressCity,
        addressCountry,
        addressPostCode,
      },
      auth.user?.id ?? null,
    );
  } catch (e) {
    return actionError(e, 'children.saveChildAddress');
  }
  revalidatePath(`/children/${childId}/whanau`);
  return { ok: true };
}

export async function removeChildAddress(_prev: unknown, form: FormData): Promise<Result> {
  await requireCapability('manageEnrolment');
  const db = await serverDb();

  const childId = str(form, 'childId');
  const kind = oneOf<AddressKind>(str(form, 'kind'), ADDRESS_KINDS);
  if (!childId) return { error: 'Missing child.' };
  if (!kind) return { error: 'Missing address.' };

  try {
    await deleteChildAddressRow(db, childId, kind);
  } catch (e) {
    return actionError(e, 'children.removeChildAddress');
  }
  revalidatePath(`/children/${childId}/whanau`);
  return { ok: true };
}
