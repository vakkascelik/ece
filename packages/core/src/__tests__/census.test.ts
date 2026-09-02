import { describe, expect, it } from 'vitest';
import {
  censusRow,
  contactHoursOn,
  contractedMinutes,
  eliWeekday,
  summariseCensus,
  timeToMinutes,
  type ContactHoursBlock,
  type StaffCensusDetails,
  type LoadedCodeSet,
} from '../census';
import type { StaffMember } from '../staff';
import type { StaffRecord } from '../compliance';

const AS_AT = '2026-09-02';

const member = (over: Partial<StaffMember> & Pick<StaffMember, 'id'>): StaffMember => ({
  centreId: 'c1',
  fullName: 'Ed Educator',
  userId: null,
  roleNote: null,
  startedOn: '2026-01-01',
  finishedOn: null,
  archivedAt: null,
  ...over,
});

/** A complete educational-role record, so a test can remove exactly one thing. */
const details = (over: Partial<StaffCensusDetails> = {}): StaffCensusDetails => ({
  genderCode: 'F',
  ageBand: '31_35',
  ethnicGroupCodes: ['E1'],
  iwiCodes: [],
  roleKind: 'educational',
  roleCode: 'R1',
  highestQualificationCode: 'Q1',
  playcentreQualificationCode: null,
  isPaid: true,
  isPermanent: true,
  isFullTime: true,
  minAgeTaughtMonths: 0,
  maxAgeTaughtMonths: 60,
  previouslyWorkedAsTeacher: false,
  arrivedFromAnotherService: false,
  leavingDestinationCode: null,
  ...over,
});

const block = (over: Partial<ContactHoursBlock> = {}): ContactHoursBlock => ({
  weekday: 1,
  fromTime: '08:00:00',
  toTime: '16:00:00',
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  ...over,
});

const cert = (over: Partial<StaffRecord> & Pick<StaffRecord, 'id'>): StaffRecord => ({
  centreId: 'c1',
  userId: null,
  personName: 'Ed Educator',
  kind: 'practising_certificate',
  roleNote: null,
  reference: null,
  issuedOn: null,
  expiresOn: '2027-01-01',
  sightedBy: null,
  sightedAt: null,
  note: null,
  staffMemberId: 's1',
  archivedAt: null,
  ...over,
});

const currentCert = [cert({ id: 'r1' })];

describe('timeToMinutes', () => {
  it('accepts both the shapes Postgres time can arrive as', () => {
    expect(timeToMinutes('08:00')).toBe(480);
    expect(timeToMinutes('08:00:00')).toBe(480);
    expect(timeToMinutes('16:30:45')).toBe(990);
  });

  it('returns null rather than zero for anything malformed', () => {
    // Zero would be midnight, which silently lengthens a contract.
    for (const bad of ['', '8:00', '25:00', '08:60', 'noon', '08-00', '080000']) {
      expect(timeToMinutes(bad)).toBeNull();
    }
  });
});

describe('eliWeekday', () => {
  it('maps ISO 1-7 onto the schema codes, Sunday included', () => {
    expect(eliWeekday(1)).toBe('Mo');
    expect(eliWeekday(5)).toBe('Fr');
    expect(eliWeekday(7)).toBe('Su');
  });

  it('refuses anything outside 1-7 rather than wrapping', () => {
    expect(eliWeekday(0)).toBeNull();
    expect(eliWeekday(8)).toBeNull();
    expect(eliWeekday(1.5)).toBeNull();
  });
});

describe('contactHoursOn', () => {
  it('keeps only the blocks whose effective window covers the date', () => {
    const blocks = [
      block({ weekday: 1, effectiveTo: '2026-06-30' }), // ended
      block({ weekday: 2, effectiveFrom: '2027-01-01' }), // not started
      block({ weekday: 3 }), // open-ended
    ];
    expect(contactHoursOn(blocks, AS_AT).map((b) => b.weekday)).toEqual([3]);
  });

  it('includes a block whose window closes exactly on the date', () => {
    // The window is inclusive of its end date: a contract ending on the return date
    // was in force on the return date.
    expect(contactHoursOn([block({ effectiveTo: AS_AT })], AS_AT)).toHaveLength(1);
    expect(contactHoursOn([block({ effectiveFrom: AS_AT })], AS_AT)).toHaveLength(1);
  });

  it('sorts by weekday then start, so the wire order is stable', () => {
    const blocks = [
      block({ weekday: 3, fromTime: '13:00:00' }),
      block({ weekday: 1, fromTime: '13:00:00' }),
      block({ weekday: 1, fromTime: '08:00:00' }),
    ];
    expect(contactHoursOn(blocks, AS_AT).map((b) => `${b.weekday}@${b.fromTime}`)).toEqual([
      '1@08:00:00',
      '1@13:00:00',
      '3@13:00:00',
    ]);
  });
});

