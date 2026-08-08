import { describe, expect, it } from 'vitest';
import {
  forecastDay,
  summariseForecast,
  type ForecastBooking,
  type ForecastLeave,
  type ForecastShift,
} from '../ratioForecast';
import { RATIO_TABLES_VERIFIED } from '../ratios';

const DATE = '2026-09-15';

// Over 2 on the forecast date; under 2 on it; and one who crosses the boundary
// between today and then.
const CHILDREN = [
  { id: 'over-a', dateOfBirth: '2022-01-01' },
  { id: 'over-b', dateOfBirth: '2022-01-01' },
  { id: 'over-c', dateOfBirth: '2022-01-01' },
  { id: 'over-d', dateOfBirth: '2022-01-01' },
  { id: 'over-e', dateOfBirth: '2022-01-01' },
  { id: 'over-f', dateOfBirth: '2022-01-01' },
  { id: 'over-g', dateOfBirth: '2022-01-01' },
  { id: 'baby', dateOfBirth: '2025-06-01' },
  { id: 'turns-two', dateOfBirth: '2024-09-10' },
];

const booking = (childId: string, fromTime: string | null, toTime: string | null): ForecastBooking => ({
  childId,
  status: 'booked',
  fromTime,
  toTime,
});

const shift = (staffMemberId: string, fromTime: string, toTime: string): ForecastShift => ({
  staffMemberId,
  fromTime,
  toTime,
  status: 'planned',
});

