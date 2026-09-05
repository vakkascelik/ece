/**
 * Regulated adult-to-child ratios.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VERIFIED 2026-08-18 — WHAT THAT DOES AND DOES NOT COVER
 *
 * `RATIO_TABLES_VERIFIED` is now **true**. The all-day centre-based bands below were
 * checked row by row against Schedule 2 as published on legislation.govt.nz, version
 * as at 29 June 2026 (which includes the 23 February 2026 amendment made by s 14 of
 * the Education and Training (Early Childhood Education Reform) Amendment Act 2025).
 * The tables were transcribed from the regulation and diffed against these values —
 * not recalled, and not summarised by a tool. **Every published row matches.**
 *
 * Reading it also found a rule this file did not have: three or fewer children of
 * mixed ages need one adult, not the sum of the two bands. See `assessRatio`.
 *
 * What the flag covers: the two tables below, for an **all-day centre-based** service.
 * What it does not cover, each tagged TODO where it bites:
 *
 *   - The **sessional** tables, which differ for 2-and-over (1–8 → 1, 9–30 → 2, …).
 *   - **Home-based** ratios, which are a different schedule entirely.
 *   - Regulation 44A, letting spare under-2 capacity offset the 2-and-over count.
 *   - Regulation 54(4), the sibling rules.
 *   - Who counts. The schedule says every person present aged under 6 counts as a
 *     child — including a staff member's own child, who is not on any roll. The adult
 *     half of that sentence stopped being a gap on the DERIVED source on 2026-09-05:
 *     `0094` records when somebody is off the floor and `0095` subtracts it from
 *     `adults_present_now`. A declared centre still types a total, and the caveat
 *     now says which is which.
 *
 * The last one is the sharpest, because it is about the **inputs** rather than the
 * tables: this product derives the child count from attendance events for enrolled
 * children, so a visiting under-6 is invisible to it, and the adult count is a figure
 * a person types. A correct table over an incomplete count is still the right thing
 * to ship — the alternative is a blanket "unverified" notice that says less — but it
 * is why `ratioInputCaveat()` exists and is rendered next to the figure.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THE MATHS IS SEPARATE FROM THE NUMBERS
 *
 * Because the maths is testable and the numbers are a citation. Everything below
 * takes a table as an argument, so a correction to Schedule 2 — or a different
 * service type, or a licence with a variation on it — changes data and not logic.
 */

import { isUnderTwo, todayInZone } from './children';

/**
 * Have these been checked against the regulation?
 *
 * Flipping this is a claim about the law, not about the code. Set `true` on 2026-08-18
 * against Schedule 2 as at 29 June 2026, retrieved from legislation.govt.nz and
 * transcribed row by row. The commit records the rows.
 *
 * TODO(ratios): a second pair of human eyes on the transcription. The tables matched
 * exactly, so this is confirmation rather than correction — but the whole point of
 * this flag is that one reading is one reading.
 */
export const RATIO_TABLES_VERIFIED = true;

/**
 * Three or fewer children of mixed ages need one adult.
 *
 * A row in its own right in Schedule 2 — "Up to 3 children of mixed ages … 1" — and
 * separate from the summing rule that governs every larger group. Without it, two
 * infants and a three-year-old read as needing two adults when the regulation asks
 * for one, which is the indicator crying wolf on a room that is legal. Applies only
 * when both age groups are actually present; a single-band group uses its own table.
 */
const MIXED_AGE_SINGLE_ADULT_MAX = 3;

export interface RatioBand {
  /** Applies when the child count is at most this. */
  upTo: number;
  adults: number;
}

export interface RatioTable {
  label: string;
  citation: string;
  bands: RatioBand[];
  /**
   * Beyond the last band, one further adult for every this many children (or part
   * thereof). Stated separately because the published tables stop at a number and
   * the rule continues.
   */
  thereafterPerAdult: number;
}

/**
 * Children under two.
 *
 * Stricter on ratios and on space, and the boundary is the child's second birthday —
 * not the start of a term, and not "about two". `isUnderTwo` is the same calendar
 * arithmetic used everywhere else, so a child moves band on the right day.
 */
