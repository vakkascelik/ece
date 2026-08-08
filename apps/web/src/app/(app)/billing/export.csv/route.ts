import { listGuardians, listOutstandingInvoices } from '@ece/api';
import { summariseArrears, todayInZone, type AgedInvoice } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { csvDownload } from '@/lib/csvDownload';
import { serverDb } from '@/lib/supabase';

/**
 * Accounts, as a spreadsheet.
 *
 * `requireCapability('manageCentre')` is the same guard the page uses, and it is here
 * rather than inherited: a route handler is not inside the `(app)` layout, so nothing
 * checks it for us. A download that skipped this would hand an educator every family's
 * debts while the screen refused them.
 *
 * Amounts are emitted as plain decimals rather than through `formatCents`. The screen
 * renders `$1,234.56` for a person to read; a spreadsheet has to SUM this column, and
 * a currency-formatted string is text to Excel. Same numbers, different readers.
 */
export async function GET() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const [outstanding, guardians] = await Promise.all([
    listOutstandingInvoices(db, ctx.centre.id),
    listGuardians(db, ctx.centre.id),
  ]);

  const nameOf = new Map(guardians.map((g) => [g.id, g.fullName]));
  const arrears = summariseArrears(outstanding, today);

  return csvDownload<AgedInvoice>({
    rows: arrears.invoices,
    kind: 'accounts',
    centreName: ctx.centre.name,
    on: today,
    columns: [
      { header: 'Family', value: (i) => nameOf.get(i.guardianId) ?? 'Not on the list' },
      { header: 'Invoice', value: (i) => i.reference },
      { header: 'Due', value: (i) => i.dueOn },
      // Cents as a decimal string rather than the formatted dollars: a spreadsheet
      // should sum this column, and `$1,234.56` is text to Excel.
      { header: 'Invoiced', value: (i) => (i.totalCents / 100).toFixed(2) },
      { header: 'Paid', value: (i) => (i.paidCents / 100).toFixed(2) },
      { header: 'Owing', value: (i) => (i.outstandingCents / 100).toFixed(2) },
      { header: 'Days overdue', value: (i) => i.daysOverdue },
      { header: 'Age', value: (i) => i.bucket },
    ],
  });
}
