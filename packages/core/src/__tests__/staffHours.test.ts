import { describe, expect, it } from 'vitest';
import type { HoursEvent } from '../hours';
import { countedStaffHours, type OffFloorInterval } from '../staffHours';

/**
 * §9-4 — staff hours "at times when they were counted towards regulated (ratio) staff".
 *
 * The arithmetic is a subtraction and the interesting part is everything around it: which
 * hours are subtracted, which are not, and what happens to the ones nobody can classify.
 */

const NZ = 'Pacific/Auckland';

let seq = 0;
const ev = (kind: 'in' | 'out', when: string): HoursEvent => ({
  id: ++seq,
  kind,
  at: when,
  corrects: null,
});

/** 08:00–16:00 on an August day: eight hours, NZST (+12:00). */
const fullDay = (date: string) => [
  ev('in', `${date}T08:00:00+12:00`),
  ev('out', `${date}T16:00:00+12:00`),
];

const lunch = (over: Partial<OffFloorInterval> = {}): OffFloorInterval => ({
  staffMemberId: 'kaiako',
  onDate: '2026-08-03',
  fromTime: '12:00',
  toTime: '13:00',
  ...over,
});

describe('countedStaffHours — the subtraction', () => {
  it('takes an hour off the floor out of an eight-hour day', () => {
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'kaiako', events: fullDay('2026-08-03'), qualified: true }],
      offFloor: [lunch()],
      timeZone: NZ,
    });

    expect(r.people[0]).toMatchObject({
      date: '2026-08-03',
      presentMinutes: 480,
      offFloorMinutes: 60,
      countedMinutes: 420,
      complete: true,
    });
    expect(r.totals[0]?.qualifiedMinutes).toBe(420);
  });

  it('subtracts only the part that overlapped a session', () => {
    /*
      An interval from 15:00 to 18:00 against a day ending at 16:00. One hour overlaps; the
      other two are outside the person's attendance and remove nothing.

      0094 deliberately does not constrain an off-floor row to fall inside attendance — that is
      a cross-table check — so the intersection is what makes it safe.
    */
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'kaiako', events: fullDay('2026-08-03'), qualified: true }],
      offFloor: [lunch({ fromTime: '15:00', toTime: '18:00' })],
      timeZone: NZ,
    });
    expect(r.people[0]?.offFloorMinutes).toBe(60);
    expect(r.people[0]?.countedMinutes).toBe(420);
  });

  it('ignores an interval recorded for a day the person did not work', () => {
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'kaiako', events: fullDay('2026-08-03'), qualified: true }],
      offFloor: [lunch({ onDate: '2026-08-04' })],
      timeZone: NZ,
    });
    expect(r.people[0]?.offFloorMinutes).toBe(0);
    expect(r.people[0]?.countedMinutes).toBe(480);
  });

  it('ignores an interval belonging to somebody else', () => {
    // The off-floor rows arrive for a whole centre, so keying on the person is not decoration.
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'kaiako', events: fullDay('2026-08-03'), qualified: true }],
      offFloor: [lunch({ staffMemberId: 'somebody-else' })],
      timeZone: NZ,
    });
    expect(r.people[0]?.countedMinutes).toBe(480);
  });

  it('never returns a negative figure, even given overlapping intervals', () => {
    /*
      A single interval cannot drive this negative — its overlap is bounded by the session, so
      the clamp is unreachable and the mutation drill said so. Two OVERLAPPING intervals can:
      each contributes its own overlap and the sum exceeds the day.

      0094's exclusion constraint refuses overlapping rows, so this cannot arrive from the
      database — but `countedStaffHours` is a pure function that will one day be handed data
      from somewhere else, and a negative staff-hour figure on a Crown return is not a thing to
      leave to a constraint two layers away.
    */
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'kaiako', events: fullDay('2026-08-03'), qualified: true }],
      offFloor: [
        lunch({ fromTime: '08:00', toTime: '16:00' }),
        lunch({ fromTime: '09:00', toTime: '15:00' }),
      ],
      timeZone: NZ,
    });
    expect(r.people[0]?.offFloorMinutes).toBe(840); // 480 + 360, more than the day
    expect(r.people[0]?.countedMinutes).toBe(0);
  });
});

