import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHASE_WINDOW_DAYS,
  needsAttention,
  summariseVerification,
  type VerificationEvent,
  type VerificationPeriod,
} from '../attendanceVerification';

/** Monday to Sunday. The cadence 6-3 requires for all-day teacher-led services. */
const WEEK = { periodStart: '2026-08-03', periodEnd: '2026-08-09' };

/** `periodEnd` + 21. The day an unanswered week starts reading `overdue`. */
const DEADLINE = '2026-08-30';

const period = (over: Partial<VerificationPeriod> = {}): VerificationPeriod => ({
  childId: 'c1',
  ...WEEK,
  events: [],
  recordLastChangedAt: null,
  ...over,
});

const event = (over: Partial<VerificationEvent> = {}): VerificationEvent => ({
  outcome: 'approved',
  method: 'portal',
  verifiedAt: '2026-08-10T09:00:00+00:00',
  guardianId: 'g1',
  comment: null,
  ...over,
});

describe('while the period is still running', () => {
  it('is not-yet-due, including on the last day', () => {
    // A signature over a week that has not finished is a signature over a record that is
    // not finished. The last day is inclusive — Sunday is part of the week.
    expect(summariseVerification(period(), '2026-08-05').status).toBe('not-yet-due');
    expect(summariseVerification(period(), '2026-08-09').status).toBe('not-yet-due');
  });

  it('becomes answerable the day after it ends', () => {
    expect(summariseVerification(period(), '2026-08-10').status).toBe('awaiting');
  });
});

describe('nobody has responded', () => {
  it('is awaiting inside the chase window', () => {
    expect(summariseVerification(period(), '2026-08-10').status).toBe('awaiting');
    expect(summariseVerification(period(), '2026-08-29').status).toBe('awaiting');
  });

  it('is overdue from the deadline onwards, and names paper as the way out', () => {
    /*
      The boundary is `>=`, so the deadline day itself is overdue. Asserted on the exact
      day rather than a comfortable distance past it — an off-by-one here is a week that
      reads clean for one more day than it should, which is the direction nobody notices.
    */
    const at = summariseVerification(period(), DEADLINE);
    expect(at.status).toBe('overdue');
    expect(at.needsPaperFallback).toBe(true);

    expect(summariseVerification(period(), '2026-09-20').status).toBe('overdue');
  });

  it('honours a centre that chases on a different clock', () => {
    expect(summariseVerification(period(), '2026-08-13', { chaseWindowDays: 3 }).status)
      .toBe('overdue');
    // And the default is what the module says it is, rather than a number repeated here.
    expect(DEFAULT_CHASE_WINDOW_DAYS).toBe(21);
  });
});

describe('a dispute', () => {
  it('is in-review', () => {
    const p = period({ events: [event({ outcome: 'disputed', comment: 'Tuesday is wrong' })] });
    expect(summariseVerification(p, '2026-08-11').status).toBe('in-review');
  });

  it('does NOT age into overdue, however long it sits', () => {
    /*
      The judgement this function exists to make. `overdue` means the family never
      answered. They answered — they said the record is wrong, and the ball is with the
      centre. Ageing it into `overdue` would file the centre's own unfinished correction
      under the family's non-response, and would hide the one state that always needs
      somebody to do something.
    */
    const p = period({ events: [event({ outcome: 'disputed', comment: 'Tuesday is wrong' })] });
    expect(summariseVerification(p, '2026-12-25').status).toBe('in-review');
  });
});

describe('an approval', () => {
  it('is approved when nothing has moved underneath it', () => {
    const p = period({
      events: [event()],
      recordLastChangedAt: '2026-08-09T18:00:00+00:00',
    });
    expect(summariseVerification(p, '2026-08-11').status).toBe('approved');
  });

  it('is approved when the period holds no attendance at all', () => {
    // A week a child did not attend is still a week a signatory can confirm, and
    // `recordLastChangedAt` is legitimately null. Reading null as "changed" would make
    // every empty week permanently superseded.
    expect(summariseVerification(period({ events: [event()] }), '2026-08-11').status)
      .toBe('approved');
  });

  it('is superseded when attendance reached the server after the signature', () => {
    /*
      The comparison the append-only design exists to make cheap: a correction filed on
      Wednesday over a week approved on Monday means the signature is over figures that no
      longer stand. No other product in this market models this state, because a stored
      status cannot express it.
    */
    const p = period({
      events: [event({ verifiedAt: '2026-08-10T09:00:00+00:00' })],
      recordLastChangedAt: '2026-08-12T14:30:00+00:00',
    });
    expect(summariseVerification(p, '2026-08-13').status).toBe('superseded');
  });

  it('is NOT superseded by an attendance event that arrived at the same instant', () => {
    // Strictly after. An event whose `created_at` equals `verified_at` was already visible
    // when the signature was given, so treating it as a later change would supersede an
    // approval on the strength of the record it approved.
    const same = '2026-08-10T09:00:00+00:00';
    const p = period({ events: [event({ verifiedAt: same })], recordLastChangedAt: same });
    expect(summariseVerification(p, '2026-08-13').status).toBe('approved');
  });

  it('does NOT age into overdue once superseded', () => {
    // Same reasoning as the dispute. The family answered; the record changed afterwards.
    // That is the centre's event, not theirs.
    const p = period({
      events: [event({ verifiedAt: '2026-08-10T09:00:00+00:00' })],
      recordLastChangedAt: '2026-08-12T14:30:00+00:00',
    });
    expect(summariseVerification(p, '2026-12-25').status).toBe('superseded');
  });
});

