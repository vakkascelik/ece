/**
 * Bookings, invoices, and the RS7 preparation figures.
 *
 * TWO SOURCES, PULLING OPPOSITE WAYS
 *
 * An **invoice** is computed from bookings: a family is charged for the days they held, because a
 * centre cannot resell a Tuesday somebody did not turn up for.
 *
 * A **funding claim** is computed from attendance: the Crown pays for hours actually delivered, and
 * a claim built on what was planned rather than recorded would be a claim for hours nobody observed.
 *
 * Those two facts are the whole reason bookings and attendance are separate tables, and why nothing
 * in this file lets one stand in for the other.
 */

import {
  childFunding,
  summariseFunding,
  todayInZone,
  type FundingPeriod,
  type FundingSummary,
  type HoursEvent,
  type FundingReceipt,
  type OutstandingInvoice,
} from '@ece/core';
import type { Db } from './index';
import { fetchAll } from './paging';

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export type BookingStatus = 'booked' | 'absent' | 'cancelled' | 'closed';

export interface Booking {
  id: string;
  centreId: string;
  childId: string;
  onDate: string;
  status: BookingStatus;
  fromTime: string | null;
  toTime: string | null;
  note: string | null;
  /** Why the family said the child is away (0063). Null unless status is `absent`. */
  absenceReason: string | null;
}

const BOOKING_COLUMNS =
  'id, centre_id, child_id, on_date, status, from_time, to_time, note, absence_reason';

interface BookingRow {
  id: string;
  centre_id: string;
  child_id: string;
  on_date: string;
  status: BookingStatus;
  from_time: string | null;
  to_time: string | null;
  note: string | null;
  absence_reason: string | null;
}

const toBooking = (r: BookingRow): Booking => ({
  id: r.id,
  centreId: r.centre_id,
  childId: r.child_id,
  onDate: r.on_date,
  status: r.status,
  fromTime: r.from_time,
  toTime: r.to_time,
  note: r.note,
  absenceReason: r.absence_reason,
});

export async function listBookings(
  db: Db,
  input: { centreId: string; from: string; to: string },
): Promise<Booking[]> {
  // Paged: a month of bookings for a centre licensed for 65 children is about 1,300 rows,
  // and the cap is 1,000. `id` joins the ordering because two bookings share a date by
  // definition — without it, paging over a non-unique order can repeat one row and skip
  // another, which on an invoice means charging for a day twice and not at all for another.
  const rows = await fetchAll<BookingRow>('listBookings', (from, to) =>
    db
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .eq('centre_id', input.centreId)
      .gte('on_date', input.from)
      .lte('on_date', input.to)
      .order('on_date')
      .order('id')
      .range(from, to),
  );
  return rows.map(toBooking);
}

/**
 * Set a booking for one child on one day.
 *
 * Upsert on `(child_id, on_date)`, because the unique constraint is what stops a roll — and later an
 * invoice — counting a day twice. Changing a booking is the same action as making one.
 */
