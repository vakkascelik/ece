import { exportFilename, toCsv, type CsvColumn } from '@ece/core';

/**
 * The one place a CSV becomes a download.
 *
 * There was no precedent for this in the repo: the only route handler was
 * `api/health`, and the existing "export" is a print stylesheet with a *Save as PDF*
 * hint — chosen deliberately to avoid a headless browser in the deployment. So this is
 * a new convention, and it is centralised so the four decisions below are made once.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IT IS A ROUTE HANDLER, WHICH MEANS IT IS A NEW READ PATH
 *
 * Every export route calls `requireCapability` exactly as its page does, and RLS is
 * still underneath. That is worth stating because a download feels like a formatting
 * concern and is not: `/billing` refusing an educator while `/billing/export.csv`
 * hands them the same rows would be a real hole, and nothing about the CSV layer would
 * hint at it. `exports.spec.ts` carries a route×role matrix for that reason — every
 * export route belongs in it, and a new one that is not in it is untested.
 *
 * (This said `roles.spec.ts` until 2026-08-09, which is a different file and does not
 * cover a single export path. The coverage was real and the pointer was not; a comment
 * that sends a reader to the wrong place to verify a security claim is worse than one
 * that sends them nowhere.)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * `no-store`, ALWAYS
 *
 * These files contain children's names, family debts and staff hours. A shared cache
 * holding one and serving it to the next caller is the worst version of this feature,
 * and the header costs nothing.
 */
export function csvDownload<T>(input: {
  rows: T[];
  columns: CsvColumn<T>[];
  /** What this is, for the filename: `accounts`, `roll`, `funding`. */
  kind: string;
  centreName: string;
  /** Today in the centre's timezone, resolved by the caller. Never `new Date()` here. */
  on: string;
  /**
   * Lines appended after the data — caveats that must not be lost when the file leaves the
   * screen that carried them.
   *
   * ADDED FOR THE RS7 EXPORT, and the reason generalises. A CSV emailed to an accountant loses
   * every banner it came with, and the RS7 figures rest on allocations the Handbook does not
   * make — which days lose a capped week's excess, which of a week's hours are Plus 10. A file
   * whose numbers look final while three of them rest on a stated assumption is a file somebody
   * submits.
   *
   * After the rows rather than before, so the data stays machine-readable: a consumer that
   * reads the header and then parses to the first blank line gets exactly the figures.
   */
  trailing?: (string | number | null | undefined)[][];
}): Response {
  const body = toCsv(input.rows, input.columns, true, input.trailing);
  const filename = exportFilename(input.kind, input.centreName, input.on);

  return new Response(body, {
    headers: {
      // `charset=utf-8` as well as the BOM. Belt and braces: the BOM is what Excel
      // reads, the charset is what everything else reads.
      'content-type': 'text/csv; charset=utf-8',
      // Quoted, because the filename contains hyphens and could contain a comma if a
      // centre's name does.
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store, max-age=0',
      // The file is a download, never something a browser should sniff into being
      // HTML — which is the shape of an XSS in a filename-controlled response.
      'x-content-type-options': 'nosniff',
    },
  });
}