describe('contractedMinutes', () => {
  it('sums a week, split shifts included', () => {
    const blocks = [
      block({ weekday: 1, fromTime: '08:00:00', toTime: '12:00:00' }),
      block({ weekday: 1, fromTime: '13:00:00', toTime: '16:00:00' }),
    ];
    expect(contractedMinutes(blocks)).toBe(240 + 180);
  });

  it('returns null for no blocks, because none is not zero', () => {
    expect(contractedMinutes([])).toBeNull();
  });

  it('skips an unusable block rather than counting it as zero', () => {
    const blocks = [
      block({ fromTime: '16:00:00', toTime: '08:00:00' }), // inverted
      block({ weekday: 2, fromTime: 'noon', toTime: '16:00:00' }), // unparseable
      block({ weekday: 3, fromTime: '09:00:00', toTime: '10:00:00' }),
    ];
    expect(contractedMinutes(blocks)).toBe(60);
  });
});

describe('censusRow — the gaps are the product', () => {
  it('reports a person with no census record as one gap, not eleven', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: null, contactHours: [block()] },
      currentCert,
      AS_AT,
    );
    expect(row.missing).toEqual(['censusRecord']);
    expect(row.reportable).toBe(false);
  });

  it('is reportable when every required field is present', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      currentCert,
      AS_AT,
    );
    expect(row.missing).toEqual([]);
    expect(row.codeIssues).toEqual([]);
    expect(row.reportable).toBe(true);
  });

  it.each([
    ['genderCode', { genderCode: null }],
    ['roleCode', { roleCode: null }],
    ['highestQualificationCode', { highestQualificationCode: null }],
    ['isPaid', { isPaid: null }],
    ['isPermanent', { isPermanent: null }],
    ['isFullTime', { isFullTime: null }],
    ['ethnicGroupCodes', { ethnicGroupCodes: [] }],
  ])('names %s when it is absent on an educational role', (field, over) => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(over), contactHours: [block()] },
      currentCert,
      AS_AT,
    );
    expect(row.missing).toContain(field);
    expect(row.reportable).toBe(false);
  });

  it('names contactHours when no contract is in force, and hours stay null', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [] },
      currentCert,
      AS_AT,
    );
    expect(row.missing).toContain('contactHours');
    expect(row.hoursWorked).toBeNull();
    expect(row.contractedMinutes).toBeNull();
  });

  it('accepts one ethnic group, because the schema requires only the first', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details({ ethnicGroupCodes: ['E1'] }), contactHours: [block()] },
      currentCert,
      AS_AT,
    );
    expect(row.missing).not.toContain('ethnicGroupCodes');
  });

  it('does not require an age band, min or max age taught, or iwi', () => {
    const row = censusRow(
      {
        member: member({ id: 's1' }),
        details: details({
          ageBand: null,
          minAgeTaughtMonths: null,
          maxAgeTaughtMonths: null,
          iwiCodes: [],
        }),
        contactHours: [block()],
      },
      currentCert,
      AS_AT,
    );
    // All four are minOccurs="0" nillable in the schema.
    expect(row.reportable).toBe(true);
  });
});

describe('censusRow — registration is three-state and null is not false', () => {
  it('is null when no certificate is linked, and names it as missing', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      [],
      AS_AT,
    );
    // The failure this guards: sending `false` asserts a named person is not
    // registered on the strength of a missing row.
    expect(row.isRegistered).toBeNull();
    expect(row.missing).toContain('isRegistered');
  });

  it('is null when a certificate exists but was never linked to the person', () => {
    // 0038 leaves every link null on purpose. This is the common case, not an edge.
    const unlinked = [cert({ id: 'r1', staffMemberId: null })];
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      unlinked,
      AS_AT,
    );
    expect(row.isRegistered).toBeNull();
  });

  it('is false — not null — when a linked certificate has lapsed', () => {
    const lapsed = [cert({ id: 'r1', expiresOn: '2026-08-01' })];
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      lapsed,
      AS_AT,
    );
    expect(row.isRegistered).toBe(false);
    // A known-lapsed certificate is an answer, so it is not a gap.
    expect(row.missing).not.toContain('isRegistered');
  });

  it('treats a certificate with no expiry as not current, matching countCertificated', () => {
    const noExpiry = [cert({ id: 'r1', expiresOn: null })];
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      noExpiry,
      AS_AT,
    );
    expect(row.isRegistered).toBe(false);
  });

  it('ignores an archived certificate', () => {
    const archived = [cert({ id: 'r1', archivedAt: '2026-05-01T00:00:00Z' })];
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      archived,
      AS_AT,
    );
    expect(row.isRegistered).toBeNull();
  });

  it('does not require registration for a support role', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details({ roleKind: 'support' }), contactHours: [] },
      [],
      AS_AT,
    );
    // OtherStaffRole asks for a role code and the three booleans, and nothing else.
    expect(row.missing).not.toContain('isRegistered');
    expect(row.missing).not.toContain('contactHours');
    expect(row.missing).not.toContain('highestQualificationCode');
    expect(row.reportable).toBe(true);
  });

  it('does not require contact hours or isPaid for a home-based educator', () => {
    const row = censusRow(
      {
        member: member({ id: 's1' }),
        details: details({ roleKind: 'home_based_educator', isPaid: null }),
        contactHours: [],
      },
      currentCert,
      AS_AT,
    );
    expect(row.missing).not.toContain('contactHours');
    expect(row.missing).not.toContain('isPaid');
    expect(row.missing).toEqual([]);
  });
});