export const UNDER_TWO_TABLE: RatioTable = {
  label: 'Under 2',
  citation:
    'Education (Early Childhood Services) Regulations 2008, Schedule 2 — all-day centre-based, children under 2. Checked against the regulation as at 29 June 2026.',
  bands: [
    { upTo: 5, adults: 1 },
    { upTo: 10, adults: 2 },
    { upTo: 15, adults: 3 },
    { upTo: 20, adults: 4 },
  ],
  thereafterPerAdult: 5,
};

/** Children aged two and over. */
export const TWO_AND_OVER_TABLE: RatioTable = {
  label: '2 and over',
  citation:
    'Education (Early Childhood Services) Regulations 2008, Schedule 2 — all-day centre-based, children aged 2 and over. Checked against the regulation as at 29 June 2026.',
  bands: [
    { upTo: 6, adults: 1 },
    { upTo: 20, adults: 2 },
    { upTo: 30, adults: 3 },
    { upTo: 40, adults: 4 },
    { upTo: 50, adults: 5 },
  ],
  thereafterPerAdult: 10,
};

/**
 * Adults required for a count of children in one age band.
 *
 * Zero children needs zero adults. That is arithmetic, not a statement about
 * supervision — a centre with nobody in it is a different question.
 */
export function requiredAdultsFor(count: number, table: RatioTable): number {
  if (count <= 0) return 0;

  for (const band of table.bands) {
    if (count <= band.upTo) return band.adults;
  }

  const last = table.bands[table.bands.length - 1];
  // A table with no bands is a configuration error, not a room with no rules — fall
  // back to the per-adult figure rather than silently reporting nobody is needed.
  if (!last) return Math.ceil(count / table.thereafterPerAdult);

  const over = count - last.upTo;
  // Ceiling, because "or part thereof" — eleven extra children at one per ten is two
  // more adults, not 1.1.
  return last.adults + Math.ceil(over / table.thereafterPerAdult);
}

export type RatioStatus = 'ok' | 'at-limit' | 'breach';

export interface RatioAssessment {
  underTwo: number;
  twoAndOver: number;
  present: number;

  adultsPresent: number;
  adultsRequired: number;

  status: RatioStatus;
  /** How many more adults are needed right now. Zero unless in breach. */
  shortfall: number;

  /** More children this band can take before another adult is required. */
  headroomUnderTwo: number;
  headroomTwoAndOver: number;

  /**
   * The sentence to put on screen when the next arrival would tip it.
   *
   * The plan's requirement, and the reason this is worth building at all: a ratio
   * display that reports a breach after it happens tells an educator something they
   * cannot act on. "One more under 2 and you need another adult" is actionable while
   * the parent is still at the door.
   */
  warning: string | null;

  citations: string[];
  verified: boolean;
}

/**
 * Adults required for a mixed room, which is the whole rule and not a sum of two.
 *
 * **CORRECTED 2026-08-18.** Summing the two bands used to be described here as "the
 * conservative reading", on the assumption that Schedule 2 published different tables
 * depending on whether under-2s were present. It does not, and summing is not a
 * reading — it is the rule, stated in the schedule as "Sum of minimum staffing
 * requirement for relevant number of children under 2 years old … and minimum
 * staffing requirement for relevant number of children of or over 2 years old".
 *
 * So the guess was right and its stated basis was wrong, which is worth recording:
 * the comment claimed a safety margin that never existed. The row above it in the
 * same table is the part that was genuinely missing — up to 3 children of mixed ages
 * need one adult.
 */
function adultsRequiredFor(underTwo: number, twoAndOver: number, under: RatioTable, over: RatioTable): number {
  const mixed = underTwo > 0 && twoAndOver > 0;
  if (mixed && underTwo + twoAndOver <= MIXED_AGE_SINGLE_ADULT_MAX) return 1;
  return requiredAdultsFor(underTwo, under) + requiredAdultsFor(twoAndOver, over);
}

