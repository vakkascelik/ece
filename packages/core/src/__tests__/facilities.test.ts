import { describe, expect, it } from 'vitest';
import {
  compareHazardUrgency,
  consentGaps,
  currentConsent,
  currentImmunisation,
  daysSince,
  drillStatuses,
  lastHeadcount,
  latestByArea,
  onSite,
  summariseHazards,
  type Drill,
  type ExcursionConsent,
  type Hazard,
  type Headcount,
  type ImmunisationRecord,
  type SafetyCheck,
  type Visitor,
} from '../facilities';

const drill = (over: Partial<Drill> & Pick<Drill, 'id' | 'heldAt'>): Drill => ({
  centreId: 'c1',
  kind: 'fire',
  durationSeconds: null,
  adultsPresent: null,
  childrenPresent: null,
  notes: null,
  issuesFound: null,
  recordedBy: null,
  ...over,
});

describe('daysSince', () => {
  it('floors, so it never overstates how recently something happened', () => {
    // 9.8 days rounded to 10 would report a drill as due against a 10-day interval
    // when it is not, and a product that cries wolf gets ignored.
    expect(daysSince('2026-08-01T00:00:00.000Z', '2026-08-10T19:00:00.000Z')).toBe(9);
    expect(daysSince('2026-08-01T00:00:00.000Z', '2026-08-11T00:00:00.000Z')).toBe(10);
  });
});

describe('drillStatuses', () => {
  const now = '2026-08-10T00:00:00.000Z';

  it('reports overdue as null when the centre has stated no interval', () => {
    // The assertion this feature turns on, identical to sleepStatuses.
    const [fire] = drillStatuses([drill({ id: '1', heldAt: '2026-01-01T00:00:00.000Z' })], now, null);
    expect(fire?.daysSince).toBe(221);
    expect(fire?.overdue).toBeNull();
    expect(fire?.overdue).not.toBe(false);
  });

  it('reports a kind never held as null rather than infinitely overdue', () => {
    const statuses = drillStatuses([drill({ id: '1', heldAt: now })], now, 90);
    const quake = statuses.find((s) => s.kind === 'earthquake');
    expect(quake).toEqual({
      kind: 'earthquake',
      lastHeldAt: null,
      daysSince: null,
      overdue: null,
    });
  });

  it('is overdue exactly at the interval', () => {
    const held = [drill({ id: '1', heldAt: '2026-08-01T00:00:00.000Z' })];
    expect(drillStatuses(held, now, 9)[0]?.overdue).toBe(true);
    expect(drillStatuses(held, now, 10)[0]?.overdue).toBe(false);
  });

  it('uses the most recent drill of each kind, not the last in the list', () => {
    const statuses = drillStatuses(
      [
        drill({ id: 'old', heldAt: '2026-01-01T00:00:00.000Z' }),
        drill({ id: 'new', heldAt: '2026-08-09T00:00:00.000Z' }),
      ],
      now,
      90,
    );
    expect(statuses[0]?.daysSince).toBe(1);
  });

  it('returns one row per kind, so a screen can show what has never been practised', () => {
    expect(drillStatuses([], now, null)).toHaveLength(5);
  });
});

const hazard = (over: Partial<Hazard> & Pick<Hazard, 'id' | 'identifiedAt'>): Hazard => ({
  centreId: 'c1',
  description: 'Loose paving stone.',
  area: null,
  risk: 'medium',
  control: null,
  identifiedBy: null,
  reviewedAt: null,
  resolvedAt: null,
  resolution: null,
  ...over,
});

describe('compareHazardUrgency', () => {
  it('puts open above closed regardless of risk', () => {
    const closedHigh = hazard({
      id: 'closed',
      identifiedAt: '2026-08-01T00:00:00.000Z',
      risk: 'high',
      resolvedAt: '2026-08-02T00:00:00.000Z',
      resolution: 'Fixed.',
    });
    const openLow = hazard({ id: 'open', identifiedAt: '2026-08-01T00:00:00.000Z', risk: 'low' });
    expect([closedHigh, openLow].sort(compareHazardUrgency)[0]?.id).toBe('open');
  });

  it('sorts open hazards worst risk first', () => {
    const med = hazard({ id: 'med', identifiedAt: '2026-08-01T00:00:00.000Z', risk: 'medium' });
    const high = hazard({ id: 'high', identifiedAt: '2026-08-01T00:00:00.000Z', risk: 'high' });
    expect([med, high].sort(compareHazardUrgency).map((h) => h.id)).toEqual(['high', 'med']);
  });

  it('and oldest first inside a risk band — the one walked past two hundred times', () => {
    const march = hazard({ id: 'march', identifiedAt: '2026-03-01T00:00:00.000Z', risk: 'medium' });
    const today = hazard({ id: 'today', identifiedAt: '2026-08-10T00:00:00.000Z', risk: 'medium' });
    expect([today, march].sort(compareHazardUrgency).map((h) => h.id)).toEqual(['march', 'today']);
  });
});

