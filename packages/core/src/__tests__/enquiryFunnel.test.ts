import { describe, expect, it } from 'vitest';
import { summariseEnquiryFunnel, type EnquiryStatus } from '../enquiryFunnel';

const enquiry = (status: EnquiryStatus) => ({ status });

describe('summariseEnquiryFunnel', () => {
  it('splits open from resolved and counts each status', () => {
    const f = summariseEnquiryFunnel([
      enquiry('new'),
      enquiry('new'),
      enquiry('contacted'),
      enquiry('waitlisted'),
      enquiry('enrolled'),
      enquiry('enrolled'),
      enquiry('declined'),
      enquiry('withdrawn'),
    ]);

    expect(f.total).toBe(8);
    expect(f.open).toEqual({ new: 2, contacted: 1, waitlisted: 1 });
    expect(f.resolved).toEqual({ enrolled: 2, declined: 1, withdrawn: 1 });
    expect(f.resolvedTotal).toBe(4);
  });

  it('the conversion rate is enrolled over resolved, not enrolled over total', () => {
    /*
      The assertion this function exists for. Six enquiries are still `new` — nobody has
      failed yet, they simply have not been actioned. Dividing by `total` (10) would give
      20% and read as "this centre is bad at converting enquiries" when the true state is
      "two of the four decisions made so far were yeses".
    */
    const f = summariseEnquiryFunnel([
      ...Array(6).fill(enquiry('new')),
      enquiry('enrolled'),
      enquiry('enrolled'),
      enquiry('declined'),
      enquiry('withdrawn'),
    ]);
    expect(f.conversionRate).toBe(50);
  });

  it('reports null rather than 0% when nothing has been resolved yet', () => {
    // Same shape as `averageChildren` in occupancy.ts: 0% reads as "every enquiry is
    // failing", and the true state is "no outcome has happened yet".
    const f = summariseEnquiryFunnel([enquiry('new'), enquiry('contacted')]);
    expect(f.conversionRate).toBeNull();
    expect(f.resolvedTotal).toBe(0);
  });

  it('rounds to one decimal place', () => {
    const f = summariseEnquiryFunnel([
      enquiry('enrolled'),
      enquiry('declined'),
      enquiry('declined'),
    ]);
    // 1 / 3 = 33.333...%
    expect(f.conversionRate).toBe(33.3);
  });

  it('handles an empty list without dividing by zero', () => {
    const f = summariseEnquiryFunnel([]);
    expect(f).toEqual({
      total: 0,
      open: { new: 0, contacted: 0, waitlisted: 0 },
      resolved: { enrolled: 0, declined: 0, withdrawn: 0 },
      resolvedTotal: 0,
      conversionRate: null,
    });
  });
});
