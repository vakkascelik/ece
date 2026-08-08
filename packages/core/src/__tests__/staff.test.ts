import { describe, expect, it } from 'vitest';
import {
  countCertificated,
  currentStaff,
  lastStaffEvent,
  staffPresentNow,
  type StaffAttendanceEvent,
  type StaffMember,
} from '../staff';
import type { StaffRecord } from '../compliance';

const member = (over: Partial<StaffMember> & Pick<StaffMember, 'id'>): StaffMember => ({
  centreId: 'c1',
  fullName: 'Ed Educator',
  userId: null,
  roleNote: null,
  startedOn: null,
  finishedOn: null,
  archivedAt: null,
  ...over,
});

const ev = (
  id: number,
  staffMemberId: string,
  kind: 'in' | 'out',
  at: string,
  corrects: number | null = null,
): StaffAttendanceEvent => ({ id, staffMemberId, kind, at, recordedBy: null, corrects, note: null });

describe('staffPresentNow', () => {
  it('names who is in, not just how many', () => {
    // "Three adults" is what the ratio wants; "Ed and Sam" is what a person at the
    // door can check against the room.
    const present = staffPresentNow([
      ev(1, 'ed', 'in', '2026-08-10T07:00:00.000Z'),
      ev(2, 'sam', 'in', '2026-08-10T08:00:00.000Z'),
      ev(3, 'ed', 'out', '2026-08-10T15:00:00.000Z'),
    ]);
    expect([...present]).toEqual(['sam']);
  });

  it('drops a superseded event even when its correction is timestamped earlier', () => {
    // The case that bites in SQL and TypeScript alike: signed out by mistake, then
    // corrected with an earlier timestamp. Sorting by time first replays the sign-out.
    const present = staffPresentNow([
      ev(1, 'ed', 'in', '2026-08-10T07:00:00.000Z'),
      ev(2, 'ed', 'out', '2026-08-10T12:00:00.000Z'),
      ev(3, 'ed', 'in', '2026-08-10T11:50:00.000Z', 2),
    ]);
    expect(present.has('ed')).toBe(true);
  });

  it('is transitive, so a correction of a correction removes the middle one', () => {
    const present = staffPresentNow([
      ev(1, 'ed', 'in', '2026-08-10T07:00:00.000Z'),
      ev(2, 'ed', 'out', '2026-08-10T08:00:00.000Z'),
      ev(3, 'ed', 'out', '2026-08-10T09:00:00.000Z', 2),
      ev(4, 'ed', 'in', '2026-08-10T09:30:00.000Z', 3),
    ]);
    expect(present.has('ed')).toBe(true);
  });
});

describe('lastStaffEvent', () => {
  it('ignores corrected events and other people', () => {
    const last = lastStaffEvent(
      [
        ev(1, 'ed', 'in', '2026-08-10T07:00:00.000Z'),
        ev(2, 'sam', 'in', '2026-08-10T09:00:00.000Z'),
        ev(3, 'ed', 'out', '2026-08-10T15:00:00.000Z'),
        ev(4, 'ed', 'in', '2026-08-10T14:50:00.000Z', 3),
      ],
      'ed',
    );
    expect(last?.id).toBe(4);
    expect(last?.kind).toBe('in');
  });

  it('is null for somebody with no events', () => {
    expect(lastStaffEvent([], 'ed')).toBeNull();
  });
});

describe('currentStaff', () => {
  it('excludes people who have not started, have left, or are archived', () => {
    const roster = currentStaff(
      [
        member({ id: 'here' }),
        member({ id: 'future', startedOn: '2026-09-01' }),
        member({ id: 'gone', finishedOn: '2026-07-31' }),
        member({ id: 'archived', archivedAt: '2026-08-01T00:00:00.000Z' }),
        member({ id: 'lastday', finishedOn: '2026-08-10' }),
      ],
      '2026-08-10',
    );
    // Their last day counts: they are on the roster until it passes.
    expect(roster.map((m) => m.id).sort()).toEqual(['here', 'lastday']);
  });
});