/**
 * What the figure on screen does not know, said next to it.
 *
 * Not a disclaimer about the tables — those are verified. This is about the inputs,
 * and it stays true no matter how carefully the bands are checked: the roll counts
 * enrolled children who were signed in, and the schedule counts every person present
 * aged under 6, including a staff member's own child.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BREAK CLAUSE NARROWED, 2026-09-05 — and only after the behaviour changed
 *
 * It read *"an adult does not count while on a break or on non-contact time"* as a flat
 * limitation, and it was true: `adults_present_now` counted, on the `derived` source,
 * anybody whose most recent attendance row was `in`, and somebody at lunch has not
 * signed out.
 *
 * `0094` gave that fact a table and `0095` taught the function to subtract it, so on
 * the derived source a recorded break is now excluded. On the **declared** source it is
 * not, and cannot be: that number is typed by a person and there is nothing per-person
 * to subtract. So the sentence now says which is which rather than claiming either.
 *
 * **It was not narrowed when `0094` shipped**, four hours earlier, because the table
 * fed §9-4's funding figures and nothing else — the ratio still counted the person at
 * lunch. Retiring the clause then would have put a false sentence on three screens, the
 * mistake `exportDisclaimer` made the same morning in the other direction.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * TODO(ratios): non-enrolled under-6s have nowhere to be recorded. A "visitors under
 * 6" count on the attendance screen would close it and is a schema change, not a
 * wording one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT NOW ALSO NAMES THE SCHEDULE, added 2026-09-03
 *
 * `assessRatio` takes both tables as arguments precisely so a different service type
 * can supply different ones — and **no caller anywhere passes them.** `staff.ts`,
 * `ratioForecast.ts` and `ratioHistory.ts` all accept and forward the parameters; the
 * two screens that actually assess a room (`attendance/page.tsx`, the overview) call
 * `assessRatio` with three numbers and get the all-day centre-based defaults. So a
 * home-based service reading this product today gets a confident figure computed from
 * a schedule that does not govern it, and nothing on the screen says so.
 *
 * The cause is upstream of this file: `centres` has no service-type or licence-type
 * column, so no caller *can* pass a table. That is [[unverified-claims]] item 48.
 *
 * WHY THE FIX IS A SENTENCE AND NOT A COLUMN. Two reasons, and the second is the real
 * one. A column would be speculative — the sessional, home-based and hospital-based
 * tables are not transcribed, so knowing the service type would not let this file
 * compute anything new; it would only let it refuse, and refusing for every centre
 * (all of them NULL on the day the column ships) is the blanket unverified notice this
 * file's header already rejects as saying less. And the *values* for such a column are
 * not settled from public sources: the Ministry's licensing page names three licensed
 * types (education and care, home-based, hospital-based) while its regulatory-framework
 * page names four and treats Te Kōhanga Reo as its own, with kindergartens and
 * playcentres folded under centre-based. Both retrieved 2026-09-03. Picking one of
 * those and CHECK-constraining a column to it would be asserting a classification
 * nobody here has verified, which [AGENTS.md §7] forbids by name.
 *
 * So the assumption becomes visible instead of becoming a schema. Naming the schedule
 * costs one sentence in three places that already render this string, and it is true
 * today, whereas a column would be true only after somebody transcribes two more
 * schedules and sources the classification.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function ratioInputCaveat(): string {
  return (
    'Assessed against the all-day centre-based schedule, which is the only one transcribed — a ' +
    'sessional, home-based or hospital-based service is on a different schedule and this figure ' +
    'does not apply to it. ' +
    'Counts children signed in today. Schedule 2 also counts any other person present aged under 6, ' +
    'including a staff member’s own child. An adult does not count while at lunch, on a break or on ' +
    'non-contact time: where this centre counts adults from their own sign-ins, a recorded break is ' +
    'already excluded; where the number is typed in, exclude them as you type it.'
  );
}

/**
 * Assess the room as it stands.
 */