describe('censusRow — hours never round in the reporter’s favour', () => {
  it('floors to the integer the schema takes, and keeps the exact minutes', () => {
    // 7.5 hours on one day: the wire gets 7, and the half hour is not lost from view.
    const row = censusRow(
      {
        member: member({ id: 's1' }),
        details: details(),
        contactHours: [block({ fromTime: '08:00:00', toTime: '15:30:00' })],
      },
      currentCert,
      AS_AT,
    );
    expect(row.contractedMinutes).toBe(450);
    expect(row.hoursWorked).toBe(7);
  });

  it('reports an over-long week rather than clamping it to the schema maximum', () => {
    const blocks = [1, 2, 3, 4, 5, 6, 7].map((weekday) =>
      block({ weekday, fromTime: '00:00:00', toTime: '18:00:00' }),
    );
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: blocks },
      currentCert,
      AS_AT,
    );
    expect(row.hoursWorked).toBe(126);
    expect(row.codeIssues).toContainEqual(
      expect.objectContaining({ field: 'hoursWorked', problem: 'not-a-schema-value' }),
    );
    expect(row.reportable).toBe(false);
  });
});

describe('censusRow — code checking', () => {
  const genderSet: LoadedCodeSet = {
    domain: 'gender',
    codes: [
      { code: 'F', effectiveFrom: '2000-01-01', effectiveTo: null },
      { code: 'OLD', effectiveFrom: '2000-01-01', effectiveTo: '2019-05-31' },
    ],
  };

  it('flags a code that is not in the loaded set', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details({ genderCode: 'ZZ' }), contactHours: [block()] },
      currentCert,
      AS_AT,
      [genderSet],
    );
    expect(row.codeIssues).toContainEqual(
      expect.objectContaining({ field: 'genderCode', code: 'ZZ', problem: 'not-in-set' }),
    );
    expect(row.reportable).toBe(false);
  });

  it('flags a code whose effective window has closed', () => {
    const row = censusRow(
      { member: member({ id: 's1' }), details: details({ genderCode: 'OLD' }), contactHours: [block()] },
      currentCert,
      AS_AT,
      [genderSet],
    );
    expect(row.codeIssues).toContainEqual(
      expect.objectContaining({ field: 'genderCode', problem: 'not-effective' }),
    );
  });

  it('accepts an undated code, and treats undated as effective rather than expired', () => {
    const undated: LoadedCodeSet = {
      domain: 'gender',
      codes: [{ code: 'F', effectiveFrom: null, effectiveTo: null }],
    };
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      currentCert,
      AS_AT,
      [undated],
    );
    expect(row.codeIssues).toEqual([]);
  });

  it('flags a code longer than the LookupCode bound even with no set loaded', () => {
    const row = censusRow(
      {
        member: member({ id: 's1' }),
        details: details({ genderCode: 'ELEVENCHARS' }),
        contactHours: [block()],
      },
      currentCert,
      AS_AT,
    );
    expect('ELEVENCHARS'.length).toBe(11);
    expect(row.codeIssues).toContainEqual(
      expect.objectContaining({ field: 'genderCode', problem: 'too-long' }),
    );
  });

  it('does not turn an unloaded domain into a per-row data error', () => {
    // A missing reference set is the operator's problem, not the centre's. It surfaces
    // through codesChecked, not as an issue a manager would try to fix on a person.
    const row = censusRow(
      { member: member({ id: 's1' }), details: details(), contactHours: [block()] },
      currentCert,
      AS_AT,
      [],
    );
    expect(row.codeIssues).toEqual([]);
    expect(row.reportable).toBe(true);
  });

  it('flags a role kind and an age band the schema does not define', () => {
    const row = censusRow(
      {
        member: member({ id: 's1' }),
        details: details({ roleKind: 'headmaster', ageBand: '90_95' }),
        contactHours: [block()],
      },
      currentCert,
      AS_AT,
    );
    expect(row.roleKind).toBeNull();
    expect(row.codeIssues.map((i) => i.field)).toEqual(
      expect.arrayContaining(['roleKind', 'ageBand']),
    );
    // An unrecognised role kind also means the required-field set is unknown.
    expect(row.missing).toContain('roleKind');
  });

  it('flags an age taught outside the schema’s 0-72 months', () => {
    const row = censusRow(
      {
        member: member({ id: 's1' }),
        details: details({ maxAgeTaughtMonths: 96 }),
        contactHours: [block()],
      },
      currentCert,
      AS_AT,
    );
    expect(row.codeIssues).toContainEqual(
      expect.objectContaining({ field: 'maxAgeTaughtMonths', problem: 'not-a-schema-value' }),
    );
  });
});

