import Link from 'next/link';
import { listStaffAttendance, listStaffMembers, listStaffRecords } from '@ece/api';
import {
  can,
  countCertificated,
  currentStaff,
  lastStaffEvent,
  staffPresentNow,
  todayInZone,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { StaffRoster, type RosterRow } from './StaffRoster';

/**
 * The people who work here, and which of them are in the building.
 *
 * Reading is open to any staff member — everybody rostered needs to know who else is
 * on, and 0038's policy already allows it. Adding and ending employment are
 * owner/manager, because both change the denominator of the ratio.
 */
export default async function StaffPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const today = todayInZone(ctx.centre.timezone);
  const { fromUtc, toUtc } = dayWindow(today, ctx.centre.timezone);

  const [members, events, records] = await Promise.all([
    listStaffMembers(db, ctx.centre.id),
    listStaffAttendance(db, ctx.centre.id, fromUtc, toUtc),
    listStaffRecords(db, ctx.centre.id),
  ]);

  const present = staffPresentNow(events);
  const roster = currentStaff(members, today);
  const certificated = countCertificated(members, records, today);
  const lapsingById = new Map(certificated.lapsingSoon.map((l) => [l.staffMemberId, l.expiresOn]));

  const certificatedIds = new Set(
    records
      .filter(
        (r) =>
          r.kind === 'practising_certificate' &&
          r.archivedAt === null &&
          r.staffMemberId !== null &&
          r.expiresOn !== null &&
          r.expiresOn >= today,
      )
      .map((r) => r.staffMemberId as string),
  );

  const clock = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    hour: 'numeric',
    minute: '2-digit',
  });

  // Everybody, not just today's roster: somebody who left last month still has a row,
  // and hiding it would make the record look like it never existed.
  const rows: RosterRow[] = members.map((member) => {
    const last = lastStaffEvent(events, member.id);
    return {
      member,
      present: present.has(member.id),
      lastLabel: last ? clock.format(new Date(last.at)) : null,
      certificated: certificatedIds.has(member.id),
      lapsingOn: lapsingById.get(member.id) ?? null,
    };
  });

  const presentCount = roster.filter((m) => present.has(m.id)).length;

  return (
    <>
      <h1>Staff</h1>
      <p className="sub">Who works at {ctx.centre.name}, and who is here.</p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="inline" style={{ margin: 0 }}>
          <span className={`flag ${presentCount > 0 ? 'flag-ok' : 'flag-quiet'}`}>
            {presentCount} of {roster.length} signed in
          </span>

          {/*
            The count states a fact and stops. No percentage and no funding band:
            rates step at certificated-teacher thresholds and this repo has not read
            the funding handbook, so drawing the conclusion would be asserting a rate
            nobody checked. See unverified-claims.
          */}
          <span className="flag flag-quiet">
            {certificated.certificated} of {certificated.total} hold a current practising
            certificate
          </span>
        </p>

        {certificated.unlinkedRecords > 0 && (
          // Without this the count above is a lie by omission: 0038 leaves every link
          // null on purpose, so an unlinked centre reads as zero certificated staff
          // while holding a folder of certificates.
          <p className="sub" style={{ margin: '0.5rem 0 0' }}>
            <span className="flag flag-warn">
              {'●'} {certificated.unlinkedRecords} practising certificate
              {certificated.unlinkedRecords === 1 ? '' : 's'} not linked to anybody
            </span>{' '}
            The count above only sees certificates linked to a person on this list. Link them on{' '}
            <Link href="/compliance">Compliance</Link> — nothing guesses which person a
            certificate belongs to, because two relievers can share a first name.
          </p>
        )}

        {ctx.centre.ratioSource === 'derived' ? (
          <p className="sub" style={{ margin: '0.5rem 0 0' }}>
            Your ratio is computed from this list. If nobody signs in, it reads zero adults and
            shows a breach.
          </p>
        ) : (
          <p className="sub" style={{ margin: '0.5rem 0 0' }}>
            Your ratio still uses the adult count typed on the attendance screen. Signing in here
            records who was present but does not feed the ratio until you change that in{' '}
            <Link href="/settings">Settings</Link>.
          </p>
        )}
      </div>

      <StaffRoster rows={rows} canManage={can(ctx.role, 'manageMembers')} today={today} />
    </>
  );
}
