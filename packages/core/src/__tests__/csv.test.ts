import { describe, expect, it } from 'vitest';
import { exportFilename, toCsv, type CsvColumn } from '../csv';

interface Row {
  name: string;
  amount: number | null;
  note?: string | null;
}

const columns: CsvColumn<Row>[] = [
  { header: 'Name', value: (r) => r.name },
  { header: 'Amount', value: (r) => r.amount },
  { header: 'Note', value: (r) => r.note },
];

const body = (rows: Row[]) => toCsv(rows, columns, false);

describe('toCsv', () => {
  it('writes a header line and one line per row, CRLF', () => {
    expect(body([{ name: 'Tāne', amount: 500, note: null }])).toBe(
      'Name,Amount,Note\r\nTāne,500,\r\n',
    );
  });

  it('emits the header even with no rows', () => {
    // A file with headings and no rows says "nothing matched". A zero-byte file says
    // "the export is broken", and somebody will file that as a bug.
    expect(body([])).toBe('Name,Amount,Note\r\n');
  });

  it('quotes commas, quotes and newlines, doubling the quotes', () => {
    const out = body([{ name: 'Smith, Jo', amount: 1, note: 'She said "no"' }]);
    expect(out).toContain('"Smith, Jo"');
    expect(out).toContain('"She said ""no"""');

    const multiline = body([{ name: 'a', amount: 1, note: 'line one\nline two' }]);
    expect(multiline).toContain('"line one\nline two"');
  });

  it('renders null and undefined as empty, never as the word', () => {
    expect(body([{ name: 'a', amount: null }])).toBe('Name,Amount,Note\r\na,,\r\n');
  });

  describe('formula injection', () => {
    // A cell beginning = + - @ tab or CR is executed by Excel and Google Sheets, and
    // every one of these fields is typed by somebody — a name, an incident note, a
    // payment reference.
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      it(`neutralises a cell starting with ${JSON.stringify(dangerous[0])}`, () => {
        const out = body([{ name: dangerous, amount: 1, note: null }]);
        // The apostrophe goes immediately before the dangerous character, wherever the
        // field ends up — bare or quoted, which depends on whether it also contains a
        // comma or a newline.
        expect(out).toContain(`'${dangerous[0]}`);
      });
    }

    it('puts the apostrophe INSIDE the quotes when the cell also needs quoting', () => {
      // Outside, the field would begin with a bare apostrophe followed by a quote, and
      // the reader would lose the row.
      const out = body([{ name: '=cmd|"/c calc"!A1', amount: 1, note: null }]);
      expect(out).toContain('"\'=cmd|""/c calc""!A1"');
    });

    it('leaves an ordinary negative NUMBER alone', () => {
      /*
        The one this test was written for, and the first implementation failed it.
        `-4500` stringifies to a `-` prefix and was being escaped to `'-4500` — text in
        Excel, in a column an accountant is about to sum. Every credit and every
        negative variance in the product would have been wrong.

        A value that arrives as a number was computed by the product, not typed by a
        person, so there is nothing to inject.
      */
      const out = body([{ name: 'Credit', amount: -4500, note: null }]);
      expect(out).toContain('Credit,-4500,');
    });

    it('still guards a negative that arrived as a STRING', () => {
      // Because that one did come from a person, or from a field this product does not
      // control the type of.
      expect(body([{ name: '-1 see note', amount: 1, note: null }])).toContain("'-1 see note");
    });
  });

  it('starts with a byte order mark by default', () => {
    // Without it Excel on Windows reads the file in the system codepage and every
    // macron becomes mojibake — `Tāne` as `TÄne`.
    const out = toCsv([{ name: 'Tāne', amount: 1 }], columns);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('Tāne');
  });
});

describe('exportFilename', () => {
  it('names the kind, the centre and the date', () => {
    expect(exportFilename('accounts', 'Little Pearls Mt Albert', '2026-08-09')).toBe(
      'accounts-little-pearls-mt-albert-2026-08-09.csv',
    );
  });

  it('strips macrons from the FILENAME only', () => {
    // The one place in this product macrons are deliberately removed: a filename
    // crosses shells, email clients and Windows Explorer. The contents keep them.
    expect(exportFilename('roll', 'Ngā Tamariki', '2026-08-09')).toBe(
      'roll-nga-tamariki-2026-08-09.csv',
    );
  });

  it('collapses punctuation rather than emitting it', () => {
    expect(exportFilename('funding', "St Mary's  (Ōtāhuhu)", '2026-01-01')).toBe(
      'funding-st-mary-s-otahuhu-2026-01-01.csv',
    );
  });
});
