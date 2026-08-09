/**
 * Invoices as a file Xero will import.
 *
 * Pure, so the column set and the arithmetic are testable without a database and without
 * an accounting system. The route reads; this shapes.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS SOURCED AND WHAT IS NOT
 *
 * From Xero Central directly, on 2026-08-09:
 *   - Only `ContactName` and `InvoiceNumber` are required.
 *   - One row per invoice LINE. Rows sharing an `InvoiceNumber` become one invoice.
 *   - `InvoiceDate` and `DueDate` use `DD/MM/YYYY`.
 *   - Amounts may include or exclude tax, but one file must not mix the two.
 *   - "Any other fields can be left blank and completed in Xero afterwards."
 *   - "Don't delete any columns or change any column headings."
 *
 * NOT from Xero: the exact list and order of the remaining columns. It came from a
 * third-party mirror of the template, and nobody here has opened a template downloaded
 * from Xero or run a real import. Recorded in `unverified-claims`, because the last
 * instruction above means a wrong column set is a rejected file.
 *
 * The failure mode is the tolerable one: Xero refuses the import and says so. What would
 * be intolerable is a file it accepts and gets wrong, which is what the two decisions
 * below are about.
 */

/** One line of one invoice, as Xero wants it. */
export interface XeroLine {
  contactName: string;
  invoiceNumber: string;
  /** ISO. Converted to DD/MM/YYYY on the way out. */
  invoiceDate: string | null;
  dueDate: string | null;
  description: string;
  quantity: number;
  unitCents: number;
}

/**
 * The columns, in order.
 *
 * The full set rather than the nine that carry data, because Xero's own instruction is
 * not to delete columns. The unused ones are emitted empty — which the same page
 * explicitly allows — so the file matches the template's shape while asserting nothing
 * about a chart of accounts this product has never seen.
 */
export const XERO_COLUMNS = [
  'ContactName',
  'EmailAddress',
  'POAddressLine1',
  'POAddressLine2',
  'POAddressLine3',
  'POAddressLine4',
  'POCity',
  'PORegion',
  'POPostalCode',
  'POCountry',
  'InvoiceNumber',
  'Reference',
  'InvoiceDate',
  'DueDate',
  'InventoryItemCode',
  'Description',
  'Quantity',
  'UnitAmount',
  'Discount',
  'AccountCode',
  'TaxType',
  'TrackingName1',
  'TrackingOption1',
  'TrackingName2',
  'TrackingOption2',
  'Currency',
] as const;

/**
 * `DD/MM/YYYY`, which is what Xero asks for and is NOT what anything else here uses.
 *
 * Built by splitting the ISO string rather than by constructing a `Date`. A `Date` would
 * reintroduce the timezone bug this repo has fixed twice: `new Date('2026-08-09')` is
 * midnight UTC, and formatting that in any zone behind UTC renders the 8th. The input is
 * already a local date computed in the centre's timezone; there is nothing to convert and
 * every conversion is a chance to be a day out.
 */
export function xeroDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${y}`;
}

/**
 * Cents as a decimal string.
 *
 * A spreadsheet has to arithmetic on this column, so it is `65.00` and never `$65.00` —
 * the same reasoning the accounts export records, and the reason `formatCents` is not
 * used here.
 */
export function xeroAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * One CSV row per line, as an object keyed by column name.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * TWO COLUMNS ARE DELIBERATELY LEFT EMPTY, AND THAT IS THE IMPORTANT PART
 *
 * `AccountCode` and `TaxType` are the centre's, and **this product does not know them.**
 * There is no chart of accounts here and no tax field anywhere in the schema — an invoice
 * is quantity times unit price, full stop.
 *
 * A plausible-looking default is available for both: `200` is Xero's usual sales account
 * and `15% GST on Income` is the New Zealand rate. Emitting either would be a guess about
 * somebody's books that looks like a fact, and the failure is silent — revenue posted to
 * the wrong account reconciles fine and is discovered by an accountant months later. Xero
 * says other fields may be left blank and completed afterwards, so blank is both correct
 * and supported.
 *
 * `Total`, `TaxTotal`, `LineAmount` and `TaxAmount` are absent from the column set for
 * the same reason in a different direction: they are derived, and a derived total that
 * disagreed with quantity × unit price would be a wrong number Xero had no reason to
 * question. Let Xero compute them from the lines.
 */
export function toXeroRows(lines: readonly XeroLine[]): Array<Record<string, string>> {
  return lines.map((line) => {
    const row: Record<string, string> = {};
    for (const column of XERO_COLUMNS) row[column] = '';

    row.ContactName = line.contactName;
    row.InvoiceNumber = line.invoiceNumber;
    row.InvoiceDate = xeroDate(line.invoiceDate);
    row.DueDate = xeroDate(line.dueDate);
    row.Description = line.description;
    row.Quantity = String(line.quantity);
    row.UnitAmount = xeroAmount(line.unitCents);

    return row;
  });
}
