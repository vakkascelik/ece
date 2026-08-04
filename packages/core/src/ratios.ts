/**
 * Regulated adult-to-child ratios.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE RELYING ON THE NUMBERS
 *
 * `RATIO_TABLES_VERIFIED` below is **false**. The bands encode a good-faith reading
 * of Schedule 2 of the Education (Early Childhood Services) Regulations 2008 for
 * centre-based services, and they have not been checked against the regulation
 * itself by anybody. They are the one part of this product where being approximately
 * right is worse than being obviously unfinished: a ratio display that is confidently
 * wrong tells a manager they are compliant when they are not.
 *
 * So the figures are data with a citation attached, the UI shows that it is
 * unverified while the flag is false, and correcting a band is a one-line change.
 * Confirm them, then flip the flag — do not flip the flag to make the notice go away.
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
 * Has a person checked these against the regulation?
 *
 * Flipping this to `true` is a claim about the law, not about the code. It should be
 * done by someone who has read Schedule 2, in a commit that says so.
 */
export const RATIO_TABLES_VERIFIED = false;

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
    'Education (Early Childhood Services) Regulations 2008, Schedule 2 — centre-based, children under 2. UNVERIFIED.',
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
    'Education (Early Childhood Services) Regulations 2008, Schedule 2 — centre-based, children aged 2 and over. UNVERIFIED.',
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
 * Assess the room as it stands.
 *
 * The two bands are computed separately and summed. That is the conservative reading
 * — Schedule 2 publishes different tables depending on whether under-2s are present
 * at all, and summing never under-staffs relative to a combined table. If the
 * verification pass finds the combined figures are lower, this becomes generous
 * rather than wrong, which is the right direction for the error to run.
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

  const requiredUnder = requiredAdultsFor(underTwo, underTable);
  const requiredOver = requiredAdultsFor(twoAndOver, overTable);
  const adultsRequired = requiredUnder + requiredOver;

  const shortfall = Math.max(0, adultsRequired - adultsPresent);

  // Would one more child in each band push the requirement up?
  const oneMoreUnder = requiredAdultsFor(underTwo + 1, underTable) + requiredOver;
  const oneMoreOver = requiredUnder + requiredAdultsFor(twoAndOver + 1, overTable);

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
