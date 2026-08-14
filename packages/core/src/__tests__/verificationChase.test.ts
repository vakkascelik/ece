import { describe, expect, it } from 'vitest';
import {
  MAX_NOTICES_PER_PERIOD,
  planVerificationChase,
  type ChaseCandidate,
} from '../verificationChase';

/** A Friday. The week of Aug 3–9 completed five days ago. */
const TODAY = '2026-08-14';

const candidate = (over: Partial<ChaseCandidate> = {}): ChaseCandidate => ({
  childId: 'c1',
  guardianId: 'g1',
  userId: 'u1',
  periodStart: '2026-08-03',
  periodEnd: '2026-08-09',
  status: 'awaiting',
  noticesSent: 0,
  lastSentOn: null,
  ...over,
});

describe('what is chased', () => {
  it('releases an awaiting week that has never been asked', () => {
    const plan = planVerificationChase([candidate()], TODAY);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.noticeNumber).toBe(1);
  });

  it('chases only awaiting — every other state is somebody else\'s move', () => {
    /*
      approved needs nothing; in-review and superseded are the centre's (needsAttention
      lists them); overdue means three weeks passed and the remedy is the paper form,
      not a fourth notification to a family that ignored three.
    */
    for (const status of ['approved', 'in-review', 'superseded', 'overdue', 'not-yet-due'] as const) {
      expect(planVerificationChase([candidate({ status })], TODAY)).toHaveLength(0);
    }
  });
});

describe('the weekly rhythm', () => {
  it('does not ask twice in one calendar week', () => {
    // Sent Monday the 10th; today is Friday the 14th — same Mon–Sun week.
    const c = candidate({ noticesSent: 1, lastSentOn: '2026-08-10' });
    expect(planVerificationChase([c], TODAY)).toHaveLength(0);
  });

  it('asks again the following week, as notice 2', () => {
    // Sent Friday the 7th; today Friday the 14th is the next calendar week.
    const c = candidate({ noticesSent: 1, lastSentOn: '2026-08-07' });
    const plan = planVerificationChase([c], TODAY);
    expect(plan).toHaveLength(1);
    expect(plan[0]!.noticeNumber).toBe(2);
  });

  it('buckets by calendar week, not by seven elapsed days', () => {
    /*
      Sent Sunday the 9th; today is Friday the 14th — only five days later, but a NEW
      Mon–Sun week. A seven-day rule would slide every notice later each time a run was
      delayed; the calendar bucket keeps the rhythm weekly whatever day the job ran.
    */
    const c = candidate({ noticesSent: 1, lastSentOn: '2026-08-09' });
    expect(planVerificationChase([c], TODAY)).toHaveLength(1);
  });

  it('stops for good after the third notice', () => {
    const c = candidate({ noticesSent: MAX_NOTICES_PER_PERIOD, lastSentOn: '2026-07-31' });
    expect(planVerificationChase([c], TODAY)).toHaveLength(0);
  });
});

describe('the plan is per signatory', () => {
  it('two signatories of one child are asked independently', () => {
    const plan = planVerificationChase(
      [
        candidate({ guardianId: 'g1', userId: 'u1', noticesSent: 1, lastSentOn: '2026-08-07' }),
        candidate({ guardianId: 'g2', userId: 'u2' }),
      ],
      TODAY,
    );
    expect(plan).toHaveLength(2);
    expect(plan.map((p) => p.noticeNumber).sort()).toEqual([1, 2]);
  });
});