export function assessRatio(input: {
  underTwo: number;
  twoAndOver: number;
  adultsPresent: number;
  underTwoTable?: RatioTable;
  twoAndOverTable?: RatioTable;
}): RatioAssessment {
  const underTable = input.underTwoTable ?? UNDER_TWO_TABLE;
  const overTable = input.twoAndOverTable ?? TWO_AND_OVER_TABLE;

  const underTwo = Math.max(0, Math.trunc(input.underTwo));
  const twoAndOver = Math.max(0, Math.trunc(input.twoAndOver));
  const adultsPresent = Math.max(0, Math.trunc(input.adultsPresent));

  const adultsRequired = adultsRequiredFor(underTwo, twoAndOver, underTable, overTable);

  const shortfall = Math.max(0, adultsRequired - adultsPresent);

  // Would one more child in each band push the requirement up? Both go through the same
  // function as the figure itself, so the mixed-age rule cannot apply to one and not the
  // other — which is how a room reads "at the limit" and then admits a child with no change.
  const oneMoreUnder = adultsRequiredFor(underTwo + 1, twoAndOver, underTable, overTable);
  const oneMoreOver = adultsRequiredFor(underTwo, twoAndOver + 1, underTable, overTable);

  const headroomUnderTwo = headroom(underTwo, underTable);
  const headroomTwoAndOver = headroom(twoAndOver, overTable);

  let status: RatioStatus = 'ok';
  let warning: string | null = null;

  const present = underTwo + twoAndOver;

  if (shortfall > 0) {
    status = 'breach';
  } else if (present > 0 && (oneMoreUnder > adultsPresent || oneMoreOver > adultsPresent)) {
    // `present > 0` matters. An empty room with nobody in it satisfies "one more
    // child would need an adult" trivially, and reporting a closed centre as at the
    // limit is noise that teaches people to ignore the indicator. A warning has to
    // be about a room somebody is standing in.
    // Not a breach. At the limit: the room is legal and the next arrival is not.
    status = 'at-limit';
    const tips: string[] = [];
    if (oneMoreUnder > adultsPresent) tips.push('one more child under 2');
    if (oneMoreOver > adultsPresent) tips.push('one more child aged 2 or over');
    warning = `At the limit — ${tips.join(' or ')} would need another adult.`;
  }

  return {
    underTwo,
    twoAndOver,
    present,
    adultsPresent,
    adultsRequired,
    status,
    shortfall,
    headroomUnderTwo,
    headroomTwoAndOver,
    warning,
    // Only the tables that actually bear on this room. Citing the under-2 rule to a
    // manager whose room has none of them is noise.
    citations: [
      ...(underTwo > 0 ? [underTable.citation] : []),
      ...(twoAndOver > 0 ? [overTable.citation] : []),
    ],
    verified: RATIO_TABLES_VERIFIED,
  };
}

/** How many more children this band takes before the requirement increases. */
function headroom(count: number, table: RatioTable): number {
  const current = requiredAdultsFor(count, table);
  for (const band of table.bands) {
    if (count <= band.upTo && band.adults === current) return band.upTo - count;
  }
  const last = table.bands[table.bands.length - 1];
  if (!last) return 0;

  const over = Math.max(0, count - last.upTo);
  const stepsUsed = Math.ceil(over / table.thereafterPerAdult);
  return last.upTo + stepsUsed * table.thereafterPerAdult - count;
}

/**
 * Split a set of children into the two bands by date of birth.
 *
 * Takes the centre timezone, for the same reason everything else does: a child whose
 * second birthday is today changes band today at the centre, not tomorrow in UTC.
 */
export function splitByAgeBand(
  children: { dateOfBirth: string }[],
  timeZone?: string,
): { underTwo: number; twoAndOver: number } {
  const on = todayInZone(timeZone);
  let underTwo = 0;
  for (const child of children) {
    if (isUnderTwo(child.dateOfBirth, on)) underTwo += 1;
  }
  return { underTwo, twoAndOver: children.length - underTwo };
}
