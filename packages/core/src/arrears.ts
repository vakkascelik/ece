/**
 * Who owes what, and for how long.
 *
 * WHY THE AGEING IS HERE AND THE MONEY IS IN SQL
 *
 * The same split `ratios.ts` makes. Summing lines and subtracting payments is a join
 * and belongs in a view; deciding that 31 days is a different kind of overdue from 30
 * is arithmetic on a calendar, which is where every date bug in this repo has come
 * from. So the view returns two integers and a date, and everything judgemental
 * happens here, in a pure function, against a date the caller supplies.
 *
 * THE BUCKETS ARE A CONVENTION, NOT A CITATION
 *
 * 30/60/90 days is ordinary accounting practice and nothing here depends on it being
 * right — no rule is asserted, no consequence is claimed, and a centre chasing a debt
 * makes its own decisions. That is the difference between this and the ratio bands,
 * and it is why there is no `ARREARS_VERIFIED` flag: there is nothing to verify.
 *
 * WHAT IT REFUSES TO GUESS
 *
 * An invoice with no due date cannot be aged, and gets `no-due-date` rather than being
 * folded into "current". A centre that has never set due dates would otherwise read a
 * clean arrears report and conclude nobody is late, which is the same failure shape as
 * a sleep-check interval nobody stated.
 */

export interface OutstandingInvoice {
  invoiceId: string;
  guardianId: string;
  reference: string;
  /** Null is a real state: an issued invoice nobody put a date on. */
  dueOn: string | null;
  totalCents: number;
  paidCents: number;
}

/**
 * `no-due-date` is not a bucket so much as an admission. It is listed first in
 * `BUCKETS` so it appears at the top of a report rather than after the 90-day column,
 * because it is the one a manager has to act on by fixing the data.
 */
export type ArrearsBucket = 'no-due-date' | 'not-due' | '1-30' | '31-60' | '61-90' | '90+';

export const BUCKETS: readonly ArrearsBucket[] = [
  'no-due-date',
  'not-due',
  '1-30',
  '31-60',
  '61-90',
  '90+',
];

export interface AgedInvoice extends OutstandingInvoice {
  /** Positive when money is owed. Never negative — see `creditCents`. */
  outstandingCents: number;
  /** Positive when the family has paid more than the invoice. */
  creditCents: number;
  /** Null when the invoice has no due date, or is not yet due. */
  daysOverdue: number | null;
  bucket: ArrearsBucket;
}

/**
 * Whole days between two ISO dates, by UTC components.
 *
 * Both arguments are already calendar dates in the centre's zone — resolved upstream by
 * `todayInZone` and by a `date` column — so this must not introduce a timezone of its
 * own. `Date.UTC` on the parts is the same trick `shiftLocalDate` uses: the offset is
 * identical on both sides and cancels, so the subtraction is exact and no hour-long
 * daylight-saving shift can round a day the wrong way.
 */
function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy as number, (fm as number) - 1, fd as number);
  const b = Date.UTC(ty as number, (tm as number) - 1, td as number);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Age one invoice as at a given date.
 *
 * `on` is required. A default of "today" would read the server's clock, which is UTC and
 * therefore yesterday for the whole New Zealand morning — the trap this repo has fallen
 * into five times. Callers pass `todayInZone(centre.timezone)`.
 */
export function ageInvoice(invoice: OutstandingInvoice, on: string): AgedInvoice {
  const balance = invoice.totalCents - invoice.paidCents;
  const outstandingCents = Math.max(0, balance);
  const creditCents = Math.max(0, -balance);

  // Nothing owed is nothing to chase, whatever the date says. A paid invoice three
  // months past its due date is not in arrears, and listing it as such is how a report
  // stops being read.
  if (outstandingCents === 0) {
    return { ...invoice, outstandingCents, creditCents, daysOverdue: null, bucket: 'not-due' };
  }

  if (invoice.dueOn === null) {
    return { ...invoice, outstandingCents, creditCents, daysOverdue: null, bucket: 'no-due-date' };
  }

  const days = daysBetween(invoice.dueOn, on);
  if (days <= 0) {
    return { ...invoice, outstandingCents, creditCents, daysOverdue: null, bucket: 'not-due' };
  }

  return {
    ...invoice,
    outstandingCents,
    creditCents,
    daysOverdue: days,
    bucket: days <= 30 ? '1-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+',
  };
}

export interface ArrearsSummary {
  /** Total owed across every bucket that represents money late. */
  overdueCents: number;
  /** Owed but not yet due. Not arrears — stated separately so it is not added in. */
  notDueCents: number;
  /** Owed on invoices that cannot be aged at all. */
  noDueDateCents: number;
  /** Money families have overpaid. Never netted against what is owed. */
  creditCents: number;
  byBucket: Record<ArrearsBucket, number>;
  /** Invoices with something outstanding, worst first. */
  invoices: AgedInvoice[];
}

/**
 * A centre's position, as at a date.
 *
 * **Credits are never netted against arrears.** One family being $200 in credit does not
 * make another family's $200 debt disappear, and a single "net owing" figure would say
 * exactly that. They are different conversations with different people, so they are
 * different numbers.
 */
export function summariseArrears(invoices: OutstandingInvoice[], on: string): ArrearsSummary {
  const aged = invoices.map((i) => ageInvoice(i, on));

  const byBucket = Object.fromEntries(BUCKETS.map((b) => [b, 0])) as Record<
    ArrearsBucket,
    number
  >;
  let creditCents = 0;
  for (const invoice of aged) {
    byBucket[invoice.bucket] += invoice.outstandingCents;
    creditCents += invoice.creditCents;
  }

  return {
    // `not-due` and `no-due-date` are deliberately excluded. Reporting money that is not
    // late as arrears overstates the problem, and a figure a manager knows is wrong is a
    // figure they stop reading.
    overdueCents: byBucket['1-30'] + byBucket['31-60'] + byBucket['61-90'] + byBucket['90+'],
    notDueCents: byBucket['not-due'],
    noDueDateCents: byBucket['no-due-date'],
    creditCents,
    byBucket,
    invoices: aged
      .filter((i) => i.outstandingCents > 0)
      .sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1) || b.outstandingCents - a.outstandingCents),
  };
}

/**
 * Cents to a New Zealand dollar string.
 *
 * The first money this product has ever rendered — `packages/api` has had invoices
 * since Phase 5 and no screen has imported them, so no cents value has reached a
 * display until now.
 *
 * **It neither rounds nor floors.** `toHours` in `hours.ts` floors deliberately,
 * because the direction of a rounding error in a Crown claim should never favour the
 * claimant. Cents are exact and there is nothing to round: an invoice is a sum of
 * integers, and a formatter that adjusted one would be disagreeing with the invoice the
 * family is holding.
 *
 * Negative is rendered with a leading minus rather than parentheses. Accounting
 * brackets are a convention for people who read ledgers; this is read by a manager and
 * sometimes by a parent, and `-$45.00` is unambiguous to both.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-NZ')}.${String(abs % 100).padStart(2, '0')}`;
}
