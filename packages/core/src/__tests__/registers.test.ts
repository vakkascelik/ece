import { describe, expect, it } from 'vitest';
import {
  compareIncidentUrgency,
  dosesOnDate,
  liveAdministrations,
  minutesBetween,
  sleepStatuses,
  summariseIncidents,
  type Incident,
  type MedicationAdministration,
  type SleepCheck,
} from '../registers';

const incident = (over: Partial<Incident> & Pick<Incident, 'id' | 'occurredAt'>): Incident => ({
  centreId: 'c1',
  childId: 'k1',
  kind: 'injury',
  location: null,
  description: 'Grazed knee.',
  firstAidGiven: null,
  treatedBy: null,
  witnessName: null,
  reportedBy: null,
  status: 'final',
  parentNotifiedAt: '2026-08-07T02:00:00.000Z',
  notifiedBy: 'u1',
  acknowledgedAt: '2026-08-07T03:00:00.000Z',
  acknowledgedBy: 'g1',
  supersedes: null,
  ...over,
});

describe('summariseIncidents', () => {
  it('counts each incident in exactly one band, and the bands are ordered', () => {
    const s = summariseIncidents([
      incident({ id: '1', occurredAt: 'z', status: 'draft' }),
      incident({ id: '2', occurredAt: 'z', parentNotifiedAt: null, notifiedBy: null, acknowledgedAt: null, acknowledgedBy: null }),
      incident({ id: '3', occurredAt: 'z', acknowledgedAt: null, acknowledgedBy: null }),
      incident({ id: '4', occurredAt: 'z' }),
    ]);
    expect(s).toEqual({
      drafts: 1,
      awaitingNotification: 1,
      awaitingAcknowledgement: 1,
      clear: false,
    });
  });

  it('is clear when every incident is finished, rather than when there are none', () => {
    // The property that keeps the dashboard readable: a centre with a hundred
    // resolved incidents is in the same state as a centre with none.
    const s = summariseIncidents([
      incident({ id: '1', occurredAt: 'z' }),
      incident({ id: '2', occurredAt: 'z' }),
    ]);
    expect(s.clear).toBe(true);
    expect(summariseIncidents([]).clear).toBe(true);
  });

  it('counts a draft as a draft even when it carries stale notification columns', () => {
    // A draft cannot legally hold these (the CHECK forbids acknowledgement before
    // final), but the band order must not depend on that constraint holding.
    const s = summariseIncidents([incident({ id: '1', occurredAt: 'z', status: 'draft' })]);
    expect(s.drafts).toBe(1);
    expect(s.awaitingAcknowledgement).toBe(0);
  });
});

describe('compareIncidentUrgency', () => {
  it('puts unfinished work above finished work regardless of age', () => {
    const oldDone = incident({ id: 'done', occurredAt: '2026-08-07T01:00:00.000Z' });
    const newDraft = incident({ id: 'draft', occurredAt: '2026-08-07T09:00:00.000Z', status: 'draft' });
    expect([oldDone, newDraft].sort(compareIncidentUrgency)[0]?.id).toBe('draft');
  });

  it('sorts outstanding work oldest first — the three-hour-old draft is the problem', () => {
    const older = incident({ id: 'older', occurredAt: '2026-08-07T06:00:00.000Z', status: 'draft' });
    const newer = incident({ id: 'newer', occurredAt: '2026-08-07T09:00:00.000Z', status: 'draft' });
    expect([newer, older].sort(compareIncidentUrgency).map((i) => i.id)).toEqual(['older', 'newer']);
  });

  it('but sorts finished work newest first', () => {
    const older = incident({ id: 'older', occurredAt: '2026-08-07T06:00:00.000Z' });
    const newer = incident({ id: 'newer', occurredAt: '2026-08-07T09:00:00.000Z' });
    expect([older, newer].sort(compareIncidentUrgency).map((i) => i.id)).toEqual(['newer', 'older']);
  });
});

const dose = (
  over: Partial<MedicationAdministration> & Pick<MedicationAdministration, 'id' | 'givenAt'>,
): MedicationAdministration => ({
  authorityId: 'a1',
  childId: 'k1',
  doseGiven: '5ml',
  givenBy: 'u1',
  witnessedBy: null,
  corrects: null,
  note: null,
  ...over,
});

describe('liveAdministrations', () => {
  it('drops a row that has been corrected', () => {
    const rows = [dose({ id: 1, givenAt: 'z' }), dose({ id: 2, givenAt: 'z', corrects: 1 })];
    expect(liveAdministrations(rows).map((r) => r.id)).toEqual([2]);
  });

  it('is transitive — a correction of a correction leaves only the last', () => {
    // Stopping at one hop leaves the middle version in the list, which reads as a
    // second dose that was never given.
    const rows = [
      dose({ id: 1, givenAt: 'z' }),
      dose({ id: 2, givenAt: 'z', corrects: 1 }),
      dose({ id: 3, givenAt: 'z', corrects: 2 }),
    ];
    expect(liveAdministrations(rows).map((r) => r.id)).toEqual([3]);
  });

  it('leaves uncorrected rows alone', () => {
    const rows = [dose({ id: 1, givenAt: 'z' }), dose({ id: 2, givenAt: 'z' })];
    expect(liveAdministrations(rows)).toHaveLength(2);
  });
});