const record = (over: Partial<StaffRecord> & Pick<StaffRecord, 'id'>): StaffRecord => ({
  centreId: 'c1',
  userId: null,
  personName: 'Ed Educator',
  roleNote: null,
  kind: 'practising_certificate',
  reference: null,
  issuedOn: null,
  expiresOn: '2027-01-01',
  sightedBy: null,
  sightedAt: null,
  note: null,
  staffMemberId: null,
  archivedAt: null,
  ...over,
});

describe('countCertificated', () => {
  const TODAY = '2026-08-10';

  it('reports unlinked records, because without them the count is a lie by omission', () => {
    /*
      The property that matters most here. 0038 leaves every link null on purpose, so
      a centre that has not done the linking reports ZERO certificated staff while
      holding a folder of certificates. The count is only readable beside this number.
    */
    const result = countCertificated(
      [member({ id: 'ed' })],
      [record({ id: 'r1' }), record({ id: 'r2' })],
      TODAY,
    );
    expect(result.certificated).toBe(0);
    expect(result.unlinkedRecords).toBe(2);
    expect(result.total).toBe(1);
  });

  it('counts a linked, unexpired certificate', () => {
    const result = countCertificated(
      [member({ id: 'ed' })],
      [record({ id: 'r1', staffMemberId: 'ed' })],
      TODAY,
    );
    expect(result.certificated).toBe(1);
    expect(result.unlinkedRecords).toBe(0);
  });

  it('treats a missing expiry as NOT current', () => {
    // Every practising certificate has one, so a blank is an unfinished record rather
    // than a document that never lapses.
    const result = countCertificated(
      [member({ id: 'ed' })],
      [record({ id: 'r1', staffMemberId: 'ed', expiresOn: null })],
      TODAY,
    );
    expect(result.certificated).toBe(0);
  });

  it('ignores an expired certificate and one belonging to somebody off the roster', () => {
    const result = countCertificated(
      [member({ id: 'ed' })],
      [
        record({ id: 'old', staffMemberId: 'ed', expiresOn: '2026-01-01' }),
        record({ id: 'gone', staffMemberId: 'departed', expiresOn: '2027-01-01' }),
      ],
      TODAY,
    );
    expect(result.certificated).toBe(0);
  });

  it('counts a person once with two live certificates, keeping the later expiry', () => {
    const result = countCertificated(
      [member({ id: 'ed' })],
      [
        record({ id: 'a', staffMemberId: 'ed', expiresOn: '2026-09-01' }),
        record({ id: 'b', staffMemberId: 'ed', expiresOn: '2027-06-01' }),
      ],
      TODAY,
    );
    expect(result.certificated).toBe(1);
    // The later expiry wins, so a renewal already on file does not show as lapsing.
    expect(result.lapsingSoon).toEqual([]);
  });

  it('names who lapses inside the window, soonest first', () => {
    const result = countCertificated(
      [member({ id: 'ed' }), member({ id: 'sam' })],
      [
        record({ id: 'a', staffMemberId: 'ed', expiresOn: '2026-10-01' }),
        record({ id: 'b', staffMemberId: 'sam', expiresOn: '2026-09-01' }),
      ],
      TODAY,
      90,
    );
    expect(result.lapsingSoon.map((l) => l.staffMemberId)).toEqual(['sam', 'ed']);
  });

  it('returns no percentage and no band, only a count and a denominator', () => {
    /*
      The shape is the assertion. Funding rates step at certificated-teacher
      thresholds and this repo has not read the handbook, so the product states facts
      and draws no conclusion. A `percentage` or `band` field appearing here would be
      a regression, and this is what would catch it.
    */
    const result = countCertificated([member({ id: 'ed' })], [], TODAY);
    expect(Object.keys(result).sort()).toEqual([
      'certificated',
      'lapsingSoon',
      'total',
      'unlinkedRecords',
    ]);
  });
});
