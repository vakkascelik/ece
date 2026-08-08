/**
 * Staff as people: the roster, who is signed in, and what the certificate count can
 * honestly be said to mean.
 *
 * Nothing here reads a clock. As with the other registers, `now` is a parameter.
 */

import { shiftLocalDate } from './children';
import type { StaffRecord } from './compliance';

export interface StaffMember {
  id: string;
  centreId: string;
  fullName: string;
  /** Null for a reliever or contractor with no login. The common case, not an edge one. */
  userId: string | null;
  roleNote: string | null;
  startedOn: string | null;
  finishedOn: string | null;
  archivedAt: string | null;
}

export interface StaffAttendanceEvent {
  id: number;
  staffMemberId: string;
  kind: 'in' | 'out';
  at: string;
  recordedBy: string | null;
  corrects: number | null;
  note: string | null;
}

/**
 * Who is signed in, from the events.
 *
 * Superseded events are dropped first and transitively, for the reason
 * `deriveAdultCounts` and `adults_present_now` both give: a correction can carry an
 * earlier timestamp than the row it fixes, so ordering by time before resolving
 * corrections replays the wrong state.
 *
 * Returns a Set rather than a count, because the screen needs to say *who* — "three
 * adults" is the number the ratio wants and "Ed, Sam and Priya" is what a person at
 * the door can check against the room.
 */
export function staffPresentNow(events: StaffAttendanceEvent[]): Set<string> {
  const corrected = new Set<number>();
  for (const e of events) if (e.corrects !== null) corrected.add(e.corrects);

  const live = events
    .filter((e) => !corrected.has(e.id))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));

  const present = new Set<string>();
  for (const e of live) {
    if (e.kind === 'in') present.add(e.staffMemberId);
    else present.delete(e.staffMemberId);
  }
  return present;
}

/** The last event for one person, so a row can say when they signed in. */
export function lastStaffEvent(
  events: StaffAttendanceEvent[],
  staffMemberId: string,
): StaffAttendanceEvent | null {
  const corrected = new Set<number>();
  for (const e of events) if (e.corrects !== null) corrected.add(e.corrects);

  const mine = events
    .filter((e) => e.staffMemberId === staffMemberId && !corrected.has(e.id))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id - b.id));
  return mine[mine.length - 1] ?? null;
}

/** On the roster today: started, not finished, not archived. */
export function currentStaff(members: StaffMember[], today: string): StaffMember[] {
  return members.filter(
    (m) =>
      m.archivedAt === null &&
      (m.startedOn === null || m.startedOn <= today) &&
      (m.finishedOn === null || m.finishedOn >= today),
  );
}

// ---------------------------------------------------------------------------
// Certificated teachers
// ---------------------------------------------------------------------------

export interface CertificatedCount {
  /** People on the roster today. */
  total: number;
  /** Of those, how many hold an unexpired practising certificate linked to them. */
  certificated: number;
  /**
   * People whose certificate expires within the window — the ones that turn a
   * count into a problem on a known date.
   */
  lapsingSoon: { staffMemberId: string; expiresOn: string }[];
  /**
   * Records that name a person but are not linked to a `staff_members` row.
   *
   * **This is why the count above cannot be trusted on its own.** 0038 leaves every
   * link null deliberately, so an unlinked centre reports zero certificated staff
   * while holding a folder full of certificates. The screen must show this number
   * beside the count, or the count is a lie by omission.
   */
  unlinkedRecords: number;
}

/**
 * How many people on today's roster hold a current practising certificate.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN
 *
 * A percentage, a funding band, or any statement about what the number entitles a
 * centre to. New Zealand funding rates step at certificated-teacher thresholds; this
 * repo has not read the funding handbook, and a screen saying "you are in the 80%+
 * band" would be asserting a rate nobody here checked. See unverified-claims.
 *
 * The honest output is a count, a denominator, and the dates things lapse — facts a
 * manager can act on without the product drawing a conclusion for them.
 */
export function countCertificated(
  members: StaffMember[],
  records: StaffRecord[],
  today: string,
  warnWithinDays = 90,
): CertificatedCount {
  const roster = currentStaff(members, today);
  const rosterIds = new Set(roster.map((m) => m.id));

  const live = records.filter(
    (r) => r.kind === 'practising_certificate' && r.archivedAt === null,
  );

  const unlinkedRecords = live.filter((r) => r.staffMemberId === null).length;

  const currentByMember = new Map<string, string>();
  for (const r of live) {
    if (r.staffMemberId === null || !rosterIds.has(r.staffMemberId)) continue;
    // No expiry on a practising certificate is treated as NOT current. Every
    // practising certificate has one, so a blank is an unfinished record rather than
    // a document that never lapses — the same reading `compliance.ts` takes.
    if (r.expiresOn === null || r.expiresOn < today) continue;
    const seen = currentByMember.get(r.staffMemberId);
    if (!seen || r.expiresOn > seen) currentByMember.set(r.staffMemberId, r.expiresOn);
  }

  const horizon = shiftLocalDate(today, warnWithinDays);
  const lapsingSoon = [...currentByMember.entries()]
    .filter(([, expiresOn]) => expiresOn <= horizon)
    .map(([staffMemberId, expiresOn]) => ({ staffMemberId, expiresOn }))
    .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));

  return {
    total: roster.length,
    certificated: currentByMember.size,
    lapsingSoon,
    unlinkedRecords,
  };
}