describe('dosesOnDate', () => {
  // Auckland is UTC+12 here, so 20:00Z on the 6th is 08:00 on the 7th locally. A
  // naive UTC date would file the morning dose under yesterday.
  const toLocalDate = (instant: string) =>
    new Date(new Date(instant).getTime() + 12 * 3_600_000).toISOString().slice(0, 10);

  it('counts by the centre’s day, not UTC’s', () => {
    const rows = [
      dose({ id: 1, givenAt: '2026-08-06T20:00:00.000Z' }),
      dose({ id: 2, givenAt: '2026-08-07T01:00:00.000Z' }),
    ];
    expect(dosesOnDate(rows, 'a1', '2026-08-07', toLocalDate)).toHaveLength(2);
    expect(dosesOnDate(rows, 'a1', '2026-08-06', toLocalDate)).toHaveLength(0);
  });

  it('ignores other authorities and corrected rows', () => {
    const rows = [
      dose({ id: 1, givenAt: '2026-08-06T20:00:00.000Z' }),
      dose({ id: 2, givenAt: '2026-08-06T21:00:00.000Z', corrects: 1 }),
      dose({ id: 3, givenAt: '2026-08-06T22:00:00.000Z', authorityId: 'other' }),
    ];
    expect(dosesOnDate(rows, 'a1', '2026-08-07', toLocalDate).map((r) => r.id)).toEqual([2]);
  });
});

describe('minutesBetween', () => {
  it('floors, so it never overstates how recently a child was seen', () => {
    expect(minutesBetween('2026-08-07T00:00:00.000Z', '2026-08-07T00:10:59.000Z')).toBe(10);
    expect(minutesBetween('2026-08-07T00:00:00.000Z', '2026-08-07T00:09:59.000Z')).toBe(9);
  });
});

const check = (over: Partial<SleepCheck> & Pick<SleepCheck, 'id' | 'at'>): SleepCheck => ({
  childId: 'k1',
  observedPosition: 'back',
  breathingObserved: true,
  checkedBy: 'u1',
  corrects: null,
  note: null,
  ...over,
});

describe('sleepStatuses', () => {
  const now = '2026-08-07T00:30:00.000Z';

  it('reports overdue as null when the centre has stated no interval', () => {
    // The assertion this whole feature turns on. `false` would say "checked
    // recently enough"; nobody has said what enough means.
    const [s] = sleepStatuses(['k1'], [check({ id: 1, at: '2026-08-07T00:00:00.000Z' })], now, null);
    expect(s?.minutesSince).toBe(30);
    expect(s?.overdue).toBeNull();
    expect(s?.overdue).not.toBe(false);
  });

  it('is overdue exactly at the interval, not a minute after', () => {
    const checks = [check({ id: 1, at: '2026-08-07T00:20:00.000Z' })];
    expect(sleepStatuses(['k1'], checks, now, 10)[0]?.overdue).toBe(true);
    expect(sleepStatuses(['k1'], checks, now, 11)[0]?.overdue).toBe(false);
  });

  it('reports a child who has never been checked as null rather than overdue', () => {
    const [s] = sleepStatuses(['k1'], [], now, 10);
    expect(s).toEqual({ childId: 'k1', lastCheckedAt: null, minutesSince: null, overdue: null });
  });

  it('uses the latest check, not the last row returned', () => {
    const checks = [
      check({ id: 1, at: '2026-08-07T00:25:00.000Z' }),
      check({ id: 2, at: '2026-08-07T00:05:00.000Z' }),
    ];
    expect(sleepStatuses(['k1'], checks, now, 10)[0]?.minutesSince).toBe(5);
  });

  it('ignores a corrected check when picking the latest', () => {
    // A correction that moved a check earlier must not leave the wrong time
    // standing as the most recent observation.
    const checks = [
      check({ id: 1, at: '2026-08-07T00:25:00.000Z' }),
      check({ id: 2, at: '2026-08-07T00:05:00.000Z', corrects: 1 }),
    ];
    const [s] = sleepStatuses(['k1'], checks, now, 10);
    expect(s?.lastCheckedAt).toBe('2026-08-07T00:05:00.000Z');
    expect(s?.overdue).toBe(true);
  });

  it('returns one row per child asked about, in that order', () => {
    const rows = sleepStatuses(['k2', 'k1'], [check({ id: 1, at: now })], now, 10);
    expect(rows.map((r) => r.childId)).toEqual(['k2', 'k1']);
  });
});
