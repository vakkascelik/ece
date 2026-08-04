/**
 * Funded hours, and the RS7 preparation figures.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE RELYING ON THE NUMBERS
 *
 * `FUNDING_RULES_VERIFIED` is **false**. The caps and the funding-period boundaries below are a
 * good-faith reading and **nobody has checked them against the ECE Funding Handbook**. They are the
 * same class of claim as the ratio bands in `ratios.ts`, and the same discipline applies: the
 * figures are data with a stated basis, the flag travels with every calculation, the UI says so,
 * and correcting a cap is a one-line change.
 *
 * There are **no funding rates here at all** — no dollars per child-hour. A rate is a number the
 * Ministry publishes and changes, and inventing one would let a centre budget against a figure this
 * product made up. Rates belong in a fee schedule the centre enters, or nowhere.
 *
 * Confirm the caps and the periods, then flip the flag in a commit that says who read what.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT THIS CANNOT DO, BY DESIGN
 *
 * It cannot submit anything. Submitting a funding return requires being a Ministry-approved student
 * management system integrated with ELI, the Ministry is not accepting integration applications, and
 * approval requires supporting 50 services *before* applying. So the output is a **preparation
 * export**: figures a manager keys into ELI Web themselves.
 *
 * Every label in the product says "preparation", never "return" or "submission", so nobody can
 * believe a return was filed because a screen looked finished.
 */

import { attendedHours, toHours, type HoursEvent } from './hours';

/** Has anybody checked these against the Funding Handbook? Flipping this is a claim about policy. */
export const FUNDING_RULES_VERIFIED = false;

export interface FundingCaps {
  /**
   * Maximum funded hours in one day.
   *
   * Basis: 20 Hours ECE is commonly described as capped at 6 hours per day and 20 per week.
   * **Unverified.**
   */
  maxHoursPerDay: number;
  maxHoursPerWeek: number;
  /** Where these came from, shown wherever the figures are. */
  basis: string;
}

export const DEFAULT_CAPS: FundingCaps = {
  maxHoursPerDay: 6,
  maxHoursPerWeek: 20,
  basis:
    'Commonly stated 20 Hours ECE caps of 6 hours per day and 20 per week. NOT verified against the ECE Funding Handbook.',
};

/**
 * A funding period.
 *
 * Deliberately supplied by the caller rather than computed. The Ministry's funding periods have
 * published boundaries this file does not know, and deriving them from a guess would put a wrong
 * date range on every figure in the export — where it would look authoritative.
 */
export interface FundingPeriod {
  label: string;
  /** Inclusive, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive. */
  to: string;
}

export interface ChildFunding {
  childId: string;
  /** What the child actually attended, from the events. */
  attendedHours: number;
  /**
   * What may be claimed: attended hours with the caps applied, complete days only.
   *
   * Never greater than `attendedHours`, and never includes a day whose record is broken.
   */
  fundedHours: number;
  /** Hours on days that could not be computed. Not claimable until the record is fixed. */
  unresolvedHours: number;
  /** Days needing a human before this child's figure is complete. */
  unresolvedDates: string[];
  /** Days where the daily cap bit, so a manager can see why attended and funded differ. */
  cappedDates: string[];
  twentyHoursEce: boolean;
}

export interface FundingSummary {
  period: FundingPeriod;
  children: ChildFunding[];
  totalFundedHours: number;
  /**
   * True when every child's record is complete for the period.
   *
   * The export leads with this. A summary that looks final while three children have missing
   * sign-outs is a summary that gets keyed into ELI Web.
   */
  complete: boolean;
  unresolvedChildCount: number;
  verified: boolean;
  capsBasis: string;
}

/** ISO week key, so the weekly cap can be applied to the right seven days. */
function isoWeekKey(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d!));
  // Thursday of the same ISO week determines the year and week number.
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Funded hours for one child over one period.
 *
 * Order of operations matters and is the conservative one: compute attended hours, discard days
 * whose record is broken, apply the daily cap, then apply the weekly cap to what survives. Applying
 * the weekly cap first would let an over-long Monday absorb capacity that Tuesday was entitled to.
 */