describe('forecastDay', () => {
  it('says nothing at all when nothing is booked or rostered', () => {
    const day = forecastDay({ date: DATE, bookings: [], shifts: [], leave: [], children: CHILDREN });

    expect(day.segments).toEqual([]);
    expect(day.shortfalls).toEqual([]);
    expect(day.worstShortfall).toBe(0);
    expect(summariseForecast(day)).toBe('Nothing booked or rostered.');
  });

  it('finds the gap in the middle of a covered day', () => {
    // Seven over-2s need two adults. One adult goes to lunch at 12:00 and is back at
    // 13:00; the plan is one short for exactly that hour and fine either side.
    const bookings = ['over-a', 'over-b', 'over-c', 'over-d', 'over-e', 'over-f', 'over-g'].map(
      (id) => booking(id, '09:00:00', '15:00:00'),
    );

    const day = forecastDay({
      date: DATE,
      bookings,
      shifts: [shift('alice', '09:00', '15:00'), shift('bob', '09:00', '12:00'), shift('bob', '13:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });

    expect(day.shortfalls).toHaveLength(1);
    expect(day.shortfalls[0]?.from).toBe('12:00');
    expect(day.shortfalls[0]?.to).toBe('13:00');
    expect(day.shortfalls[0]?.assessment.shortfall).toBe(1);
    expect(day.shortfalls[0]?.staffMemberIds).toEqual(['alice']);
    expect(day.worstShortfall).toBe(1);
    expect(summariseForecast(day)).toBe('Short 1 adult from 12:00.');
  });

  it('drops an adult who is on APPROVED leave, and names them', () => {
    const bookings = ['over-a', 'over-b', 'over-c', 'over-d', 'over-e', 'over-f', 'over-g'].map(
      (id) => booking(id, '09:00', '15:00'),
    );
    const shifts = [shift('alice', '09:00', '15:00'), shift('bob', '09:00', '15:00')];

    const covered = forecastDay({ date: DATE, bookings, shifts, leave: [], children: CHILDREN });
    expect(covered.shortfalls).toHaveLength(0);

    const leave: ForecastLeave[] = [
      { staffMemberId: 'bob', fromDate: '2026-09-14', toDate: '2026-09-18', status: 'approved' },
    ];
    const short = forecastDay({ date: DATE, bookings, shifts, leave, children: CHILDREN });

    // THE ASSERTION THIS MODULE EXISTS FOR. The roster still shows Bob; the forecast
    // knows he is on holiday.
    expect(short.onLeave).toEqual(['bob']);
    expect(short.shortfalls).toHaveLength(1);
    expect(short.shortfalls[0]?.assessment.shortfall).toBe(1);
    expect(short.shortfalls[0]?.staffMemberIds).toEqual(['alice']);
  });

  it('ignores leave that has only been requested, or was declined', () => {
    const bookings = ['over-a', 'over-b', 'over-c', 'over-d', 'over-e', 'over-f', 'over-g'].map(
      (id) => booking(id, '09:00', '15:00'),
    );
    const shifts = [shift('alice', '09:00', '15:00'), shift('bob', '09:00', '15:00')];

    for (const status of ['requested', 'declined'] as const) {
      const day = forecastDay({
        date: DATE,
        bookings,
        shifts,
        leave: [{ staffMemberId: 'bob', fromDate: DATE, toDate: DATE, status }],
        children: CHILDREN,
      });
      // Forecasting against an undecided request would show a shortfall a manager can
      // dismiss by declining it — a forecast arguing for its own conclusion.
      expect(day.onLeave).toEqual([]);
      expect(day.shortfalls).toHaveLength(0);
    }
  });

  it('ignores a cancelled shift, and bookings that are not booked', () => {
    const bookings = ['over-a', 'over-b', 'over-c', 'over-d', 'over-e', 'over-f', 'over-g'].map(
      (id) => booking(id, '09:00', '15:00'),
    );

    const cancelled = forecastDay({
      date: DATE,
      bookings,
      shifts: [
        shift('alice', '09:00', '15:00'),
        { ...shift('bob', '09:00', '15:00'), status: 'cancelled' },
      ],
      leave: [],
      children: CHILDREN,
    });
    expect(cancelled.shortfalls).toHaveLength(1);

    // One adult covers six; the seventh is what tips it, so withdrawing them clears it.
    const withdrawn = forecastDay({
      date: DATE,
      bookings: [...bookings.slice(0, 6), { ...booking('over-g', '09:00', '15:00'), status: 'cancelled' as const }],
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    expect(withdrawn.shortfalls).toHaveLength(0);
  });

  it('bands children by their age ON THE FORECAST DATE, not today', () => {
    // `turns-two` was born 2024-09-10 and is over 2 by 2026-09-15 — but under 2 on a
    // date before their second birthday. Five under-2s need one adult; six need two.
    const babies = ['baby', 'turns-two'];
    const bookings = babies.map((id) => booking(id, '09:00', '15:00'));

    const after = forecastDay({
      date: DATE,
      bookings,
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    expect(after.segments[0]?.assessment.underTwo).toBe(1);
    expect(after.segments[0]?.assessment.twoAndOver).toBe(1);

    const before = forecastDay({
      date: '2026-09-09',
      bookings,
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    expect(before.segments[0]?.assessment.underTwo).toBe(2);
    expect(before.segments[0]?.assessment.twoAndOver).toBe(0);
  });

  it('treats a handover as a handover — [from, to) on both sides', () => {
    // Alice until 12:00, Bob from 12:00. There is no uncovered instant, and neither is
    // there a moment with two adults.
    const day = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00', '15:00')],
      shifts: [shift('alice', '09:00', '12:00'), shift('bob', '12:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });

    expect(day.shortfalls).toHaveLength(0);
    for (const segment of day.segments) {
      expect(segment.assessment.adultsPresent).toBeLessThanOrEqual(1);
    }
  });

  it('counts bookings with no hours across the whole day, and says how many', () => {
    const day = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00', '15:00'), booking('baby', null, null)],
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });

    expect(day.bookingsWithoutTimes).toBe(1);
    // Counted, not dropped: an untimed booking silently ignored is a child the plan
    // does not know about.
    expect(day.segments[0]?.assessment.underTwo).toBe(1);
    expect(day.segments[0]?.assessment.present).toBe(2);
  });

  it('merges neighbouring segments that say the same thing, but not ones that only look alike', () => {
    // over-a leaves at 12:00 and over-b arrives at 12:00. Nothing net changes, and one
    // adult covers both sides — one segment.
    const same = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00', '12:00'), booking('over-b', '12:00', '15:00')],
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    expect(same.segments).toHaveLength(1);
    expect(same.segments[0]).toMatchObject({ from: '09:00', to: '15:00' });

    // Same counts across the swap, different people. Two segments, because a shortfall
    // that names the wrong person is worse than one that names nobody.
    const swapped = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00', '15:00')],
      shifts: [shift('alice', '09:00', '12:00'), shift('bob', '12:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    expect(swapped.segments).toHaveLength(2);
    expect(swapped.segments.map((s) => s.staffMemberIds)).toEqual([['alice'], ['bob']]);
  });

  it('reads Postgres time and form time as the same thing', () => {
    const pg = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00:00', '15:00:00')],
      shifts: [shift('alice', '09:00:00', '15:00:00')],
      leave: [],
      children: CHILDREN,
    });
    const form = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00', '15:00')],
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    expect(pg.segments).toEqual(form.segments);
  });

  it('inherits the unverified flag rather than asserting a rule it has not checked', () => {
    const day = forecastDay({
      date: DATE,
      bookings: [booking('over-a', '09:00', '15:00')],
      shifts: [shift('alice', '09:00', '15:00')],
      leave: [],
      children: CHILDREN,
    });
    // A forward-looking figure is the one a manager acts on by NOT calling a reliever,
    // so it is the last place to quietly claim verification.
    expect(day.verified).toBe(RATIO_TABLES_VERIFIED);
    expect(day.segments[0]?.assessment.verified).toBe(RATIO_TABLES_VERIFIED);
  });

  it('names every period rather than only the first', () => {
    const bookings = ['over-a', 'over-b', 'over-c', 'over-d', 'over-e', 'over-f', 'over-g'].map(
      (id) => booking(id, '08:00', '17:00'),
    );
    const day = forecastDay({
      date: DATE,
      bookings,
      shifts: [
        shift('alice', '08:00', '17:00'),
        shift('bob', '09:00', '12:00'),
        shift('bob', '14:00', '16:00'),
      ],
      leave: [],
      children: CHILDREN,
    });

    expect(day.shortfalls.map((s) => [s.from, s.to])).toEqual([
      ['08:00', '09:00'],
      ['12:00', '14:00'],
      ['16:00', '17:00'],
    ]);
    expect(summariseForecast(day)).toBe('Short 1 adult from 08:00, and in 2 other periods.');
  });
});
