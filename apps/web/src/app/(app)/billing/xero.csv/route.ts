import { listGuardians, listInvoices, listIssuedInvoiceLines } from '@ece/api';
import { toXeroRows, todayInZone, XERO_COLUMNS, type XeroLine } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { csvDownload } from '@/lib/csvDownload';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';

/**
 * Issued invoices in Xero's import format.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FILE, NOT AN INTEGRATION, AND THAT IS THE DECISION
 *
 * The alternative is Xero's API: OAuth, a refresh token per centre, a token-rotation
 * job, and a per-tenant third-party secret stored in a database that currently holds
 * none of those. That is a new class of secret and a new failure mode — a silently
 * expired token means invoices quietly stop syncing — bought for a feature a bookkeeper
 * performs monthly. A file they upload is a file they can look at first.
 *
 * `requireCapability('manageCentre')` is the same guard `/billing` uses, repeated here
 * because a route handler is outside the `(app)` layout and nothing checks it for us.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WINDOW IS THE CENTRE'S MONTH, AND IT IS EXPLICIT
 *
 * `?from=` and `?to=` are local dates. The default is the previous whole month, because
 * that is what a bookkeeper reconciles — exporting "everything" would re-import invoices
 * Xero already holds, and Xero skips an invoice number it already has, so the second
 * import silently does almost nothing. Better to hand over one month at a time.
 */
export async function GET(request: Request) {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const params = new URL(request.url).searchParams;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  /*
    The previous whole month, in the centre's zone. `todayInZone` gives a local date, so
    slicing its year-month and stepping back one day from the first lands on the last day
    of the previous month without any Date arithmetic — which is the arithmetic that has
    been wrong twice in this repo.
  */
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  const lastOfPrevMonth = shiftLocalDate(firstOfThisMonth, -1);
  const defaultFrom = `${lastOfPrevMonth.slice(0, 7)}-01`;

  const rawFrom = params.get('from') ?? '';
  const rawTo = params.get('to') ?? '';
  const from = isoDate.test(rawFrom) ? rawFrom : defaultFrom;
  // Exclusive upper bound, so `to` is the first day NOT included. A caller passing a
  // month's last day means to include it, so step forward one.
  const to = isoDate.test(rawTo) ? shiftLocalDate(rawTo, 1) : firstOfThisMonth;

  // Local dates to instants, because `issued_at` is a timestamp. Same conversion the
  // binder and the funding export make, and for the same reason: a day is local and an
  // event is an instant.
  const { fromUtc } = dayWindow(from, ctx.centre.timezone);
  const { fromUtc: toUtc } = dayWindow(to, ctx.centre.timezone);

  const [lines, invoices, guardians] = await Promise.all([
    listIssuedInvoiceLines(db, ctx.centre.id, fromUtc, toUtc),
    listInvoices(db, ctx.centre.id),
    listGuardians(db, ctx.centre.id),
  ]);

  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const guardianById = new Map(guardians.map((g) => [g.id, g.fullName]));

  /*
    A line whose invoice is not in the map is dropped rather than exported with a blank
    contact. It should be impossible — both reads are the same centre and the line read is
    the narrower one — but "impossible" here would mean a row Xero imports against no
    customer, which is a receivable nobody can chase. Silence in the file is recoverable;
    a wrong row in an accounting system is not.
  */
  const xeroLines: XeroLine[] = [];
  for (const line of lines) {
    const invoice = invoiceById.get(line.invoiceId);
    if (!invoice) continue;

    xeroLines.push({
      // Xero matches an existing customer on an exact name, so this is the guardian's
      // name and nothing decorative. A guardian who has since been removed leaves the
      // name blank rather than a placeholder — Xero would create a contact called
      // "Not on the list" and a bookkeeper would have to unpick it.
      contactName: guardianById.get(invoice.guardianId) ?? '',
      invoiceNumber: invoice.reference,
      invoiceDate: invoice.issuedAt ? invoice.issuedAt.slice(0, 10) : null,
      dueDate: invoice.dueOn,
      description: line.description,
      quantity: line.quantity,
      unitCents: line.unitCents,
    });
  }

  const rows = toXeroRows(xeroLines);

  return csvDownload<Record<string, string>>({
    rows,
    /*
      The PERIOD goes in the name, not just the download date.

      `exportFilename` appends today, which is right for a roll or an arrears snapshot —
      those describe the moment they were taken. An accounting export describes a month
      that is not today: a July file downloaded on 9 August would be named
      `...-2026-08-09.csv`, and a bookkeeper with three of them in a downloads folder
      cannot tell which is which. Both dates earn their place — one says what is in it,
      the other says when it was pulled.
    */
    kind: `xero-invoices-${from.slice(0, 7)}`,
    centreName: ctx.centre.name,
    on: today,
    // The template's columns, in the template's order. Xero's instruction is not to
    // delete a column or rename a heading, so the header row is generated from the same
    // constant the rows are — the two cannot drift.
    columns: XERO_COLUMNS.map((header) => ({
      header,
      value: (row: Record<string, string>) => row[header] ?? '',
    })),
  });
}