describe('the newest event wins', () => {
  it('resolves a dispute that was later approved', () => {
    const p = period({
      events: [
        event({ outcome: 'disputed', verifiedAt: '2026-08-10T09:00:00+00:00', comment: 'wrong' }),
        event({ outcome: 'approved', verifiedAt: '2026-08-13T11:00:00+00:00' }),
      ],
    });
    expect(summariseVerification(p, '2026-08-14').status).toBe('approved');
  });

  it('and does so regardless of the order the rows arrive in', () => {
    /*
      A PostgREST read is one forgotten `.order()` from arriving backwards. If this
      function trusted array order, that omission would decide whether a family had
      approved their child's funded hours — and it would look right in every test that
      happened to seed the rows chronologically.
    */
    const rows = [
      event({ outcome: 'approved', verifiedAt: '2026-08-13T11:00:00+00:00' }),
      event({ outcome: 'disputed', verifiedAt: '2026-08-10T09:00:00+00:00', comment: 'wrong' }),
    ];
    expect(summariseVerification(period({ events: rows }), '2026-08-14').status).toBe('approved');
    expect(summariseVerification(period({ events: [...rows].reverse() }), '2026-08-14').status)
      .toBe('approved');
  });

  it('compares instants, not strings, across a New Zealand offset', () => {
    /*
      These two cases are chosen so a string comparison gives the OPPOSITE answer, which is
      the only kind of case that tests anything here. An earlier version of this test used
      timestamps whose date parts differed — the date dominates the string comparison, so
      it passed with or without the fix and proved nothing. Mutation-testing caught it.

      The dispute reads 13:00+12:00, which is 01:00Z — one hour BEFORE the approval at
      02:00Z. As strings, `13` sorts above `02` and the dispute looks newer. Postgres
      renders `timestamptz` with an offset and a session on Pacific/Auckland renders +12,
      so this is the realistic shape rather than a contrived one.
    */
    const p = period({
      events: [
        event({ outcome: 'approved', verifiedAt: '2026-08-13T02:00:00Z' }),
        event({ outcome: 'disputed', verifiedAt: '2026-08-13T13:00:00+12:00', comment: 'wrong' }),
      ],
    });
    expect(summariseVerification(p, '2026-08-14').status).toBe('approved');
  });

  it('detects staleness across the same offset mismatch', () => {
    /*
      Signature at 20:00+12:00 on the 12th = 08:00Z. The correction lands at 09:00Z, an
      hour later, so the approval is stale. As strings, `09` sorts below `20` and the
      correction looks earlier — the approval would stand.
    */
    const p = period({
      events: [event({ verifiedAt: '2026-08-12T20:00:00+12:00' })],
      recordLastChangedAt: '2026-08-12T09:00:00Z',
    });
    expect(summariseVerification(p, '2026-08-13').status).toBe('superseded');
  });

  it('treats the same instant in two formats as the same instant', () => {
    // `Z` sorts above `+`, so a string comparison would call these different and supersede
    // an approval on the strength of the very record it approved.
    const p = period({
      events: [event({ verifiedAt: '2026-08-10T09:00:00+00:00' })],
      recordLastChangedAt: '2026-08-10T09:00:00Z',
    });
    expect(summariseVerification(p, '2026-08-13').status).toBe('approved');
  });
});

describe('needsAttention', () => {
  it('keeps only what somebody must act on, worst first', () => {
    const summaries = [
      summariseVerification(period({ childId: 'ok', events: [event()] }), '2026-08-11'),
      summariseVerification(period({ childId: 'late' }), DEADLINE),
      summariseVerification(
        period({
          childId: 'stale',
          events: [event({ verifiedAt: '2026-08-10T09:00:00+00:00' })],
          recordLastChangedAt: '2026-08-12T14:30:00+00:00',
        }),
        '2026-08-13',
      ),
      summariseVerification(
        period({ childId: 'dispute', events: [event({ outcome: 'disputed', comment: 'x' })] }),
        '2026-08-11',
      ),
    ];

    // `superseded` leads: it is the only state where the product holds a signature it knows
    // to be out of date, and the family cannot see that it has gone stale.
    expect(needsAttention(summaries).map((s) => s.childId)).toEqual(['stale', 'late', 'dispute']);
  });

  it('is empty when every period is settled or still running', () => {
    const summaries = [
      summariseVerification(period({ events: [event()] }), '2026-08-11'),
      summariseVerification(period(), '2026-08-05'),
      summariseVerification(period(), '2026-08-11'),
    ];
    expect(needsAttention(summaries)).toEqual([]);
  });
});
