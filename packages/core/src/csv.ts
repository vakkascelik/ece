/**
 * CSV, for people who will open it in Excel.
 *
 * Every export in this product goes through here, so the three decisions below are made
 * once rather than argued per screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 1. A BYTE ORDER MARK, WHICH IS NOT OPTIONAL FOR THIS PRODUCT
 *
 * Excel on Windows reads a CSV with no BOM in the system codepage, not UTF-8. Every
 * macron in the file becomes mojibake: `Tāne` renders as `TÄne`, `whānau` as `whÄnau`.
 *
 * That is not a cosmetic defect here. This is a New Zealand early-childhood product
 * whose stated values include a commitment to te reo Māori, and the first thing a
 * centre does with an export is open it in Excel and send it to somebody. A three-byte
 * prefix is the difference between a child's name being spelled correctly and not.
 *
 * `emitBom` defaults to true and exists so tests can assert the content without it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 2. FORMULA INJECTION, WHICH IS A REAL ATTACK AND NOT A THEORETICAL ONE
 *
 * A cell beginning `=`, `+`, `-`, `@`, a tab or a carriage return is executed as a
 * formula by Excel and by Google Sheets. Everything in this product is typed by
 * somebody — a child's name, a note on an incident, a reference on a payment — and any
 * of those fields can begin with `=`.
 *
 * The mitigation is to prefix the cell with an apostrophe, which Excel treats as "the
 * rest is text". **This deliberately alters the value**, and that is the right trade:
 * the alternative is a spreadsheet that runs whatever a parent typed into an enrolment
 * form. Documented here because a reader finding a stray apostrophe in an export will
 * otherwise assume it is a bug.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 3. CRLF, PER RFC 4180
 *
 * Bare newlines work in most readers and not in all of them, and the one that fails is
 * always somebody's finance system. There is no cost to being correct here.
 */

export interface CsvColumn<T> {
  /** The heading, as a person should read it. */
  header: string;
  /** Null and undefined both render as an empty cell rather than the string "null". */
  value: (row: T) => string | number | null | undefined;
}

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(raw: string | number | null | undefined): string {
  if (raw === null || raw === undefined) return '';

  /*
    NUMBERS ARE NEVER GUARDED, AND THE FIRST VERSION GOT THIS WRONG.

    `-4500` is a string starting with `-` once you stringify it, so the guard below
    turned every credit and every negative variance into `'-4500` — text in Excel, not
    a number, in a column an accountant is about to sum. The test caught it.

    A number reached this function as a number, which means the product computed it
    rather than a person typing it. There is nothing to inject.
  */
  if (typeof raw === 'number') return String(raw);

  let text = raw;

  // Before quoting, not after: the apostrophe has to be inside the quoted field.
  if (FORMULA_START.test(text)) text = `'${text}`;

  // A field needs quoting if it contains a quote, a comma, or a line break. Quotes
  // inside are doubled — the RFC's escape, and the one every reader implements.
  if (/["',\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * Rows and columns to a CSV document.
 *
 * Column order is the array's order, so the caller decides what a reader sees first.
 * An empty row set still emits the header line: a file with headings and no rows says
 * "nothing matched", while a zero-byte file says "the export is broken".
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], emitBom = true): string {
  const lines = [
    columns.map((c) => cell(c.header)).join(','),
    ...rows.map((row) => columns.map((c) => cell(c.value(row))).join(',')),
  ];
  return `${emitBom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}

/**
 * A filename a person can find again in their downloads folder.
 *
 * `accounts-little-pearls-2026-08-09.csv`. The centre name is in it because a manager
 * of two sites downloads both, and `export.csv` twice is how the wrong one gets emailed
 * to an accountant.
 *
 * Everything outside `[a-z0-9]` collapses to a hyphen — including macrons, which is the
 * one place in this product they are deliberately stripped: a filename crosses into
 * shells, email clients and Windows Explorer, and `Ngā-Tamariki.csv` survives none of
 * them reliably. The *contents* keep every macron, which is what the BOM above is for.
 */
export function exportFilename(kind: string, centreName: string, on: string): string {
  const slug = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  return `${slug(kind)}-${slug(centreName)}-${on}.csv`;
}