export function childFunding(input: {
  childId: string;
  events: HoursEvent[];
  timeZone: string;
  period: FundingPeriod;
  twentyHoursEce: boolean;
  caps?: FundingCaps;
}): ChildFunding {
  const caps = input.caps ?? DEFAULT_CAPS;
  const all = attendedHours({ events: input.events, timeZone: input.timeZone });

  const inPeriod = all.days.filter((d) => d.date >= input.period.from && d.date <= input.period.to);
  const complete = inPeriod.filter((d) => d.complete);
  const unresolved = inPeriod.filter((d) => !d.complete);

  const cappedDates: string[] = [];
  const perDay = complete.map((day) => {
    const hours = toHours(day.minutes);
    // Caps apply only to the 20 Hours ECE entitlement. Without the attestation there is nothing
    // here to cap, and pretending otherwise would understate an ordinary fee-paying enrolment.
    if (!input.twentyHoursEce) return { date: day.date, hours };
    if (hours > caps.maxHoursPerDay) {
      cappedDates.push(day.date);
      return { date: day.date, hours: caps.maxHoursPerDay };
    }
    return { date: day.date, hours };
  });

  let fundedHours = 0;
  if (!input.twentyHoursEce) {
    fundedHours = perDay.reduce((t, d) => t + d.hours, 0);
  } else {
    // Weekly cap, per ISO week, on what the daily cap already allowed.
    const byWeek = new Map<string, number>();
    for (const d of perDay) {
      byWeek.set(isoWeekKey(d.date), (byWeek.get(isoWeekKey(d.date)) ?? 0) + d.hours);
    }
    for (const weekHours of byWeek.values()) {
      fundedHours += Math.min(weekHours, caps.maxHoursPerWeek);
    }
  }

  return {
    childId: input.childId,
    attendedHours: toHours(complete.reduce((t, d) => t + d.minutes, 0)),
    // Rounded down again after summing, so the total cannot creep above the sum of its parts.
    fundedHours: Math.floor(fundedHours * 100) / 100,
    unresolvedHours: toHours(unresolved.reduce((t, d) => t + d.minutes, 0)),
    unresolvedDates: unresolved.map((d) => d.date),
    cappedDates,
    twentyHoursEce: input.twentyHoursEce,
  };
}

export function summariseFunding(period: FundingPeriod, children: ChildFunding[]): FundingSummary {
  const unresolvedChildCount = children.filter((c) => c.unresolvedDates.length > 0).length;
  return {
    period,
    children,
    totalFundedHours: Math.floor(children.reduce((t, c) => t + c.fundedHours, 0) * 100) / 100,
    complete: unresolvedChildCount === 0,
    unresolvedChildCount,
    verified: FUNDING_RULES_VERIFIED,
    capsBasis: (children[0] ? DEFAULT_CAPS : DEFAULT_CAPS).basis,
  };
}

/**
 * The sentence at the top of the export.
 *
 * Written here rather than in the page so both the screen and any future emailed version say the
 * same thing — and so the wording is reviewable in one place, because it is the sentence that stops
 * somebody believing a return was filed.
 */
export function exportDisclaimer(summary: FundingSummary): string {
  const parts = [
    'These are preparation figures for keying into ELI Web. Nothing has been submitted to the Ministry, and this system cannot submit.',
  ];
  if (!summary.complete) {
    parts.push(
      `${summary.unresolvedChildCount} ${summary.unresolvedChildCount === 1 ? 'child has' : 'children have'} days that could not be calculated because the attendance record is incomplete. Those days are excluded from the totals below — resolve them and re-run before using these figures.`,
    );
  }
  if (!summary.verified) {
    parts.push(
      'The daily and weekly caps applied here have not been checked against the ECE Funding Handbook.',
    );
  }
  return parts.join(' ');
}
