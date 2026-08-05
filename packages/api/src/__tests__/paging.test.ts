import { describe, expect, it } from 'vitest';
import { fetchAll } from '../paging';

/**
 * The helper is tested against a fake pager rather than the database, because what needs
 * proving is the loop: that it asks for the next page, that it stops, and that it stops for
 * the right reason. The live behaviour it exists to fix — PostgREST truncating at 1000 rows
 * with no error — was measured separately against the real project.
 */

/** A pager over `total` rows that clamps any request to 1000, exactly as PostgREST does. */
function fakeTable(total: number, calls: Array<[number, number]> = []) {
  return {
    calls,
    page: (from: number, to: number) => {
      calls.push([from, to]);
      const size = Math.min(to - from + 1, 1000);
      const rows = [];
      for (let i = from; i < Math.min(from + size, total); i += 1) rows.push({ id: i });
      return Promise.resolve({ data: rows, error: null });
    },
  };
}

describe('fetchAll', () => {
  it('returns everything when there is less than one page', async () => {
    const t = fakeTable(7);
    const rows = await fetchAll('probe', t.page);
    expect(rows).toHaveLength(7);
    // One request. Paging must not cost a round trip on the small reads, which is nearly
    // all of them.
    expect(t.calls).toEqual([[0, 999]]);
  });

  it('returns nothing, without error, for an empty table', async () => {
    const t = fakeTable(0);
    expect(await fetchAll('probe', t.page)).toEqual([]);
    expect(t.calls).toHaveLength(1);
  });

  it('crosses the 1000-row cliff that broke the funding export', async () => {
    // The measured case: 1,200 rows present, an unbounded select saw 1,000.
    const t = fakeTable(1200);
    const rows = await fetchAll('probe', t.page);
    expect(rows).toHaveLength(1200);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // And in order, with nothing repeated — a paging bug that double-counted would inflate
    // funded hours, which is the same class of error in the other direction.
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 1200 }, (_, i) => i));
  });

  it('pays one extra request when the total is an exact multiple of the page', async () => {
    // 1000 rows is ambiguous: it could be a full page or the last one. Guessing "that was
    // the end" would silently drop everything after row 1000 whenever a count landed
    // exactly on the boundary — a rare, unreproducible shortfall, which is the worst kind.
    const t = fakeTable(1000);
    const rows = await fetchAll('probe', t.page);
    expect(rows).toHaveLength(1000);
    expect(t.calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it('throws on error rather than returning the pages it already had', async () => {
    let n = 0;
    const flaky = (from: number) => {
      n += 1;
      if (n === 2) return Promise.resolve({ data: null, error: { message: 'connection lost' } });
      const rows = Array.from({ length: 1000 }, (_, i) => ({ id: from + i }));
      return Promise.resolve({ data: rows, error: null });
    };
    // A partial result is what caused the bug being fixed. Half a funding period is worse
    // than no funding period, because only one of them gets keyed into ELI Web.
    await expect(fetchAll('readFundingPeriod (events)', flaky)).rejects.toThrow(
      /readFundingPeriod \(events\): connection lost/,
    );
  });

  it('refuses rather than looping forever, and says what to do instead', async () => {
    // A pager that never returns a short page — the shape a reused builder would produce.
    const endless = (from: number) =>
      Promise.resolve({
        data: Array.from({ length: 1000 }, (_, i) => ({ id: from + i })),
        error: null,
      });
    await expect(fetchAll('probe', endless)).rejects.toThrow(/Refusing to return a partial result/);
    await expect(fetchAll('probe', endless)).rejects.toThrow(/narrow the query/);
  });

  it('tolerates a pager that returns null data with no error', async () => {
    const nullish = () => Promise.resolve({ data: null, error: null });
    expect(await fetchAll('probe', nullish)).toEqual([]);
  });
});