describe('summariseCensus', () => {
  const complete = {
    member: member({ id: 's1', fullName: 'Ed' }),
    details: details(),
    contactHours: [block()],
  };
  const incomplete = {
    member: member({ id: 's2', fullName: 'Sam' }),
    details: null,
    contactHours: [],
  };
  const certs = [cert({ id: 'r1', staffMemberId: 's1' }), cert({ id: 'r2', staffMemberId: 's2' })];

  it('counts who cannot be reported and refuses to call itself complete', () => {
    const s = summariseCensus([complete, incomplete], certs, AS_AT);
    expect(s.rows).toHaveLength(2);
    expect(s.incompleteCount).toBe(1);
    expect(s.complete).toBe(false);
  });

  it('is complete when every person on the roster is reportable', () => {
    const s = summariseCensus([complete], certs, AS_AT);
    expect(s.complete).toBe(true);
    expect(s.incompleteCount).toBe(0);
  });

  it('is not complete with an empty roster, because nothing was assessed', () => {
    // Zero of zero people reportable is arithmetically true and a false picture — the
    // same failure `summariseFunding` had when a period with no records declared
    // itself final.
    const s = summariseCensus([], certs, AS_AT);
    expect(s.rows).toEqual([]);
    expect(s.complete).toBe(false);
  });

  it('excludes people who had left by the return date', () => {
    const left = {
      member: member({ id: 's3', finishedOn: '2026-03-31' }),
      details: details(),
      contactHours: [block()],
    };
    const s = summariseCensus([complete, left], certs, AS_AT);
    expect(s.rows.map((r) => r.staffMemberId)).toEqual(['s1']);
  });

  it('excludes people who had not started by the return date', () => {
    const future = {
      member: member({ id: 's4', startedOn: '2026-12-01' }),
      details: details(),
      contactHours: [block()],
    };
    const s = summariseCensus([complete, future], certs, AS_AT);
    expect(s.rows.map((r) => r.staffMemberId)).toEqual(['s1']);
  });

  it('reports codesChecked as null when no sets were supplied at all', () => {
    expect(summariseCensus([complete], certs, AS_AT).codesChecked).toBeNull();
    expect(summariseCensus([complete], certs, AS_AT, []).codesChecked).toBeNull();
  });

  it('reports codesChecked as false when a domain in use has no set', () => {
    const onlyGender: LoadedCodeSet = {
      domain: 'gender',
      codes: [{ code: 'F', effectiveFrom: null, effectiveTo: null }],
    };
    // Role and qualification codes are present and have no loaded set.
    expect(summariseCensus([complete], certs, AS_AT, [onlyGender]).codesChecked).toBe(false);
  });

  it('reports codesChecked as true only when every domain in use was loaded', () => {
    const sets: LoadedCodeSet[] = [
      { domain: 'gender', codes: [{ code: 'F', effectiveFrom: null, effectiveTo: null }] },
      { domain: 'staff_role', codes: [{ code: 'R1', effectiveFrom: null, effectiveTo: null }] },
      { domain: 'qualification', codes: [{ code: 'Q1', effectiveFrom: null, effectiveTo: null }] },
      { domain: 'ethnic_group', codes: [{ code: 'E1', effectiveFrom: null, effectiveTo: null }] },
    ];
    const s = summariseCensus([complete], certs, AS_AT, sets);
    expect(s.codesChecked).toBe(true);
    expect(s.complete).toBe(true);
  });

  it('carries the return date it was computed as at', () => {
    // Nothing in this module reads a clock; the date is the caller's.
    expect(summariseCensus([complete], certs, '2025-06-30').asAt).toBe('2025-06-30');
  });
});
