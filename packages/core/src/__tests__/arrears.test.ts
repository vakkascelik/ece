import { describe, expect, it } from 'vitest';
import { ageInvoice, summariseArrears, BUCKETS, type OutstandingInvoice } from '../arrears';

const ON = '2026-08-09';

const inv = (over: Partial<OutstandingInvoice> = {}): OutstandingInvoice => ({
  invoiceId: 'i1',
  guardianId: 'g1',
  reference: 'INV-001',
  dueOn: '2026-08-01',
  totalCents: 10_000,
  paidCents: 0,
  ...over,
});

describe('ageInvoice', () => {
  it('buckets by whole days past the due date', () => {
    // 8 days late.
    expect(ageInvoice(inv(), ON).bucket).toBe('1-30');
    expect(ageInvoice(inv(), ON).daysOverdue).toBe(8);

    expect(ageInvoice(inv({ dueOn: '2026-07-09' }), ON).bucket).toBe('31-60'); // 31
    expect(ageInvoice(inv({ dueOn: '2026-06-09' }), ON).bucket).toBe('61-90'); // 61
    expect(ageInvoice(inv({ dueOn: '2026-05-01' }), ON).bucket).toBe('90+'); // 100
  });

  it('puts the boundaries where the labels say they are', () => {
    /*
      The off-by-one that makes a report disagree with its own column headings, and the
      one this test caught — in the test rather than the code. `1-30` means one to
      thirty days INCLUSIVE, so exactly thirty days late is the last day of the first
      column, not the first day of the second.
    */
    expect(ageInvoice(inv({ dueOn: '2026-07-10' }), ON).daysOverdue).toBe(30);
    expect(ageInvoice(inv({ dueOn: '2026-07-10' }), ON).bucket).toBe('1-30');
    expect(ageInvoice(inv({ dueOn: '2026-07-09' }), ON).daysOverdue).toBe(31);
    expect(ageInvoice(inv({ dueOn: '2026-07-09' }), ON).bucket).toBe('31-60');
  });

  it('does not treat the due date itself as late', () => {
    expect(ageInvoice(inv({ dueOn: ON }), ON).bucket).toBe('not-due');
    expect(ageInvoice(inv({ dueOn: ON }), ON).daysOverdue).toBeNull();
    expect(ageInvoice(inv({ dueOn: '2026-09-01' }), ON).bucket).toBe('not-due');
  });

  it('refuses to age an invoice with no due date rather than calling it current', () => {
    // A centre that never sets due dates would otherwise read a clean report and
    // conclude nobody is late — the same failure shape as an unstated sleep-check
    // interval.
    const aged = ageInvoice(inv({ dueOn: null }), ON);
    expect(aged.bucket).toBe('no-due-date');
    expect(aged.daysOverdue).toBeNull();
    expect(aged.outstandingCents).toBe(10_000);
  });

  it('is not in arrears once it is paid, however late it is', () => {
    const aged = ageInvoice(inv({ dueOn: '2026-01-01', paidCents: 10_000 }), ON);
    expect(aged.outstandingCents).toBe(0);
    expect(aged.bucket).toBe('not-due');
    expect(aged.daysOverdue).toBeNull();
  });

  it('reports an overpayment as credit and never as negative arrears', () => {
    const aged = ageInvoice(inv({ paidCents: 12_500 }), ON);
    expect(aged.outstandingCents).toBe(0);
    expect(aged.creditCents).toBe(2_500);
  });

  it('counts part payment as still owing', () => {
    const aged = ageInvoice(inv({ paidCents: 4_000 }), ON);
    expect(aged.outstandingCents).toBe(6_000);
    expect(aged.bucket).toBe('1-30');
  });

  it('crosses a daylight-saving boundary without losing or gaining a day', () => {
    // NZDT ends on 2026-04-05. Both dates are already calendar days in the centre's
    // zone, so the arithmetic must be pure component subtraction — an implementation
    // that built Date objects in local time would round one of these to 27 or 29.
    expect(ageInvoice(inv({ dueOn: '2026-03-25' }), '2026-04-22').daysOverdue).toBe(28);
    expect(ageInvoice(inv({ dueOn: '2026-09-20' }), '2026-10-18').daysOverdue).toBe(28);
  });
});

describe('summariseArrears', () => {
  const many: OutstandingInvoice[] = [
    inv({ invoiceId: 'a', dueOn: '2026-08-01', totalCents: 10_000 }), // 8 days → 1-30
    inv({ invoiceId: 'b', dueOn: '2026-05-01', totalCents: 20_000 }), // 100 days → 90+
    inv({ invoiceId: 'c', dueOn: '2026-09-01', totalCents: 5_000 }), // not due
    inv({ invoiceId: 'd', dueOn: null, totalCents: 7_000 }), // cannot be aged
    inv({ invoiceId: 'e', dueOn: '2026-01-01', totalCents: 3_000, paidCents: 3_000 }), // settled
    inv({ invoiceId: 'f', dueOn: '2026-08-01', totalCents: 1_000, paidCents: 4_000 }), // credit
  ];

  it('adds up only what is actually late', () => {
    const s = summariseArrears(many, ON);
    expect(s.overdueCents).toBe(30_000);
    expect(s.notDueCents).toBe(5_000);
    expect(s.noDueDateCents).toBe(7_000);
  });

  it('never nets a credit against somebody else s debt', () => {
    const s = summariseArrears(many, ON);
    // One family $30 in credit does not reduce another family's $300 debt, and a single
    // "net owing" figure would say exactly that.
    expect(s.creditCents).toBe(3_000);
    expect(s.overdueCents).toBe(30_000);
  });

  it('lists everything still owing, worst first, and omits what is settled', () => {
    const s = summariseArrears(many, ON);
    /*
      Not-yet-due invoices are IN the list and out of the overdue total. It is a
      receivables list, and the buckets are what distinguish late from merely owing —
      a manager ringing families needs to see the invoice that falls due on Monday.
      `d` (no due date, $70) sorts above `c` (not due, $50): neither has a day count,
      so the larger amount goes first.
    */
    expect(s.invoices.map((i) => i.invoiceId)).toEqual(['b', 'a', 'd', 'c']);
    // Settled and in-credit invoices are not receivables at all.
    expect(s.invoices.map((i) => i.invoiceId)).not.toContain('e');
    expect(s.invoices.map((i) => i.invoiceId)).not.toContain('f');
  });

  it('reports every bucket, including the empty ones', () => {
    // A report that omits a zero column reflows its own headings between two runs.
    const s = summariseArrears(many, ON);
    expect(Object.keys(s.byBucket).sort()).toEqual([...BUCKETS].sort());
    expect(s.byBucket['31-60']).toBe(0);
  });

  it('is empty rather than wrong when there is nothing to report', () => {
    const s = summariseArrears([], ON);
    expect(s.overdueCents).toBe(0);
    expect(s.invoices).toEqual([]);
    expect(s.byBucket['90+']).toBe(0);
  });
});