describe('countedStaffHours — the three qualification states', () => {
  const day = fullDay('2026-08-03');

  it('splits qualified from not qualified', () => {
    const r = countedStaffHours({
      staff: [
        { staffMemberId: 'registered', events: day, qualified: true },
        { staffMemberId: 'unregistered', events: fullDay('2026-08-03'), qualified: false },
      ],
      offFloor: [],
      timeZone: NZ,
    });
    expect(r.totals[0]).toMatchObject({
      qualifiedMinutes: 480,
      notQualifiedMinutes: 480,
      unknownMinutes: 0,
    });
    expect(r.gaps).toEqual([]);
  });

  it('puts an unclassifiable person in NEITHER bucket, and says so', () => {
    /*
      THE ASSERTION THIS THREE-STATE EXISTS FOR. `null` means no practising certificate is on
      file at all — a paperwork fact. Folding it into `notQualifiedMinutes` would turn it into
      a claim about the person's teaching qualification, on a return to the Crown.
    */
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'nobody-linked', events: day, qualified: null }],
      offFloor: [],
      timeZone: NZ,
    });
    expect(r.totals[0]).toMatchObject({
      qualifiedMinutes: 0,
      notQualifiedMinutes: 0,
      unknownMinutes: 480,
    });
    expect(r.gaps.join(' ')).toContain('no practising certificate on file');
  });
});

describe('countedStaffHours — what it will not put in a figure', () => {
  it('holds back a day whose attendance record is broken, INCLUDING the hours it does know', () => {
    /*
      Morning signed in and out, afternoon signed in and never out. `pairDay` completes the
      morning session — four hours it genuinely knows — and still calls the day incomplete,
      because nobody knows when the person left.

      Those four hours must NOT be split by qualification. The fixture needs a completed session
      on an incomplete day for that to be visible at all: with only a dangling sign-in the day's
      minutes are zero, and adding zero to the qualified figure looks identical to not adding it.
      The mutation drill found exactly that.
    */
    const r = countedStaffHours({
      staff: [
        {
          staffMemberId: 'kaiako',
          events: [
            ev('in', '2026-08-03T08:00:00+12:00'),
            ev('out', '2026-08-03T12:00:00+12:00'),
            ev('in', '2026-08-03T13:00:00+12:00'),
          ],
          qualified: true,
        },
      ],
      offFloor: [],
      timeZone: NZ,
    });
    expect(r.people[0]?.complete).toBe(false);
    expect(r.people[0]?.countedMinutes).toBe(240);
    expect(r.totals[0]?.qualifiedMinutes).toBe(0);
    expect(r.totals[0]?.unresolvedMinutes).toBe(240);
    expect(r.gaps.join(' ')).toContain('incomplete');
  });

  it('reports a day that is ONLY a dangling sign-in, whose minutes are zero', () => {
    /*
      THE REGRESSION, and it needs its own fixture. With nothing but a sign-in, `pairDay`
      completes no session and the day's minutes are **zero** — so a gap keyed on
      `unresolvedMinutes > 0` never fires and the broken record is invisible. That was the first
      draft, and the test above cannot see it because its fixture has a completed session.

      Two fixtures, two properties: this one asserts the gap FIRES, the one above asserts the
      hours are HELD BACK.
    */
    const r = countedStaffHours({
      staff: [
        {
          staffMemberId: 'kaiako',
          events: [ev('in', '2026-08-03T08:00:00+12:00')],
          qualified: true,
        },
      ],
      offFloor: [],
      timeZone: NZ,
    });
    expect(r.people[0]?.complete).toBe(false);
    expect(r.people[0]?.countedMinutes).toBe(0);
    expect(r.totals[0]?.unresolvedMinutes).toBe(0);
    expect(r.gaps.join(' ')).toContain('incomplete');
  });

  it('names an interval it could not read rather than dropping it silently', () => {
    const r = countedStaffHours({
      staff: [{ staffMemberId: 'kaiako', events: fullDay('2026-08-03'), qualified: true }],
      offFloor: [lunch({ fromTime: 'lunchtime', toTime: 'afternoon' })],
      timeZone: NZ,
    });
    expect(r.people[0]?.countedMinutes).toBe(480);
    expect(r.gaps.join(' ')).toContain('could not be read');
  });

  it('says nothing at all when nobody worked', () => {
    const r = countedStaffHours({ staff: [], offFloor: [], timeZone: NZ });
    expect(r.people).toEqual([]);
    expect(r.totals).toEqual([]);
    expect(r.gaps).toEqual([]);
  });
});
