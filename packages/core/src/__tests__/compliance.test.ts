import { describe, expect, it } from 'vitest';
import {
  assessAll,
  assessExpiry,
  summarise,
  WARNING_DAYS,
  type StaffRecord,
  type StaffRecordKind,
} from '../compliance';

const TODAY = '2026-08-04';

const record = (over: Partial<StaffRecord> = {}): StaffRecord => ({
  id: 'r',
  centreId: 'c',
  userId: null,
  personName: 'Alex Kaiako',
  staffMemberId: null,
  roleNote: null,
  kind: 'first_aid',
  reference: null,
  issuedOn: '2024-08-04',
  expiresOn: '2026-08-04',
  sightedBy: 'u1',
  sightedAt: '2024-08-05T00:00:00Z',
  note: null,
  archivedAt: null,
  ...over,
});

describe('assessExpiry', () => {
  it('counts today as still current, not expired', () => {
    // A certificate expiring today is valid today. Off by one here tells a centre a
    // person cannot work when they can.
    const a = assessExpiry(record({ expiresOn: TODAY }), TODAY);
    expect(a.daysRemaining).toBe(0);
    expect(a.status).not.toBe('expired');
  });

  it('is expired the day after', () => {
    const a = assessExpiry(record({ expiresOn: '2026-08-03' }), TODAY);
    expect(a.status).toBe('expired');
    expect(a.daysRemaining).toBe(-1);
  });

  it('warns earlier for police vetting than for first aid', () => {
    // Not cosmetic. Vetting goes to NZ Police and takes weeks, so a 30-day warning
    // arrives too late to act on; a first aid course can be booked in a fortnight.
    const in100Days = '2026-11-12';
    expect(assessExpiry(record({ kind: 'police_vetting', expiresOn: in100Days }), TODAY).status).toBe(
      'due-soon',
    );
    expect(assessExpiry(record({ kind: 'first_aid', expiresOn: in100Days }), TODAY).status).toBe(
      'current',
    );
  });

  it('uses each kind lead time at its exact boundary', () => {
    for (const kind of Object.keys(WARNING_DAYS) as StaffRecordKind[]) {
      const days = WARNING_DAYS[kind];
      const onBoundary = addDays(TODAY, days);
      const justOutside = addDays(TODAY, days + 1);
      expect(assessExpiry(record({ kind, expiresOn: onBoundary }), TODAY).status).toBe('due-soon');
      expect(assessExpiry(record({ kind, expiresOn: justOutside }), TODAY).status).toBe('current');
    }
  });

  it('treats a missing expiry as no-expiry, not as current', () => {
    const a = assessExpiry(record({ expiresOn: null }), TODAY);
    expect(a.status).toBe('no-expiry');
    expect(a.daysRemaining).toBeNull();
  });

  it('flags a record nobody has sighted', () => {
    // "We have a certificate number" and "somebody looked at the document" are
    // different facts, and only the second survives a review.
    const a = assessExpiry(record({ sightedBy: null, sightedAt: null }), TODAY);
    expect(a.unsighted).toBe(true);
    // Still current — unsighted is a separate axis from expiry, not a worse expiry.
    expect(a.status).toBe('due-soon');
  });

  it('is unaffected by a DST transition between the two dates', () => {
    // New Zealand shifts in April and September. Millisecond division across a
    // transition drops or adds an hour and can round a day boundary the wrong way.
    const acrossApril = assessExpiry(record({ expiresOn: '2026-04-10' }), '2026-04-01');
    expect(acrossApril.daysRemaining).toBe(9);
    const acrossSeptember = assessExpiry(record({ expiresOn: '2026-10-01' }), '2026-09-20');
    expect(acrossSeptember.daysRemaining).toBe(11);
  });
});

describe('sorting by exposure, not by date', () => {
  it('puts an expired vetting above a first aid certificate expiring sooner', () => {
    // The plan asked for "sorted by exposure". An expired police vetting is a worse
    // position than a first aid certificate lapsing next week, even though the date is
    // further away.
    const sorted = assessAll(
      [
        record({ id: 'aid', kind: 'first_aid', expiresOn: addDays(TODAY, 5), personName: 'B' }),
        record({ id: 'vet', kind: 'police_vetting', expiresOn: '2026-01-01', personName: 'A' }),
      ],
      TODAY,
    );
    expect(sorted.map((a) => a.record.id)).toEqual(['vet', 'aid']);
  });

  it('ranks an unsighted record with the problems, not with the healthy ones', () => {
    const sorted = assessAll(
      [
        record({ id: 'fine', expiresOn: addDays(TODAY, 300), kind: 'other' }),
        record({
          id: 'unsighted',
          expiresOn: addDays(TODAY, 300),
          kind: 'other',
          sightedBy: null,
          sightedAt: null,
        }),
      ],
      TODAY,
    );
    expect(sorted[0]!.record.id).toBe('unsighted');
  });

  it('excludes archived records entirely', () => {
    const sorted = assessAll(
      [record({ id: 'gone', expiresOn: '2020-01-01', archivedAt: '2021-01-01T00:00:00Z' })],
      TODAY,
    );
    expect(sorted).toHaveLength(0);
  });

  it('breaks ties by urgency then by name, so the order is stable', () => {
    const sorted = assessAll(
      [
        record({ id: 'later', kind: 'first_aid', expiresOn: addDays(TODAY, 20), personName: 'Zoe' }),
        record({ id: 'sooner', kind: 'first_aid', expiresOn: addDays(TODAY, 5), personName: 'Ana' }),
      ],
      TODAY,
    );
    expect(sorted.map((a) => a.record.id)).toEqual(['sooner', 'later']);
  });
});

describe('summarise', () => {
  it('counts expired, due soon and unsighted separately', () => {
    const s = summarise(
      assessAll(
        [
          record({ id: '1', expiresOn: '2020-01-01' }),
          record({ id: '2', kind: 'first_aid', expiresOn: addDays(TODAY, 10) }),
          record({ id: '3', kind: 'other', expiresOn: null, sightedBy: null, sightedAt: null }),
        ],
        TODAY,
      ),
    );
    expect(s.expired).toBe(1);
    expect(s.dueSoon).toBe(1);
    expect(s.unsighted).toBe(1);
    expect(s.total).toBe(3);
  });

  it('calls a centre clean when nothing is expired or unsighted, even with things due soon', () => {
    // "Due soon" is a to-do list, not a gap. A dashboard that is never green is a
    // dashboard nobody reads.
    const s = summarise(
      assessAll([record({ kind: 'first_aid', expiresOn: addDays(TODAY, 10) })], TODAY),
    );
    expect(s.dueSoon).toBe(1);
    expect(s.clean).toBe(true);
  });

  it('is not clean with a single unsighted record', () => {
    const s = summarise(
      assessAll(
        [record({ expiresOn: addDays(TODAY, 900), sightedBy: null, sightedAt: null })],
        TODAY,
      ),
    );
    expect(s.clean).toBe(false);
  });
});

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}
