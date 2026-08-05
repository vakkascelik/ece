/**
 * Reading every row, rather than the first thousand.
 *
 * WHY THIS EXISTS: A MEASURED BUG, NOT A PRECAUTION
 *
 * PostgREST is configured with `max_rows: 1000` — verified against the project's own
 * configuration, not assumed. An unbounded `select()` therefore returns **at most 1000
 * rows, with no error and no indication that anything was left behind.**
 *
 * That was proved against the live database: 1,200 attendance events inserted, an unbounded
 * select returned 1,000, and `error` was `null`. Then the funding calculation was run over
 * the same period and reported:
 *
 *     attended hours     72      (the truth was 100)
 *     unresolved dates   2       (the truth was 0)
 *
 * Both directions of wrong, in the money path. It **under-reported the hours by 28%**, so a
 * centre would be underpaid. And it **fabricated two broken days**, because truncation cut
 * the series mid-day and left sign-ins with no sign-out — telling a manager their records
 * were incomplete when they were not.
 *
 * That is the precise inverse of what the funding design is for. The rule is that nothing is
 * estimated: a day whose record is broken is excluded and named, so a manager can go and fix
 * it. Silent truncation makes the product name days that are fine and quietly drop hours
 * that were worked. It is the worst failure available to it, and it arrives without an error.
 *
 * WHY PAGING AND NOT A BIGGER LIMIT
 *
 * `.limit(5000)` moves the cliff, it does not remove it — and it moves it somewhere nobody
 * will be watching, because the failure is silent by construction. A centre licensed for 65
 * children generates roughly 130 attendance events a day, so a month is ~2,600 and a term is
 * ~8,000. Any fixed number is a bet on how big a customer gets.
 *
 * WHY IT THROWS AT THE CEILING INSTEAD OF RETURNING WHAT IT HAS
 *
 * Because a partial answer is what caused the bug. If a query somehow exceeds MAX_ROWS, the
 * only safe outcome is a loud failure: a funding export that fails is a funding export
 * somebody investigates, and a funding export that is 28% low is one somebody keys into ELI
 * Web. The ceiling exists to stop a runaway loop, not to cap a legitimate read.
 */

/** Matches the project's PostgREST `max_rows`. A larger page is silently clamped to this. */
const PAGE = 1000;

/**
 * 200 pages, so 200,000 rows. Far above any real query here — a two-site operator's entire
 * attendance history is a few hundred thousand rows over a decade, and nothing in this
 * product reads all of it in one go.
 */
const MAX_PAGES = 200;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Run a paged query to exhaustion.
 *
 * `page` is a factory rather than a builder, because a Supabase query builder cannot be
 * awaited twice — reusing one silently returns the first response again, which would produce
 * an infinite loop of identical pages. Taking a factory makes that impossible to write.
 *
 *   const rows = await fetchAll('readFundingPeriod (events)', (from, to) =>
 *     db.from('attendance_events').select(COLUMNS).eq(…).order('at').range(from, to));
 */
export async function fetchAll<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const out: T[] = [];

  for (let i = 0; i < MAX_PAGES; i += 1) {
    const from = i * PAGE;
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);

    const rows = data ?? [];
    out.push(...rows);

    // A short page means the end. Exactly PAGE rows is ambiguous — it could be the last
    // page or a full one — so it always costs one more request to find out. Cheaper than
    // being wrong.
    if (rows.length < PAGE) return out;
  }

  throw new Error(
    `${label}: more than ${MAX_PAGES * PAGE} rows. Refusing to return a partial result — ` +
      `narrow the query (a date range, a single child) rather than raising this ceiling.`,
  );
}
