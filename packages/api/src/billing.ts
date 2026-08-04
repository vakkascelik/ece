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
  type FundingPeriod,
  type FundingSummary,
  type HoursEvent,
} from '@ece/core';
import type { Db } from './index';

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
}

const BOOKING_COLUMNS = 'id, centre_id, child_id, on_date, status, from_time, to_time, note';

interface BookingRow {
  id: string;
  centre_id: string;
  child_id: string;
  on_date: string;
  status: BookingStatus;
  from_time: string | null;
  to_time: string | null;
  note: string | null;
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
});

export async function listBookings(
  db: Db,
  input: { centreId: string; from: string; to: string },
): Promise<Booking[]> {
  const { data, error } = await db
    .from('bookings')
    .select(BOOKING_COLUMNS)
    .eq('centre_id', input.centreId)
    .gte('on_date', input.from)
    .lte('on_date', input.to)
    .order('on_date');
  if (error) throw new Error(`listBookings: ${error.message}`);
  return (data as BookingRow[]).map(toBooking);
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
  const [invoices, totals] = await Promise.all([
    db
      .from('invoices')
      .select('id, centre_id, guardian_id, reference, status, period_from, period_to, issued_at, due_on')
      .eq('centre_id', centreId)
      .order('created_at', { ascending: false }),
    db.from('invoice_totals').select('invoice_id, total_cents').eq('centre_id', centreId),
  ]);
  if (invoices.error) throw new Error(`listInvoices: ${invoices.error.message}`);
  if (totals.error) throw new Error(`listInvoices (totals): ${totals.error.message}`);

  const totalOf = new Map(
    (totals.data as { invoice_id: string; total_cents: number }[]).map((t) => [
      t.invoice_id,
      Number(t.total_cents),
    ]),
  );

  return (
    data(invoices) as {
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

/** Narrows away the error branch after it has been checked. */
function data<T>(result: { data: T | null }): T {
  return (result.data ?? []) as T;
}

export async function listInvoiceLines(db: Db, invoiceId: string): Promise<InvoiceLine[]> {
  const { data: rows, error } = await db
    .from('invoice_lines')
    .select('id, invoice_id, child_id, description, quantity, unit_cents')
    .eq('invoice_id', invoiceId);
  if (error) throw new Error(`listInvoiceLines: ${error.message}`);
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
  const { data: rows, error } = await db
    .from('invoices')
    .select('reference')
    .eq('centre_id', centreId)
    .order('reference', { ascending: false })
    .limit(1);
  if (error) throw new Error(`nextInvoiceReference: ${error.message}`);

  const last = (rows as { reference: string }[])[0]?.reference ?? '';
  const n = Number(last.replace(/\D/g, '')) || 0;
  return `INV-${String(n + 1).padStart(4, '0')}`;
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

/** Records money that arrived. Append-only: correcting one means recording the reversal. */
export async function recordPayment(
  db: Db,
  input: { invoiceId: string; amountCents: number; paidOn?: string; method?: string | null; reference?: string | null },
): Promise<void> {
  const { data: auth } = await db.auth.getUser();
  const { error } = await db.from('payments').insert({
    invoice_id: input.invoiceId,
    amount_cents: input.amountCents,
    paid_on: input.paidOn ?? new Date().toISOString().slice(0, 10),
    method: input.method?.trim() || null,
    reference: input.reference?.trim() || null,
    recorded_by: auth.user?.id ?? null,
  });
  if (error) throw new Error(`recordPayment: ${error.message}`);
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
  const [children, events, enrolments] = await Promise.all([
    db.from('children').select('id').eq('centre_id', input.centreId),
    db
      .from('attendance_events')
      .select('id, child_id, kind, at, corrects, children!inner(centre_id)')
      .eq('children.centre_id', input.centreId)
      .gte('at', input.fromUtc)
      .lt('at', input.toUtc)
      .order('at'),
    db
      .from('enrolments')
      .select('child_id, twenty_hours_ece, start_date, end_date')
      .eq('centre_id', input.centreId),
  ]);

  if (children.error) throw new Error(`readFundingPeriod (children): ${children.error.message}`);
  if (events.error) throw new Error(`readFundingPeriod (events): ${events.error.message}`);
  if (enrolments.error) throw new Error(`readFundingPeriod (enrolments): ${enrolments.error.message}`);

  const byChild = new Map<string, HoursEvent[]>();
  for (const r of events.data as {
    id: number;
    child_id: string;
    kind: 'in' | 'out';
    at: string;
    corrects: number | null;
  }[]) {
    const list = byChild.get(r.child_id);
    const e: HoursEvent = { id: r.id, kind: r.kind, at: r.at, corrects: r.corrects };
    if (list) list.push(e);
    else byChild.set(r.child_id, [e]);
  }

  // The attestation in force during the period. A child whose enrolment changed mid-period is a case
  // this does not split — noted rather than guessed, because splitting it wrongly changes a claim.
  const attested = new Map<string, boolean>();
  for (const r of enrolments.data as {
    child_id: string;
    twenty_hours_ece: boolean;
    start_date: string;
    end_date: string | null;
  }[]) {
    const overlaps = r.start_date <= input.period.to && (r.end_date === null || r.end_date >= input.period.from);
    if (overlaps && r.twenty_hours_ece) attested.set(r.child_id, true);
  }

  const results = (children.data as { id: string }[])
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
