import { describe, expect, it } from 'vitest';
import { toXeroRows, XERO_COLUMNS, xeroAmount, xeroDate, type XeroLine } from '../xero';

const line = (over: Partial<XeroLine> = {}): XeroLine => ({
  contactName: 'Aroha Ngata',
  invoiceNumber: 'INV-0001',
  invoiceDate: '2026-08-09',
  dueDate: '2026-08-23',
  description: 'Full days',
  quantity: 7,
  unitCents: 6_500,
  ...over,
});

describe('xeroDate', () => {
  it('emits DD/MM/YYYY, which is what Xero asks for', () => {
    expect(xeroDate('2026-08-09')).toBe('09/08/2026');
  });

  it('does not go through Date, so it cannot land a day early', () => {
    /*
      The regression this exists for. `new Date('2026-01-01')` is midnight UTC; formatting
      that anywhere behind UTC renders 31/12/2025 — a whole invoice in the wrong financial
      year, silently, for anybody running the export from a server set to UTC. Which is
      production. The same bug has been fixed twice already in this repo.
    */
    expect(xeroDate('2026-01-01')).toBe('01/01/2026');
    expect(xeroDate('2026-12-31')).toBe('31/12/2026');
  });

  it('renders a missing date as empty rather than inventing one', () => {
    // An invoice with no due date is a real state here — `dueOn` is nullable. Guessing
    // one would make Xero chase a family for a date nobody set.
    expect(xeroDate(null)).toBe('');
    expect(xeroDate('')).toBe('');
  });
});

describe('xeroAmount', () => {
  it('is a summable decimal, not formatted money', () => {
    expect(xeroAmount(6_500)).toBe('65.00');
    expect(xeroAmount(0)).toBe('0.00');
    expect(xeroAmount(-4_500)).toBe('-45.00');
  });

  it('carries no currency symbol or thousands separator', () => {
    // `$1,234.56` is text to a spreadsheet and to Xero. Same reasoning as the accounts
    // export, which had this exact bug caught by a test before anybody suspected it.
    const out = xeroAmount(123_456);
    expect(out).toBe('1234.56');
    expect(out).not.toContain('$');
    expect(out).not.toContain(',');
  });
});

describe('toXeroRows', () => {
  it('emits every column in the template, in order', () => {
    const [row] = toXeroRows([line()]);
    // Xero's own instruction is not to delete columns or change headings, so the row
    // carries all of them — the unused ones empty, which the same page allows.
    expect(Object.keys(row!)).toEqual([...XERO_COLUMNS]);
  });

  it('fills only the seven fields this product actually knows', () => {
    const [row] = toXeroRows([line()]);
    const filled = Object.entries(row!)
      .filter(([, v]) => v !== '')
      .map(([k]) => k);
    expect(filled.sort()).toEqual(
      ['ContactName', 'Description', 'DueDate', 'InvoiceDate', 'InvoiceNumber', 'Quantity', 'UnitAmount'].sort(),
    );
  });

  it('leaves AccountCode and TaxType EMPTY, because this product does not know them', () => {
    /*
      The assertion that will look wrong to somebody later, so it is stated as an
      assertion rather than left as an absence.

      `200` and `15% GST on Income` are the plausible defaults and both would be guesses
      about somebody else's books. Revenue posted to a wrongly-guessed account reconciles
      perfectly and is found by an accountant months afterwards — a silent, expensive,
      hard-to-trace failure. Blank is supported by Xero and is the honest state.
    */
    const [row] = toXeroRows([line()]);
    expect(row!.AccountCode).toBe('');
    expect(row!.TaxType).toBe('');
  });

  it('carries no derived totals for Xero to disagree with', () => {
    // `Total`, `LineAmount`, `TaxTotal` and `TaxAmount` are absent from the column set:
    // Xero computes them from quantity × unit price, and a total we emitted that differed
    // would be a wrong number it had no reason to question.
    const [row] = toXeroRows([line()]);
    for (const derived of ['Total', 'LineAmount', 'TaxTotal', 'TaxAmount', 'InvoiceAmountDue']) {
      expect(row).not.toHaveProperty(derived);
    }
  });

  it('repeats the contact and invoice number on every line of one invoice', () => {
    /*
      How Xero groups lines: rows sharing an InvoiceNumber are one invoice. Emitting the
      number only on the first row of a group — which reads tidier — produces one invoice
      plus a run of orphan lines Xero cannot place.
    */
    const rows = toXeroRows([
      line({ description: 'Full days', quantity: 7 }),
      line({ description: 'Late pickup', quantity: 1, unitCents: 1_500 }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[1]!.InvoiceNumber).toBe('INV-0001');
    expect(rows[1]!.ContactName).toBe('Aroha Ngata');
    expect(rows[1]!.UnitAmount).toBe('15.00');
  });

  it('keeps a fractional quantity, which the schema allows', () => {
    // `invoice_lines.quantity` is numeric(8,2) — half days are real. Rounding to an
    // integer here would change what a family is charged.
    const [row] = toXeroRows([line({ quantity: 2.5 })]);
    expect(row!.Quantity).toBe('2.5');
  });
});