describe('summariseHazards', () => {
  it('separates a managed high risk from one nobody has acted on', () => {
    // The distinction that makes the number useful: a high-risk hazard with a control
    // written is a managed risk, not an outstanding job.
    const s = summariseHazards([
      hazard({ id: '1', identifiedAt: 'z', risk: 'high', control: 'Coned off.' }),
      hazard({ id: '2', identifiedAt: 'z', risk: 'high' }),
      hazard({ id: '3', identifiedAt: 'z', risk: 'low' }),
    ]);
    expect(s).toEqual({ open: 3, openHigh: 2, uncontrolled: 1, clear: false });
  });

  it('treats whitespace as no control at all', () => {
    const s = summariseHazards([hazard({ id: '1', identifiedAt: 'z', risk: 'high', control: '   ' })]);
    expect(s.uncontrolled).toBe(1);
  });

  it('is clear when everything is resolved, not when there are none', () => {
    const s = summariseHazards([
      hazard({ id: '1', identifiedAt: 'z', resolvedAt: 'z', resolution: 'Fixed.' }),
    ]);
    expect(s.clear).toBe(true);
    expect(summariseHazards([]).clear).toBe(true);
  });
});

describe('latestByArea', () => {
  const check = (over: Partial<SafetyCheck> & Pick<SafetyCheck, 'id' | 'at'>): SafetyCheck => ({
    centreId: 'c1',
    area: 'playground',
    passed: true,
    note: null,
    checkedBy: null,
    ...over,
  });

  it('keeps the most recent per area, not the last seen', () => {
    const m = latestByArea([
      check({ id: 1, at: '2026-08-10T09:00:00.000Z' }),
      check({ id: 2, at: '2026-08-10T07:00:00.000Z' }),
      check({ id: 3, at: '2026-08-10T08:00:00.000Z', area: 'sandpit' }),
    ]);
    expect(m.get('playground')?.id).toBe(1);
    expect(m.get('sandpit')?.id).toBe(3);
    expect(m.has('water')).toBe(false);
  });
});

describe('onSite', () => {
  const visitor = (over: Partial<Visitor> & Pick<Visitor, 'id' | 'signedInAt'>): Visitor => ({
    centreId: 'c1',
    fullName: 'Sam',
    organisation: null,
    purpose: null,
    visiting: null,
    signedOutAt: null,
    recordedBy: null,
    ...over,
  });

  it('lists only those still in, oldest arrival first', () => {
    // Read during an evacuation: the person who arrived three hours ago is the one
    // nobody has thought about since.
    const rows = onSite([
      visitor({ id: 'recent', signedInAt: '2026-08-10T10:00:00.000Z' }),
      visitor({ id: 'gone', signedInAt: '2026-08-10T07:00:00.000Z', signedOutAt: '2026-08-10T08:00:00.000Z' }),
      visitor({ id: 'early', signedInAt: '2026-08-10T08:00:00.000Z' }),
    ]);
    expect(rows.map((v) => v.id)).toEqual(['early', 'recent']);
  });
});

const consent = (
  over: Partial<ExcursionConsent> & Pick<ExcursionConsent, 'id' | 'at' | 'granted'>,
): ExcursionConsent => ({
  excursionId: 'e1',
  childId: 'k1',
  givenBy: 'g1',
  recordedBy: 'u1',
  note: null,
  ...over,
});

