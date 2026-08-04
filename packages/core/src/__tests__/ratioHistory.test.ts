import { describe, expect, it } from 'vitest';
import { replayDay, summariseDay } from '../ratioHistory';

/**
 * Replaying a day into ratio history.
 *
 * This is the report a licensing review reads, so the cases below are the ones that
 * would embarrass a centre if the arithmetic were wrong: a brief breach that somebody
 * noticed and fixed, a child whose birthday falls in the reporting period, and a day
 * that ends while still over ratio.
 */

// One under 2 and two over 2 for the whole of 2026.
const children = [
  { id: 'baby', dateOfBirth: '2025-06-01' },
  { id: 'kid1', dateOfBirth: '2021-01-01' },
  { id: 'kid2', dateOfBirth: '2021-06-01' },
];

const T = (hhmm: string) => `2026-08-04T${hhmm}:00.000Z`;

describe('replayDay', () => {
  it('produces one snapshot per event, not a sample', () => {
    const day = replayDay({
      date: '2026-08-04',
      attendance: [
        { childId: 'kid1', kind: 'in', at: T('20:00') },
        { childId: 'kid2', kind: 'in', at: T('20:05') },
      ],
      adultCounts: [{ adults: 2, at: T('19:55') }],
      children,
    });
    expect(day.snapshots).toHaveLength(3);
    expect(day.snapshots.map((s) => s.cause)).toEqual(['adult-count', 'sign-in', 'sign-in']);
  });

  it('interleaves attendance and adult counts by time', () => {
    const day = replayDay({
      date: '2026-08-04',
      attendance: [{ childId: 'kid1', kind: 'in', at: T('20:10') }],
      adultCounts: [
        { adults: 1, at: T('20:00') },
        { adults: 2, at: T('20:20') },
      ],
      children,
    });
    expect(day.snapshots.map((s) => s.assessment.adultsPresent)).toEqual([1, 1, 2]);
  });

  it('catches a short breach that somebody noticed and fixed', () => {
    // Seven over-2s with one adult is a breach; a second adult arrives twelve minutes
    // later. A fifteen-minute sampler would have missed this entirely — which is why
    // this is a replay.
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      dateOfBirth: '2021-01-01',
    }));
    const day = replayDay({
      date: '2026-08-04',
      attendance: many.map((c, i) => ({ childId: c.id, kind: 'in' as const, at: T(`20:0${i}`) })),
      adultCounts: [
        { adults: 1, at: T('19:55') },
        { adults: 2, at: T('20:18') },
      ],
      children: many,
    });

    expect(day.breaches).toHaveLength(1);
    expect(day.breaches[0]!.from).toBe(T('20:06')); // the seventh child
    expect(day.breaches[0]!.to).toBe(T('20:18'));
    expect(day.breaches[0]!.minutes).toBe(12);
    expect(day.minutesInBreach).toBe(12);
  });

  it('treats a deepening breach as one period and keeps the worst shortfall', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      id: `c${i}`,
      dateOfBirth: '2021-01-01',
    }));
    const day = replayDay({
      date: '2026-08-04',
      attendance: many.map((c, i) => ({
        childId: c.id,
        kind: 'in' as const,
        at: `2026-08-04T20:${String(i).padStart(2, '0')}:00.000Z`,
      })),
      adultCounts: [{ adults: 1, at: T('19:55') }],
      children: many,
    });
    // One long breach rather than one per arrival.
    expect(day.breaches).toHaveLength(1);
    // 25 over-2s needs 3 adults; one present.
    expect(day.breaches[0]!.worstShortfall).toBe(2);
  });

  it('leaves a breach open when the day ends in one, rather than inventing an end', () => {
    const day = replayDay({
      date: '2026-08-04',
      attendance: [{ childId: 'baby', kind: 'in', at: T('20:00') }],
      adultCounts: [],
      children,
    });
    expect(day.breaches).toHaveLength(1);
    expect(day.breaches[0]!.to).toBeNull();
    // Not zero. A total that silently omits an open breach reads as a clean day.
    expect(day.minutesInBreach).toBeNull();
    expect(summariseDay(day)).toContain('still open');
  });

  it('uses ages as at the date replayed, not today', () => {
    // A child who turns two on 15 March. Replaying 1 March must band them as under 2,
    // and replaying 20 March as over 2 — otherwise a report run in December rewrites
    // February in the centre's favour.
    const turningTwo = [{ id: 'birthday', dateOfBirth: '2024-03-15' }];
    const before = replayDay({
      date: '2026-03-01',
      attendance: [{ childId: 'birthday', kind: 'in', at: '2026-03-01T20:00:00.000Z' }],
      adultCounts: [{ adults: 1, at: '2026-03-01T19:55:00.000Z' }],
      children: turningTwo,
    });
    const after = replayDay({
      date: '2026-03-20',
      attendance: [{ childId: 'birthday', kind: 'in', at: '2026-03-20T20:00:00.000Z' }],
      adultCounts: [{ adults: 1, at: '2026-03-20T19:55:00.000Z' }],
      children: turningTwo,
    });
    expect(before.snapshots.at(-1)!.assessment.underTwo).toBe(1);
    expect(after.snapshots.at(-1)!.assessment.underTwo).toBe(0);
    expect(after.snapshots.at(-1)!.assessment.twoAndOver).toBe(1);
  });

  it('counts a child it has no date of birth for, banded as over 2', () => {
    // Purged since, or not passed in. Omitting them would understate the roll and
    // flatter the ratio, so they are counted — in the weaker band, which is the honest
    // direction for an assumption.
    const day = replayDay({
      date: '2026-08-04',
      attendance: [{ childId: 'unknown-child', kind: 'in', at: T('20:00') }],
      adultCounts: [{ adults: 1, at: T('19:55') }],
      children: [],
    });
    const last = day.snapshots.at(-1)!.assessment;
    expect(last.present).toBe(1);
    expect(last.twoAndOver).toBe(1);
    expect(last.underTwo).toBe(0);
  });

  it('handles sign-outs, and does not double-count a repeated sign-in', () => {
    const day = replayDay({
      date: '2026-08-04',
      attendance: [
        { childId: 'kid1', kind: 'in', at: T('20:00') },
        // A duplicate that got through — a Set makes this idempotent, as the derived
        // view is.
        { childId: 'kid1', kind: 'in', at: T('20:01') },
        { childId: 'kid1', kind: 'out', at: T('23:00') },
      ],
      adultCounts: [{ adults: 2, at: T('19:55') }],
      children,
    });
    expect(day.snapshots[1]!.assessment.present).toBe(1);
    expect(day.snapshots[2]!.assessment.present).toBe(1);
    expect(day.snapshots.at(-1)!.assessment.present).toBe(0);
  });

  it('reports an empty day plainly', () => {
    const day = replayDay({
      date: '2026-08-04',
      attendance: [],
      adultCounts: [],
      children,
    });
    expect(day.snapshots).toEqual([]);
    expect(day.breaches).toEqual([]);
    expect(day.worst).toBeNull();
    expect(summariseDay(day)).toContain('no attendance recorded');
  });

  it('says "no breaches recorded" rather than "compliant"', () => {
    // The events only record what was signed in. A child who was present and never
    // signed in is invisible here, so the report must not claim more than it knows.
    const day = replayDay({
      date: '2026-08-04',
      attendance: [{ childId: 'kid1', kind: 'in', at: T('20:00') }],
      adultCounts: [{ adults: 1, at: T('19:55') }],
      children,
    });
    expect(day.breaches).toEqual([]);
    expect(summariseDay(day)).toContain('no ratio breaches recorded');
    expect(summariseDay(day)).not.toContain('compliant');
  });
});