export async function setBooking(
  db: Db,
  input: {
    centreId: string;
    childId: string;
    onDate: string;
    status: BookingStatus;
    fromTime?: string | null;
    toTime?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('bookings').upsert(
    {
      centre_id: input.centreId,
      child_id: input.childId,
      on_date: input.onDate,
      status: input.status,
      from_time: input.fromTime ?? null,
      to_time: input.toTime ?? null,
      note: input.note?.trim() || null,
      created_by: auth.user?.id ?? null,
    },
    { onConflict: 'child_id,on_date' },
  );
  if (error) throw new Error(`setBooking: ${error.message}`);
}

/**
 * One child's booked days in a window.
 *
 * Separate from `listBookings`, which reads a whole centre. A family screen showing one
 * child has no business pulling every other child's roll and filtering in the browser —
 * RLS would hide the rows, but the query would still be the centre's and the paging cost
 * would be real. `bookings_child_idx` in 0018 is on `(child_id, on_date desc)`, which is
 * exactly this read.
 *
 * Paged, even though a structural argument against it exists.
 *
 * `bookings_one_per_day` means one row per child per day, so a caller asking for four
 * weeks gets at most 28 rows and the 1000-row cap is unreachable. I wrote that argument
 * into a comment first, and `bounded-queries.test.ts` refused it — reads in the money and
 * evidence paths are paged unconditionally, with no allowlist entry available.
 *
 * That rule is right and the refusal was the guard working. The structural bound is a
 * property of *today's* window parameter, and a later caller asking for a year would
 * quietly inherit an argument made for four weeks. `listInvoiceLines` records the same
 * reasoning: paging costs nothing when it is not needed, and uniform treatment beats a
 * judgement call each reader has to re-make with less context than the person who made it.
 */
export async function listChildBookings(
  db: Db,
  childId: string,
  from: string,
  to: string,
): Promise<Booking[]> {
  const rows = await fetchAll<BookingRow>('listChildBookings', (a, b) =>
    db
      .from('bookings')
      .select(BOOKING_COLUMNS)
      .eq('child_id', childId)
      .gte('on_date', from)
      .lte('on_date', to)
      // `id` joins the ordering for the reason `listBookings` records: paging a
      // non-unique order repeats one row and skips another.
      .order('on_date')
      .order('id')
      .range(a, b),
  );
  return rows.map(toBooking);
}

/**
 * What `report_absence` can say. Mirrors 0051's returns, and the order is the order the
 * function checks in.
 */
export const ABSENCE_OUTCOMES = [
  'recorded',
  'already_absent',
  'no_booking',
  'past',
  'not_bookable',
  // 0063: refused in words rather than left to the CHECK constraint, because a
  // constraint violation is an error screen where a status is a sentence.
  'reason_too_long',
  'not_permitted',
] as const;

export type AbsenceOutcome = (typeof ABSENCE_OUTCOMES)[number];

/**
 * A guardian reports their own child absent for a booked day.
 *
 * The only write a family may make to the centre's own records, and it goes through the
 * definer function rather than the table — `bookings_write` still refuses a guardian
 * outright. See 0051 for why a policy could not have done this: `WITH CHECK` sees only
 * the new row, so it cannot say "and nothing else changed", which would have left the
 * office's `note` and the session times editable by a parent.
 *
 * The status it writes is always `absent`, never `cancelled`. Per 0018, absent is
 * "booked and did not attend, usually still charged" — so this changes nothing about what
 * a family owes, which is the reason it can be handed to them unsupervised.
 */
export async function reportAbsence(
  db: Db,
  input: { childId: string; onDate: string; reason?: string | null },
): Promise<AbsenceOutcome> {
  const { data, error } = await db.rpc('report_absence', {
    p_child: input.childId,
    p_date: input.onDate,
    p_reason: input.reason ?? null,
  });
  if (error) throw new Error(`reportAbsence: ${error.message}`);

  /*
    An unrecognised status is a refusal, not a success — the same contract as
    `kioskSignChild`. A status added to the function later must not be read by this
    version of the app as "it worked", because the direction that fails in is a family
    believing they told the centre something they did not.
  */
  return typeof data === 'string' && (ABSENCE_OUTCOMES as readonly string[]).includes(data)
    ? (data as AbsenceOutcome)
    : 'not_permitted';
}

/**
 * A run of days in one submission — a week of chickenpox is one call, not five.
 *
 * Per-day honest: each date answers with its own status, and the office is notified once
 * for the whole run (0063's reason for splitting the SQL). `bad_period` is the whole-range
 * refusal for a malformed or over-month window.
 */
export async function reportAbsenceRange(
  db: Db,
  input: { childId: string; from: string; to: string; reason?: string | null },
): Promise<{ status: 'bad_period' } | { status: 'ok'; days: Record<string, AbsenceOutcome> }> {
  const { data, error } = await db.rpc('report_absence_range', {
    p_child: input.childId,
    p_from: input.from,
    p_to: input.to,
    p_reason: input.reason ?? null,
  });
  if (error) throw new Error(`reportAbsenceRange: ${error.message}`);

  const body = (data ?? {}) as { status?: string; days?: Record<string, string> };
  if (body.status !== 'ok' || typeof body.days !== 'object' || body.days === null) {
    return { status: 'bad_period' };
  }
  // Every per-day status passes the same allowlist as the single-day path, and an
  // unrecognised one degrades to a refusal for the same reason.
  const days: Record<string, AbsenceOutcome> = {};
  for (const [date, outcome] of Object.entries(body.days)) {
    days[date] = (ABSENCE_OUTCOMES as readonly string[]).includes(outcome)
      ? (outcome as AbsenceOutcome)
      : 'not_permitted';
  }
  return { status: 'ok', days };
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';

export interface Invoice {
  id: string;
  centreId: string;
  guardianId: string;
  reference: string;
  status: InvoiceStatus;
  periodFrom: string;
  periodTo: string;
  issuedAt: string | null;
  dueOn: string | null;
  totalCents: number;
}

export interface InvoiceLine {
  id: string;
  invoiceId: string;
  childId: string | null;
  description: string;
  quantity: number;
  unitCents: number;
}

/**
 * Invoices with their totals.
 *
 * The total comes from `invoice_totals`, a view over the lines, rather than a stored column. A
 * cached money figure drifts from its own detail the first time a credit is added inside a
 * transaction that fails halfway — and a total that disagrees with its lines is worse than a slow
 * query.
 */
export async function listInvoices(db: Db, centreId: string): Promise<Invoice[]> {
  // Both paged. A centre with 65 families invoiced fortnightly passes 1,000 invoices inside
  // a year, and the totals view has a row per invoice — so the two would truncate at
  // different points and a family's invoice would render with a total of $0.00.
  const [invoices, totals] = await Promise.all([
    fetchAll<{
      id: string;
      centre_id: string;
      guardian_id: string;
      reference: string;
      status: InvoiceStatus;
      period_from: string;
      period_to: string;
      issued_at: string | null;
      due_on: string | null;
    }>('listInvoices', (from, to) =>
      db
        .from('invoices')
        .select('id, centre_id, guardian_id, reference, status, period_from, period_to, issued_at, due_on')
        .eq('centre_id', centreId)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to),
    ),
    fetchAll<{ invoice_id: string; total_cents: number }>('listInvoices (totals)', (from, to) =>
      db
        .from('invoice_totals')
        .select('invoice_id, total_cents')
        .eq('centre_id', centreId)
        .order('invoice_id')
        .range(from, to),
    ),
  ]);

  const totalOf = new Map(totals.map((t) => [t.invoice_id, Number(t.total_cents)]));

  return (
    invoices as {
      id: string;
      centre_id: string;
      guardian_id: string;
      reference: string;
      status: InvoiceStatus;
      period_from: string;
      period_to: string;
      issued_at: string | null;
      due_on: string | null;
    }[]
  ).map((r) => ({
    id: r.id,
    centreId: r.centre_id,
    guardianId: r.guardian_id,
    reference: r.reference,
    status: r.status,
    periodFrom: r.period_from,
    periodTo: r.period_to,
    issuedAt: r.issued_at,
    dueOn: r.due_on,
    totalCents: totalOf.get(r.id) ?? 0,
  }));
}

export async function listInvoiceLines(db: Db, invoiceId: string): Promise<InvoiceLine[]> {
  // One invoice's lines will not reach a thousand, and paging it costs nothing when it does
  // not. Uniform treatment beats a judgement call per query that a later reader has to
  // re-make with less context.
  const rows = await fetchAll<{
    id: string;
    invoice_id: string;
    child_id: string | null;
    description: string;
    quantity: number | string;
    unit_cents: number;
  }>('listInvoiceLines', (from, to) =>
    db
      .from('invoice_lines')
      .select('id, invoice_id, child_id, description, quantity, unit_cents')
      .eq('invoice_id', invoiceId)
      .order('id')
      .range(from, to),
  );
  return (
    rows as {
      id: string;
      invoice_id: string;
      child_id: string | null;
      description: string;
      quantity: number | string;
      unit_cents: number;
    }[]
  ).map((r) => ({
    id: r.id,
    invoiceId: r.invoice_id,
    childId: r.child_id,
    description: r.description,
    // numeric(8,2) arrives as a string from PostgREST.
    quantity: Number(r.quantity),
    unitCents: r.unit_cents,
  }));
}

/**
 * Next reference for a centre, as `INV-0001`.
 *
 * Per centre, not global. A global sequence would leak how many invoices every other centre on this
 * deployment has issued — a small thing that is nonetheless none of their business.
 */
export async function nextInvoiceReference(db: Db, centreId: string): Promise<string> {
  /*
   * TWO BUGS THIS HAD, BOTH FOUND BY AUDIT RATHER THAN BY USE.
   *
   * 1. It took the highest reference by TEXT order, which matches numeric order only while
   *    the zero-padding holds. `INV-0010` sorts above `INV-0009` because the pad makes them
   *    the same length — but `INV-10000` sorts BELOW `INV-9999`, because '1' < '9'. At ten
   *    thousand invoices the sequence would silently walk back into the 9,000s and every
   *    insert after that would collide with a reference that already exists. A centre
   *    invoicing 65 families fortnightly gets there in about six years.
   *
   * 2. It read one row and added one to it, so two managers creating an invoice in the same
   *    second computed the same reference.
   *
   * The maximum is now computed numerically across every reference for the centre, which
   * fixes (1) outright. (2) remains possible and is still caught by the unique index on
   * `(centre_id, reference)`: the second insert is refused. A gapless race-free sequence
   * needs a counter row and a transaction, which is more machinery than one centre issuing
   * one invoice at a time justifies. What matters is that the failure mode is a refused
   * insert and never a reused number — two different amounts sharing one reference in a
   * family's records is the error that cannot be repaired afterwards.
   */
  const rows = await fetchAll<{ reference: string }>('nextInvoiceReference', (from, to) =>
    db.from('invoices').select('reference').eq('centre_id', centreId).order('id').range(from, to),
  );

  let highest = 0;
  for (const { reference } of rows) {
    // Digits only, so a hand-entered reference like `2026-03/A` contributes 202603 instead of
    // throwing. Deliberately generous: this only has to stay ahead of what exists.
    const n = Number(String(reference).replace(/\D/g, ''));
    if (Number.isFinite(n) && n > highest) highest = n;
  }

  return `INV-${String(highest + 1).padStart(4, '0')}`;
}

export async function createInvoice(
  db: Db,
  input: {
    centreId: string;
    guardianId: string;
    reference: string;
    periodFrom: string;
    periodTo: string;
    dueOn?: string | null;
    lines: { childId: string | null; description: string; quantity: number; unitCents: number }[];
  },
): Promise<Invoice> {
  const { data: auth } = await db.auth.getUser();
  const { data: created, error } = await db
    .from('invoices')
    .insert({
      centre_id: input.centreId,
      guardian_id: input.guardianId,
      reference: input.reference,
      period_from: input.periodFrom,
      period_to: input.periodTo,
      due_on: input.dueOn ?? null,
      created_by: auth.user?.id ?? null,
    })
    .select('id, centre_id, guardian_id, reference, status, period_from, period_to, issued_at, due_on')
    .single();
  if (error) {
    if (error.code === '23505') {
      throw new Error(`Reference ${input.reference} is already used at this centre.`);
    }
    throw new Error(`createInvoice: ${error.message}`);
  }

  const row = created as {
    id: string;
    centre_id: string;
    guardian_id: string;
    reference: string;
    status: InvoiceStatus;
    period_from: string;
    period_to: string;
    issued_at: string | null;
    due_on: string | null;
  };

  if (input.lines.length > 0) {
    // Every object carries every key: PostgREST builds one INSERT from the union of keys, so an
    // absent key becomes an explicit NULL rather than taking the column default.
    const { error: lineError } = await db.from('invoice_lines').insert(
      input.lines.map((l) => ({
        invoice_id: row.id,
        child_id: l.childId,
        description: l.description.trim(),
        quantity: l.quantity,
        unit_cents: l.unitCents,
      })),
    );
    if (lineError) {
      // A draft invoice with no lines is a zero-total bill somebody could issue by accident.
      throw new Error(
        `createInvoice: the invoice was created but its lines failed (${lineError.message}). ` +
          `It currently totals zero — add the lines or void it.`,
      );
    }
  }

  const totals = await db
    .from('invoice_totals')
    .select('total_cents')
    .eq('invoice_id', row.id)
    .maybeSingle();

  return {
    id: row.id,
    centreId: row.centre_id,
    guardianId: row.guardian_id,
    reference: row.reference,
    status: row.status,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    issuedAt: row.issued_at,
    dueOn: row.due_on,
    totalCents: Number((totals.data as { total_cents: number } | null)?.total_cents ?? 0),
  };
}

/** Issuing freezes the lines: the policy refuses writes to a non-draft invoice. */
export async function issueInvoice(db: Db, invoiceId: string): Promise<void> {
  const { error } = await db
    .from('invoices')
    .update({ status: 'issued', issued_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('status', 'draft');
  if (error) throw new Error(`issueInvoice: ${error.message}`);
}

/**
 * Void rather than delete, and a reason is required by the constraint.
 *
 * A deleted invoice takes its reference with it, and the next one reuses the number — so two
 * different amounts end up sharing one reference in a family's records.
 */
export async function voidInvoice(db: Db, invoiceId: string, reason: string): Promise<void> {
  if (reason.trim().length < 3) throw new Error('voidInvoice: a reason is required.');
  const { error } = await db
    .from('invoices')
    .update({ status: 'void', voided_at: new Date().toISOString(), void_reason: reason.trim() })
    .eq('id', invoiceId);
  if (error) throw new Error(`voidInvoice: ${error.message}`);
}

/**
 * Records money that arrived. Append-only: correcting one means recording the reversal.
 *
 * `paidOn` defaults through `todayInZone`, not `toISOString().slice(0, 10)`, which is what this
 * did until 2026-08-07. UTC is twelve or thirteen hours behind New Zealand, so every payment
 * reconciled before about 1pm Auckland time would have been dated **the previous day** — landing
 * in the wrong month for anything reconciled on the 1st, and disagreeing with the bank statement
 * it was keyed from. Nothing called this yet, so no payment was ever misdated; it was a trap
 * rather than a bug, and it is the same trap 0006 fixed for `children.date_of_birth`.
 *
 * The default is the New Zealand zone rather than the centre's, matching `listCurrentEnrolments`.
 * Callers holding a centre should pass `todayInZone(centre.timezone)`.
 */
export async function recordPayment(
  db: Db,
  input: { invoiceId: string; amountCents: number; paidOn?: string; method?: string | null; reference?: string | null },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('payments').insert({
    invoice_id: input.invoiceId,
    amount_cents: input.amountCents,
    paid_on: input.paidOn ?? todayInZone(),
    method: input.method?.trim() || null,
    reference: input.reference?.trim() || null,
    recorded_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(`recordPayment: ${error.message}`);
}

/** One payment against one invoice, as the accounts screen shows it. */
export interface PaymentRow {
  id: string;
  invoiceId: string;
  amountCents: number;
  paidOn: string;
  method: string | null;
  reference: string | null;
}

/**
 * The payments against a set of invoices, most recent first.
 *
 * WHY THIS EXISTS, HAVING NOT EXISTED
 *
 * `recordPayment` has been here since Phase 5 and nothing ever read the rows back — the
 * accounts screen showed a balance and no way to see what it was made of. A family balance
 * means very little without the last few movements against it: "owes $240" and "owes $240,
 * paid $180 last Tuesday" are different conversations to have with a parent.
 *
 * No tenant filter, like everything else in this package. `payments_select` in 0019 is
 * `exists (select 1 from invoices i where i.id = invoice_id)`, so a caller sees payments for
 * exactly the invoices they can already see and the boundary is the invoices policy — which
 * is the one that has been asserted since 0019 rather than a second one written here.
 *
 * Batched by invoice ids rather than one query per row, for the reason
 * [[reading-every-row]] records: a screen that issues a query per row is a screen that
 * silently changes cost when a centre gets busy.
 *
 * PAGED, AND THE BOUNDED-QUERIES TEST IS WHY
 *
 * The first draft of this was a plain `select` and `bounded-queries.test.ts` refused it. It
 * was right to: this is payments across every outstanding invoice at a centre, and a
 * fortnightly biller with a few hundred families behind is not a strange case. Truncating at
 * PostgREST's silent 1000-row cap would drop payments off the end of the list — so a family
 * who had paid would show a balance with nothing behind it, which is precisely the
 * conversation this function exists to prevent going wrong.
 */
export async function listPaymentsFor(db: Db, invoiceIds: string[]): Promise<PaymentRow[]> {
  if (invoiceIds.length === 0) return [];
  const data = await fetchAll<PaymentRowShape>('listPaymentsFor', (from, to) =>
    db
      .from('payments')
      .select('id, invoice_id, amount_cents, paid_on, method, reference')
      .in('invoice_id', invoiceIds)
      /*
        `paid_on` is a DATE, so a centre recording several payments on one day gives every one
        of them the same sort key — and this pages. Two rows sharing a key may come back in
        either order per request, so one can land on both pages and another on neither: a
        payment counted twice against an invoice, or a payment silently missing from the
        arrears a family is chased for. `id` breaks the tie and makes the ordering total.
      */
      .order('paid_on', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
  return (data as PaymentRowShape[]).map((r) => ({
    id: r.id,
    invoiceId: r.invoice_id,
    amountCents: r.amount_cents,
    paidOn: r.paid_on,
    method: r.method,
    reference: r.reference,
  }));
}

interface PaymentRowShape {
  id: string;
  invoice_id: string;
  amount_cents: number;
  paid_on: string;
  method: string | null;
  reference: string | null;
}

// ---------------------------------------------------------------------------
// RS7 preparation
// ---------------------------------------------------------------------------

/**
 * Funded hours per child for a period, computed from attendance events.
 *
 * **This cannot submit anything, and nothing here pretends to.** Submitting a funding return
 * requires being a Ministry-approved student management system integrated with ELI; the Ministry is
 * not accepting integration applications, and approval requires supporting 50 services before
 * applying. So the output is figures a manager keys into ELI Web.
 *
 * Reads events for the whole period per child rather than a pre-aggregated total, because the
 * calculation has to resolve corrections and refuse to guess at incomplete days — neither of which
 * survives being summed in SQL first.
 */
/** Shapes read by `readFundingPeriod`. Named so the paged calls stay legible. */
interface AttendanceRow {
  id: number;
  child_id: string;
  kind: 'in' | 'out';
  at: string;
  corrects: number | null;
}

interface EnrolmentRow {
  child_id: string;
  twenty_hours_ece: boolean;
  start_date: string;
  end_date: string | null;
}

export async function readFundingPeriod(
  db: Db,
  input: {
    centreId: string;
    period: FundingPeriod;
    timeZone: string;
    /** Instants bounding the period locally, worked out by the caller. */
    fromUtc: string;
    toUtc: string;
  },
): Promise<FundingSummary> {
  /*
   * All three are paged, and the middle one is why `fetchAll` exists at all.
   *
   * PostgREST caps a select at 1000 rows and reports NO error. A centre licensed for 65
   * children produces roughly 130 attendance events a day, so a month is about 2,600 — and
   * the truncation was measured against the live database rather than reasoned about: 1,200
   * events present, 1,000 returned, and this function then reported **72 hours instead of
   * 100** and **invented two unresolved days**, because the cut landed mid-day and left
   * sign-ins with no sign-out.
   *
   * Under-reporting the money and fabricating broken records at the same time, silently, in
   * the one calculation whose whole design principle is that nothing is estimated.
   */
  const [children, events, enrolments] = await Promise.all([
    /*
      Ordered, for the reason spelled out on `attendance_events` below — which is the whole
      point: that lesson was learned, written down, and applied to one of the three reads in
      this very `Promise.all`. These two had NO `ORDER BY` at all, so past 1,000 rows their
      pages were not a partition of the table but two arbitrary samples of it. A child could
      appear on both pages, counting their hours twice in a funding claim, or on neither,
      dropping them from it. `id` is the primary key, so the order is total.
    */
    fetchAll<{ id: string }>('readFundingPeriod (children)', (from, to) =>
      db.from('children').select('id').eq('centre_id', input.centreId).order('id').range(from, to),
    ),
    fetchAll<AttendanceRow>('readFundingPeriod (events)', (from, to) =>
      db
        .from('attendance_events')
        .select('id, child_id, kind, at, corrects, children!inner(centre_id)')
        .eq('children.centre_id', input.centreId)
        .gte('at', input.fromUtc)
        .lt('at', input.toUtc)
        // Ordered by `at` AND `id`. Paging over a non-unique order is its own silent
        // corruption: two events sharing a timestamp — a bulk import, a fast double-tap —
        // may come back in either order, so one can appear on both pages and another on
        // neither. `id` is unique and monotonic, which makes the ordering total.
        .order('at')
        .order('id')
        .range(from, to),
    ),
    fetchAll<EnrolmentRow>('readFundingPeriod (enrolments)', (from, to) =>
      db
        .from('enrolments')
        .select('child_id, twenty_hours_ece, start_date, end_date')
        .eq('centre_id', input.centreId)
        // Same reason as `children` above. `id` is not selected because nothing here needs it;
        // it is ordered on regardless, because paging needs a total order and not a column the
        // caller happens to want.
        .order('id')
        .range(from, to),
    ),
  ]);

  const byChild = new Map<string, HoursEvent[]>();
  for (const r of events) {
    const list = byChild.get(r.child_id);
    const e: HoursEvent = { id: r.id, kind: r.kind, at: r.at, corrects: r.corrects };
    if (list) list.push(e);
    else byChild.set(r.child_id, [e]);
  }

  // The attestation in force during the period. A child whose enrolment changed mid-period is a case
  // this does not split — noted rather than guessed, because splitting it wrongly changes a claim.
  const attested = new Map<string, boolean>();
  for (const r of enrolments) {
    const overlaps = r.start_date <= input.period.to && (r.end_date === null || r.end_date >= input.period.from);
    if (overlaps && r.twenty_hours_ece) attested.set(r.child_id, true);
  }

  const results = children
    .map(({ id }) =>
      childFunding({
        childId: id,
        events: byChild.get(id) ?? [],
        timeZone: input.timeZone,
        period: input.period,
        twentyHoursEce: attested.get(id) === true,
      }),
    )
    // A child with no events in the period did not attend, and a row of zeros in an export is noise
    // that hides the rows that matter.
    .filter((c) => c.attendedHours > 0 || c.unresolvedDates.length > 0);

  return summariseFunding(input.period, results);
}

// ---------------------------------------------------------------------------
// Arrears
// ---------------------------------------------------------------------------

/**
 * Issued invoices with what they total and what has been paid.
 *
 * Reads `invoice_arrears` (0045), which is a view for the same reason `invoice_totals`
 * is: a stored balance drifts from its own detail, and this one moves every time money
 * arrives.
 *
 * **No ageing here.** The view returns integers and a date; `summariseArrears` in
 * `@ece/core` decides what is late, against a date the caller resolves with
 * `todayInZone(centre.timezone)`. Computing "today" at this layer would read the
 * server's clock, which is UTC and therefore yesterday for the whole New Zealand
 * morning.
 *
 * Paged, and the reason is the same one `listInvoices` records: a centre invoicing 65
 * families fortnightly passes a thousand invoices inside a year, and this view has a
 * row per issued invoice. Truncating silently would report a centre as owed less than
 * it is.
 */
export async function listOutstandingInvoices(
  db: Db,
  centreId: string,
): Promise<OutstandingInvoice[]> {
  const rows = await fetchAll<{
    invoice_id: string;
    guardian_id: string;
    reference: string;
    due_on: string | null;
    total_cents: number | string;
    paid_cents: number | string;
  }>('listOutstandingInvoices', (from, to) =>
    db
      .from('invoice_arrears')
      .select('invoice_id, guardian_id, reference, due_on, total_cents, paid_cents')
      .eq('centre_id', centreId)
      // `due_on` first so the oldest debt pages first, and `invoice_id` to break the
      // tie — two invoices share a due date by definition, and paging a non-unique
      // order repeats one row and skips another.
      .order('due_on', { nullsFirst: false })
      .order('invoice_id')
      .range(from, to),
  );

  return rows.map((r) => ({
    invoiceId: r.invoice_id,
    guardianId: r.guardian_id,
    reference: r.reference,
    dueOn: r.due_on,
    // bigint arrives from PostgREST as a string once it is large enough, and a centre
    // billing in cents reaches that sooner than it looks.
    totalCents: Number(r.total_cents),
    paidCents: Number(r.paid_cents),
  }));
}

/**
 * Every line of every issued invoice in a period, for the accounting export.
 *
 * One query rather than one per invoice. The obvious shape — list the invoices, then call
 * `listInvoiceLines` for each — is the N+1 that `readDayForecast` already had to be
 * rewritten out of once: a term's invoicing at a 65-place service is hundreds of invoices,
 * so it is hundreds of round trips for a file somebody downloads while waiting.
 *
 * `invoices!inner(centre_id, status, issued_at)` is the same embedded-filter idiom as
 * `listStaffAttendance`. It matters more here than it looks: `invoice_lines` carries no
 * `centre_id` of its own, so the tenant boundary for this read is entirely the policy on
 * `invoices` that the join walks through. There is no `.eq('centre_id', …)` to forget
 * because there is no such column — which is the safer arrangement, not a gap.
 *
 * DRAFTS ARE EXCLUDED, and that is the whole point of the filter. A draft is an invoice
 * nobody has sent; importing one into an accounting system creates a receivable for money
 * that was never asked for. `voided` is excluded for the mirror reason.
 */
export async function listIssuedInvoiceLines(
  db: Db,
  centreId: string,
  fromIso: string,
  toIso: string,
): Promise<InvoiceLine[]> {
  const rows = await fetchAll<{
    id: string;
    invoice_id: string;
    child_id: string | null;
    description: string;
    quantity: number | string;
    unit_cents: number;
  }>('listIssuedInvoiceLines', (from, to) =>
    db
      .from('invoice_lines')
      .select(
        'id, invoice_id, child_id, description, quantity, unit_cents, invoices!inner(centre_id, status, issued_at)',
      )
      .eq('invoices.centre_id', centreId)
      .in('invoices.status', ['issued', 'paid'])
      .gte('invoices.issued_at', fromIso)
      .lt('invoices.issued_at', toIso)
      // `invoice_id` first so a multi-line invoice's rows stay together, which is what
      // Xero uses to group them, then `id` to break the tie — paging a non-unique order
      // repeats one row and skips another.
      .order('invoice_id')
      .order('id')
      .range(from, to),
  );

  return rows.map((r) => ({
    id: r.id,
    invoiceId: r.invoice_id,
    childId: r.child_id,
    description: r.description,
    // numeric(8,2) arrives as a string from PostgREST.
    quantity: Number(r.quantity),
    unitCents: r.unit_cents,
  }));
}

// ---------------------------------------------------------------------------
// Funding receipts (0046)
// ---------------------------------------------------------------------------

/**
 * What the centre claimed and what the Ministry paid, per period.
 *
 * Both figures are entered by the centre. **Nothing here computes a claim** — this
 * product holds no funding rates, so multiplying the funded hours on `/funding` by one
 * would put a dollar sign on a number nobody has checked. `summariseVariance` in
 * `@ece/core` does the subtraction and nothing else.
 *
 * Unpaged, and the reason is structural rather than optimistic: one row per funding
 * period per centre, enforced by `funding_receipts_one_per_period`. Periods are
 * measured in months, so a centre reaches a thousand rows somewhere past its
 * eightieth year.
 */
export async function listFundingReceipts(db: Db, centreId: string): Promise<FundingReceipt[]> {
  const { data, error } = await db
    .from('funding_receipts')
    .select('id, period_label, period_from, period_to, claimed_cents, received_cents, received_on')
    .eq('centre_id', centreId)
    .order('period_from', { ascending: false });
  if (error) throw new Error(`listFundingReceipts: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    periodLabel: r.period_label as string,
    periodFrom: r.period_from as string,
    periodTo: r.period_to as string,
    claimedCents: r.claimed_cents === null ? null : Number(r.claimed_cents),
    receivedCents: Number(r.received_cents),
    receivedOn: r.received_on as string | null,
  }));
}

/**
 * Record or update a period. Upsert on `(centre_id, period_label)`, because a wash-up
 * is a correction to a running total rather than a second row — see 0046.
 */
export async function recordFundingReceipt(
  db: Db,
  input: {
    centreId: string;
    periodLabel: string;
    periodFrom: string;
    periodTo: string;
    claimedCents?: number | null;
    receivedCents: number;
    receivedOn: string | null;
    reference?: string | null;
    note?: string | null;
  },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('funding_receipts').upsert(
    {
      centre_id: input.centreId,
      period_label: input.periodLabel.trim(),
      period_from: input.periodFrom,
      period_to: input.periodTo,
      claimed_cents: input.claimedCents ?? null,
      received_cents: input.receivedCents,
      received_on: input.receivedOn,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      recorded_by: auth.user?.id ?? null,
    },
    { onConflict: 'centre_id,period_label' },
  );
  if (error) throw new Error(`recordFundingReceipt: ${error.message}`);
}