describe('currentConsent', () => {
  it('is null when nobody has answered — which is not a refusal', () => {
    // A family who have not replied and a family who said no are different
    // situations, and the screen must chase the first without accusing the second.
    expect(currentConsent([], 'e1', 'k1')).toBeNull();
  });

  it('takes the latest decision, so a withdrawal wins', () => {
    const rows = [
      consent({ id: 1, at: '2026-08-01T00:00:00.000Z', granted: true }),
      consent({ id: 2, at: '2026-08-02T00:00:00.000Z', granted: false }),
    ];
    expect(currentConsent(rows, 'e1', 'k1')).toBe(false);
  });

  it('breaks a tie on the same instant by insertion order', () => {
    const rows = [
      consent({ id: 2, at: '2026-08-01T00:00:00.000Z', granted: false }),
      consent({ id: 1, at: '2026-08-01T00:00:00.000Z', granted: true }),
    ];
    expect(currentConsent(rows, 'e1', 'k1')).toBe(false);
  });

  it('does not read another outing’s or another child’s decision', () => {
    const rows = [
      consent({ id: 1, at: 'z', granted: true, excursionId: 'other' }),
      consent({ id: 2, at: 'z', granted: true, childId: 'other' }),
    ];
    expect(currentConsent(rows, 'e1', 'k1')).toBeNull();
  });
});

describe('consentGaps', () => {
  it('separates unanswered from refused', () => {
    // The database refuses departure for both together; the screen must not. Three
    // families who have not replied is a phone call; one who said no is a child who
    // stays behind.
    const rows = [
      consent({ id: 1, at: 'z', granted: true, childId: 'yes' }),
      consent({ id: 2, at: 'z', granted: false, childId: 'no' }),
    ];
    expect(consentGaps(['yes', 'no', 'quiet'], rows, 'e1')).toEqual({
      unanswered: ['quiet'],
      refused: ['no'],
    });
  });
});

describe('lastHeadcount', () => {
  const count = (over: Partial<Headcount> & Pick<Headcount, 'id' | 'at' | 'counted' | 'expected'>): Headcount => ({
    excursionId: 'e1',
    countedBy: null,
    note: null,
    ...over,
  });

  it('is short only when the count is LOWER than expected', () => {
    // A count higher than expected is a miscount or an extra adult. A count lower is
    // a child nobody can see, and the two must not share a label.
    expect(lastHeadcount([count({ id: 1, at: 'z', counted: 11, expected: 12 })], 'e1')?.short).toBe(true);
    expect(lastHeadcount([count({ id: 1, at: 'z', counted: 13, expected: 12 })], 'e1')?.short).toBe(false);
    expect(lastHeadcount([count({ id: 1, at: 'z', counted: 12, expected: 12 })], 'e1')?.short).toBe(false);
  });

  it('takes the latest, so a recount clears an earlier shortfall', () => {
    const rows = [
      count({ id: 1, at: '2026-08-10T11:00:00.000Z', counted: 11, expected: 12 }),
      count({ id: 2, at: '2026-08-10T11:05:00.000Z', counted: 12, expected: 12 }),
    ];
    expect(lastHeadcount(rows, 'e1')?.short).toBe(false);
  });

  it('is null when no count has been taken', () => {
    expect(lastHeadcount([], 'e1')).toBeNull();
  });
});

describe('currentImmunisation', () => {
  const record = (
    over: Partial<ImmunisationRecord> & Pick<ImmunisationRecord, 'id' | 'recordedAt'>,
  ): ImmunisationRecord => ({
    childId: 'k1',
    status: 'up_to_date',
    sightedBy: null,
    sightedAt: null,
    reference: null,
    nextDueOn: null,
    note: null,
    recordedBy: null,
    supersededAt: null,
    ...over,
  });

  it('ignores superseded records', () => {
    const rows = [
      record({ id: 'old', recordedAt: '2026-01-01T00:00:00.000Z', supersededAt: '2026-06-01T00:00:00.000Z' }),
      record({ id: 'new', recordedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(currentImmunisation(rows)?.id).toBe('new');
  });

  it('is null when the centre has never recorded one', () => {
    expect(currentImmunisation([])).toBeNull();
  });

  it('takes the newest live record if somehow two are live', () => {
    const rows = [
      record({ id: 'a', recordedAt: '2026-01-01T00:00:00.000Z' }),
      record({ id: 'b', recordedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    expect(currentImmunisation(rows)?.id).toBe('b');
  });
});
