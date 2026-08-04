/**
 * Compliance record-keeping: what expires, when to warn, and how exposed the centre is.
 *
 * No regulation text and no validity periods. Every duration here is a *warning lead
 * time* — how far ahead to raise something — not a claim about how long a certificate
 * lasts. The document says how long it lasts; this says when to start chasing it.
 */

import { todayInZone } from './children';

export const STAFF_RECORD_KINDS = [
  'first_aid',
  'police_vetting',
  'safety_check',
  'practising_certificate',
  'child_protection_training',
  'other',
] as const;
export type StaffRecordKind = (typeof STAFF_RECORD_KINDS)[number];

export const STAFF_RECORD_LABELS: Record<StaffRecordKind, string> = {
  first_aid: 'First aid certificate',
  police_vetting: 'Police vetting',
  safety_check: 'Safety check',
  practising_certificate: 'Practising certificate',
  child_protection_training: 'Child protection training',
  other: 'Other',
};

export interface StaffRecord {
  id: string;
  centreId: string;
  userId: string | null;
  personName: string;
  roleNote: string | null;
  kind: StaffRecordKind;
  reference: string | null;
  issuedOn: string | null;
  /** Null means it does not expire. */
  expiresOn: string | null;
  sightedBy: string | null;
  sightedAt: string | null;
  note: string | null;
  archivedAt: string | null;
}

/**
 * How far ahead to start warning, per kind.
 *
 * These differ because *renewal* takes different amounts of time, not because the
 * certificates last different amounts of time. Police vetting is the outlier: the
 * request goes to NZ Police and takes weeks, so a 30-day warning is a warning that
 * arrives too late to act on. A first aid course can be booked in a fortnight.
 *
 * Adjustable, and worth adjusting from experience rather than from this comment.
 */
export const WARNING_DAYS: Record<StaffRecordKind, number> = {
  police_vetting: 120,
  safety_check: 120,
  practising_certificate: 90,
  first_aid: 45,
  child_protection_training: 45,
  other: 30,
};

export type ExpiryStatus = 'expired' | 'due-soon' | 'current' | 'no-expiry' | 'unknown';

export interface ExpiryAssessment {
  status: ExpiryStatus;
  /** Negative once expired. Null when there is no expiry date. */
  daysRemaining: number | null;
  /** True when nobody has recorded sighting the original document. */
  unsighted: boolean;
}

/** Whole days between two ISO dates. Calendar arithmetic, not millisecond division. */
function daysBetween(fromISO: string, toISO: string): number {
  const [fy, fm, fd] = fromISO.split('-').map(Number);
  const [ty, tm, td] = toISO.split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) throw new Error(`Not an ISO date: ${fromISO}/${toISO}`);
  // UTC midnights, so a DST transition between the two dates cannot round the answer.
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86_400_000);
}

export function assessExpiry(record: StaffRecord, on: string = todayInZone()): ExpiryAssessment {
  const unsighted = record.sightedAt === null;

  if (!record.expiresOn) {
    // Training with no expiry is legitimate. A certificate with a blank expiry is a
    // record somebody has not finished filling in — but the two are indistinguishable
    // from here, so the caller decides; `other` and training default to no-expiry and
    // the rest are flagged by the UI.
    return { status: 'no-expiry', daysRemaining: null, unsighted };
  }

  const remaining = daysBetween(on, record.expiresOn);
  if (remaining < 0) return { status: 'expired', daysRemaining: remaining, unsighted };
  if (remaining <= WARNING_DAYS[record.kind]) {
    return { status: 'due-soon', daysRemaining: remaining, unsighted };
  }
  return { status: 'current', daysRemaining: remaining, unsighted };
}

/**
 * Ordering by exposure, not by date.
 *
 * The plan asked for a gap dashboard "sorted by exposure", and the distinction is
 * real: an expired police vetting is a worse position than a first aid certificate
 * expiring next week, even though the date is further away. So the sort is by what it
 * would cost the centre, then by urgency within that.
 *
 * Unsighted records rank alongside expired ones. "We have a certificate number but
 * nobody has seen the document" is not a certificate.
 */
const EXPOSURE: Record<ExpiryStatus, number> = {
  expired: 0,
  'due-soon': 1,
  unknown: 2,
  'no-expiry': 3,
  current: 4,
};

/** Police vetting and safety checks first, because those are the ones that stop a person working. */
const KIND_WEIGHT: Record<StaffRecordKind, number> = {
  police_vetting: 0,
  safety_check: 0,
  practising_certificate: 1,
  first_aid: 2,
  child_protection_training: 3,
  other: 4,
};

export interface AssessedRecord {
  record: StaffRecord;
  expiry: ExpiryAssessment;
}

export function byExposure(a: AssessedRecord, b: AssessedRecord): number {
  const statusA = a.expiry.unsighted && a.expiry.status !== 'expired' ? 'unknown' : a.expiry.status;
  const statusB = b.expiry.unsighted && b.expiry.status !== 'expired' ? 'unknown' : b.expiry.status;

  return (
    EXPOSURE[statusA] - EXPOSURE[statusB] ||
    KIND_WEIGHT[a.record.kind] - KIND_WEIGHT[b.record.kind] ||
    (a.expiry.daysRemaining ?? 99_999) - (b.expiry.daysRemaining ?? 99_999) ||
    a.record.personName.localeCompare(b.record.personName)
  );
}

export interface ComplianceSummary {
  expired: number;
  dueSoon: number;
  unsighted: number;
  total: number;
  /** Nothing expired, nothing unsighted. Not the same as "nothing due soon". */
  clean: boolean;
}

export function summarise(assessed: AssessedRecord[]): ComplianceSummary {
  const expired = assessed.filter((a) => a.expiry.status === 'expired').length;
  const dueSoon = assessed.filter((a) => a.expiry.status === 'due-soon').length;
  const unsighted = assessed.filter((a) => a.expiry.unsighted).length;
  return {
    expired,
    dueSoon,
    unsighted,
    total: assessed.length,
    // "Due soon" is a to-do list, not a gap. Calling it unclean would mean the
    // dashboard is never green and nobody reads it.
    clean: expired === 0 && unsighted === 0,
  };
}

export function assessAll(records: StaffRecord[], on?: string): AssessedRecord[] {
  return records
    .filter((r) => !r.archivedAt)
    .map((record) => ({ record, expiry: assessExpiry(record, on) }))
    .sort(byExposure);
}
