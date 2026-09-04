/**
 * Funded hours, and the RS7 preparation figures.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE RELYING ON THE NUMBERS
 *
 * `FUNDING_RULES_VERIFIED` is **false**, and what that now covers is narrower than it was.
 *
 * **Confirmed 2026-08-18** against the Ministry's ELI data collection business rules and the RS7
 * return specification, both supplied by the Ministry: the age band (3 or older, under 6) and the
 * three four-monthly funding periods in `ministryFundingPeriods`.
 *
 * **And the caps, which that reading got half right — corrected 2026-09-04 from §9-2 and §9-3.**
 * It recorded "the 20 Hours ECE caps of 6 hours per day and 20 per week" as one pair. They are two:
 * the **subsidy** runs to 6 a day and **30** a week for every child, and 20 a week is the cap on the
 * 20 Hours ECE *component* inside it, the remainder being Plus 10. Conflating them under-claimed
 * hours 20-30 for an attested child and, because the caps were gated on the attestation, applied no
 * cap at all to an unattested one. Both fixed in this file as of 2026-09-04.
 *
 * **Read 2026-08-18, and now a known gap rather than an unknown one.** Chapter 6 of the Funding
 * Handbook — sections 6-4, 6-5 and 6-7 — says absence funding is real:
 *
 *   6-4  Funding may be claimed for hours a **permanently enrolled** child did not attend, if the
 *        absence falls under one of the absence rules. For a **casual or conditional** child,
 *        funding is on attendance ONLY, and a booked no-show must not be claimed. AND — added
 *        2026-09-03, it was missing here though `funding-and-billing.md` had it — a service may
 *        **not** claim for both an absent permanent child under an absence rule and the casual or
 *        conditional child who fills that child's place. That one is not a per-child rule at all:
 *        it is about two children competing for one place, and `childFunding` below takes a single
 *        child and cannot see the others. Implementing absence funding per child, which is the
 *        obvious shape, would breach it and **over-claim** — the direction `exportDisclaimer`
 *        currently promises is impossible.
 *   6-5  Three Week Rule: claim every enrolled-but-absent session within three weeks of the FIRST
 *        day of absence. Nothing from the fourth week on. Funding resumes when the child returns,
 *        and stops the moment a parent says the child is not coming back — even mid-window, or the
 *        Ministry recovers it.
 *   6-6  Extension for extended non-operation. **Added 2026-09-03: this rule was never
 *        transcribed, while the disclaimer string below has always said "sections 6-4 to 6-7" —
 *        which reads as four rules read where three were.** A service not operating for a
 *        continuous two weeks or more SUSPENDS the Three Week Rule on the child's last session
 *        before closing, and restarts it on the first day they are enrolled to attend after
 *        re-opening. Christmas, end of term and closure for renovations are the Handbook's own
 *        examples. So the window is not three calendar weeks: a naive date window would expire
 *        over the Christmas break and stop funding a child whose entitlement is suspended rather
 *        than spent. Absence spells therefore need the centre's operating calendar, which is what
 *        `EceServiceClosure` wants and what `booking_status = 'closed'` does not give — that is
 *        per child-day, a different statement.
 *   6-7  Frequent Absence Rule: attendance must match the enrolment agreement for at least half of
 *        each calendar month. Flagged in month 1, reconfirmed in month 2, month 3 claimable only if
 *        reconfirmed, month 4 not claimable and the agreement must change. "Reconfirmed" is **not
 *        a boolean** (transcribed 2026-09-03): either the agreement is signed and dated by the
 *        parent or guardian confirming it remains valid, or it is changed to new days and times
 *        and signed. A dated act by a named person, like the 20 Hours attestation.
 *
 * **This file claims none of it, and cannot yet.** Funded hours come from attendance events, so an
 * absent day contributes zero. Two things follow, and the second is why the gap is not a bug here:
 *
 * - For a casual or conditional child, attendance-only is **exactly what 6-4 requires**. This
 *   calculation is already correct for them.
 * - For a permanently enrolled child it **under-claims**, and losing a centre funding it is owed is
 *   the same class of failure as over-claiming — it is the reason a broken day is named rather than
 *   silently zeroed.
 *
 * ~~The blocker is the schema, not the arithmetic: `enrolments` has no permanent/casual
 * distinction, and 6-4 turns on exactly that.~~
 *
 * **HALF THAT BLOCKER WENT ON 2026-09-03 — `0084`.** `enrolments.enrolment_type` now holds
 * `permanent`, `casual` or `conditional`, transcribed from §6-4 itself, with a CHECK refusing a
 * fourth value and `ENROLMENT_TYPES` in `./children` as the single source. So the question §6-4
 * asks can now be asked of a row.
 *
 * **NULL IS NOT `permanent`, and every reader of this column has to honour that.** Each enrolment
 * filed before `0084` is not-stated, and `createEnrolment` writes null rather than defaulting.
 * Absence funding may only be claimed for a *permanently* enrolled child, so treating an unknown
 * as permanent would claim for children nobody has classified — **over**-claiming, the one
 * direction `exportDisclaimer` promises these figures never go.
 *
 * What is still missing, and it is more than an enrolment type:
 *
 *   - A three-week window per absence spell (§6-5), which needs `bookings` grouped into spells.
 *   - **The suspension of that window while the service is closed for two continuous weeks or
 *     more (§6-6).** Read 2026-09-03; it was not in this header before, while the disclaimer
 *     string below has always said "sections 6-4 to 6-7". A window measured in calendar dates
 *     would expire over the Christmas break and stop funding a child whose entitlement is
 *     *suspended*, not spent — so a spell needs the centre's operating calendar, which nothing
 *     records. `booking_status = 'closed'` is per child-day, a different statement.
 *   - A monthly frequent-absence check comparing attendance against the **enrolment agreement**
 *     (§6-7) — an effective-dated weekday pattern that does not exist. `bookings` is one row per
 *     calendar date with no pattern; ELI calls the missing thing `ChildBookingSchedule`.
 *   - A reconfirmation record, which is **not a boolean**: §6-7 wants the agreement "signed and
 *     dated by the child's parent/guardian", or changed to new days and times and signed. A dated
 *     act by a named person.
 *
 * AND ONE RULE THAT BREAKS THE SHAPE OF THIS FILE, not just its inputs. §6-4: "Funding must not be
 * claimed for both an absent permanently enrolled child under an absence rule and for the
 * conditional or casual child who fills the absent child's place." `childFunding` below takes ONE
 * child and cannot see the others. That rule is about two children competing for one place, so the
 * obvious per-child implementation of absence funding would breach it and over-claim. Design
 * against it before writing any of the three rules.
 *
 * **The flag stays `false` for that reason**, and it is now precise about why: the rules are read,
 * the caps and periods are confirmed, and a whole class of claimable day is not implemented. A flag
 * reading "verified" over that would be worse than one that says nothing — the same discipline as
 * the ratio bands in `ratios.ts`.
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
 * management system integrated with ELI, and this product is not one. So the output is a
 * **preparation export**: figures a manager keys into ELI Web themselves.
 *
 * CORRECTED 2026-09-02: this comment said "the Ministry is not accepting integration applications
 * — confirmed by the Ministry on 2026-08-18 as still under review, with no published end date."
 * That was true when written and is now false. The review concluded and the Ministry's page, last
 * updated 2026-09-01, opens a 2026 tranche closing 5pm Friday 30 October 2026 with **one** place
 * available, decided on a readiness assessment. What has not changed is the sentence above it:
 * this product cannot submit, because it is not an approved SMS and would not become one for
 * 12–18 months after being selected. See docs/eli-integration-2026-tranche.md.
 *
 * CORRECTED 2026-08-18: this comment used to add "and approval requires supporting 50 services
 * *before* applying". That is wrong. The requirement is that the product be *capable* of supporting
 * 50 services across the licence types, not that fifty already use it. Left visible rather than
 * deleted because the customer-count reading is what put an ELI integration in the roadmap's
 * "deliberately not doing this" list. See llm-wiki/wiki/funding-and-billing.md.
 *
 * Every label in the product says "preparation", never "return" or "submission", so nobody can
 * believe a return was filed because a screen looked finished.
 */

import {
  assessFrequentAbsence,
  classifyAbsences,
  type EnrolledSession,
  type FrequentAbsenceMonth,
} from './absence';
import { ageInMonths, type EnrolmentType } from './children';
import type { ServiceClosure } from './closures';
import { attendedHours, toHours, type HoursEvent } from './hours';

/**
 * WHICH FUNDING RULES HAVE BEEN READ, ONE FLAG EACH.
 *
 * Replaces a single boolean on 2026-09-04, for the reason `ratios.ts` learned a day earlier:
 * **one flag cannot say which rules were checked**, and a reader takes `false` as "nothing is
 * verified" or `true` as "everything is". Neither was true here — the caps and the age band
 * were confirmed on 2026-08-18 and absence funding has never been implemented, and one boolean
 * had to represent both.
 *
 * Each entry carries the source that would have to be re-read to change it. Flipping one is a
 * claim about policy, not about code, and belongs in a commit that records who read what.
 */
export const FUNDING_RULES = {
  /** 6 hours a day. Confirmed twice, and the second reading changed the weekly figure — see below. */
  dailyCap: {
    verified: true,
    source:
      'Handbook §9-2, read 2026-09-04: "a maximum of 6 hours can be claimed each day for each licensed child-place". Also §9-3: "A maximum of 6 hours per day and 30 hours per week of funding can be claimed per child."',
  },
  /**
   * The 20 Hours ECE component's weekly cap. Verified — this is the one number the old single
   * flag was actually about.
   */
  twentyHoursWeeklyCap: {
    verified: true,
    source:
      'Handbook §9-3, read 2026-09-04: "20 Hours ECE hours must only be claimed for up to 20 hours per week for each child."',
  },
  /** 3 or older and under 6. */
  ageBand: {
    verified: true,
    source:
      "Ministry ELI data collection business rules, 2026-08-18. Handbook ch. 4: eligibility begins on a child's third birthday.",
  },
  /** February, June and October. Two independent sources, which is rare here. */
  periods: {
    verified: true,
    source:
      'Ministry RS7 Return Specification 6.0, 2026-08-18, corroborated by the public XSD\'s RS7PeriodStartDate pattern "[0-9]{4}-(02|06|10)-01".',
  },
  /**
   * **NOT IMPLEMENTED.** The subsidy runs to 30 hours a week and this file caps at 20.
   */
  subsidyWeeklyCapAndPlusTen: {
    verified: true,
    source:
      'Handbook §9-2 ("to a maximum of 30 FCHs per child-place per week") and §9-3 ("The remainder (up to 30 hours) may be claimed as Plus 10 ECE hours"). Read 2026-09-04 and implemented the same day: the subsidy caps at 6/day and 30/week for EVERY child, and an attested child\'s week splits into twentyHoursHours (up to 20) and plusTenHours (the rest).',
  },
  /**
   * **IMPLEMENTED WHERE THE INPUT EXISTS, and still false. Both halves matter.**
   *
   * §9-2 step 1 now drives a permanently enrolled child's figure from the agreement, when a
   * `child_booking_schedule` exists for them. Where none does, the figure still starts from
   * attendance and under-claims — and `hoursBasis` says which of the four situations produced
   * every number, because two of them look identical in the digits.
   *
   * Why it stays `false`: the flag answers "is this rule implemented", and the honest answer for
   * a service that has recorded no days and times is still no. Flipping it would put a
   * green tick on a screen for centres whose figures are known to be too low.
   */
  hoursSource: {
    verified: false,
    source:
      'Handbook §9-2, read 2026-09-04: for a permanently enrolled child, "List the daily number of hours of ENROLMENT"; for a casual or conditional child, "list the number of hours each of these children ATTENDED". Implemented 2026-09-04 for a permanent child with a recorded booking schedule; a permanent child without one still yields the attendance figure, reported as hoursBasis "attendance-no-agreement".',
  },
  /**
   * **PARTLY IMPLEMENTED**, and false for one thing only — which is why the source string names
   * it rather than leaving a reader to assume none of it works.
   *
   * Implemented: §6-5's three-week window, §6-6's suspension across a closure of two weeks or
   * more, §7-7's twelve-week window, §6-5's stop on notice, and §6-7's monthly frequent-absence
   * check with its three triggers and its four-month timeline.
   *
   * **§6-4's cross-child rule is DETECTED but not DEDUCTED** — `sixFourOverlaps` names the days a
   * place is claimed twice, the hours, and which side §7-7 says goes ("another child may attend
   * the absent child's place without claiming funding for that replacement child"). It changes no
   * figure, because a trim propagates into RS7's age-band and 20 Hours splits and because which
   * casual child among several loses their hours is not something the Handbook decides.
   *
   * **So this stays `false`, and the reason is now precise:** the figures this file produces can
   * still claim one place twice, and the correction is a sentence on a screen rather than
   * arithmetic. A flag that went true while `fundedHours` contained a known double-claim would be
   * the exact failure this structure exists to prevent.
   */
  absence: {
    verified: false,
    source:
      'Handbook §6-4 to §6-7, read 2026-09-03/04, and §6-8\'s worked examples read 2026-09-04. §9-2 confirms they are not optional for the return: services "must take into account the Three Week Rule and Frequent Absence Rule when completing your RS7 Return". §6-5, §6-6, §6-7 and §7-7 are implemented and mutation-tested; §6-4\'s rule against claiming for both an absent permanent child and the casual child filling their place is NOT, because it cannot be answered per child.',
  },
  /** **NOT IMPLEMENTED**, and only half-read: one worked example, not the rule behind it. */
  sessionalRounding: {
    verified: false,
    source:
      'Handbook §9-2, read 2026-09-04, gives an example and not a rule: "A session of 2.5 hours will receive funding for 3 hours." Whether that generalises to rounding every session up to the whole hour, or is specific to a session length, has NOT been established. `centres.service_model` (0083) now records which services are sessional, so the input exists.',
  },
  /**
   * **NOT IMPLEMENTED.** And note what is being rounded: the daily TOTAL across children, not
   * each child's hours.
   */
  rs7Rounding: {
    verified: false,
    source:
      'Handbook §9-2, read 2026-09-04: "Round the total to the nearest whole number. Numbers ending in 0.5 or above should be rounded up to the next whole number. Numbers ending in 0.4 or below should be rounded down to the previous number." `toHours` floors, deliberately, and must not be reused for this — unverified-claims item 52.',
  },
} as const;

/**
 * Has EVERY funding rule been checked and implemented?
 *
 * Kept as a boolean because the screen and the export disclaimer branch on it, and because
 * "some of it" is not a thing a manager keying a figure into ELI Web can act on. It is a
 * roll-up of `FUNDING_RULES` rather than a separate assertion, so it cannot drift from the
 * detail the way a hand-maintained boolean did.
 */
export const FUNDING_RULES_VERIFIED: boolean = Object.values(FUNDING_RULES).every(
  (rule) => rule.verified,
);

export interface FundingCaps {
  /**
   * Maximum funded hours in one day, for EVERY child.
   *
   * Source: Handbook §9-2, read 2026-09-04 — *"a maximum of 6 hours can be claimed each day for
   * each licensed child-place"* — and §9-3, *"A maximum of 6 hours per day and 30 hours per week
   * of funding can be claimed per child."*
   *
   * ~~Note the two sections state the unit differently … the discrepancy is recorded rather than
   * resolved by picking one.~~
   *
   * **RESOLVED 2026-09-04 by the Handbook's own Glossary, and §9-2 was the accurate one.** A
   * funded child hour is *"an **occupied child-place** that is funded for 1 hour"*, and a
   * child-place is *"each place for a child for which a service is licensed. Child-places may
   * only be used by 1 child at a time but **may be used by more than 1 child during the course
   * of a day**."*
   *
   * So the cap is **per licensed place, per day** — not per child. §9-3's "per child" is loose
   * phrasing of the same rule.
   *
   * **THIS FILE APPLIES IT PER CHILD, WHICH IS THE WRONG UNIT, AND IT OVER-STATES IN AGGREGATE.**
   * Two children each attending four hours may share one child-place: eight hours occupied on a
   * place that can yield six. Per child this file claims 4 + 4 = 8. That is two hours nobody was
   * entitled to, and it is invisible from inside a per-child calculation because `childFunding`
   * receives one child and cannot see the other.
   *
   * The approximation is exact for an all-day service where each child holds a place for the day,
   * and wrong for a sessional one where a morning child and an afternoon child share it — which
   * is precisely the service model `centres.service_model` (0083) now records.
   *
   * Not fixed here, because it is not a constant to change: the calculation has to move from
   * per-child to per-place-per-day, and the denominator (`centres.licensed_places`, 0050) is
   * nullable and is not even read by `readFundingPeriod`. See unverified-claims item 57, and note
   * that §6-4's cross-child rule points at the same restructuring.
   */
  maxHoursPerDay: number;
  /**
   * Maximum funded hours in one ISO week, for EVERY child — the **ECE Funding Subsidy** cap.
   *
   * **Was 20 until 2026-09-04, and that was two defects in one number.** 20 is the cap on the
   * 20 Hours ECE *component*; the subsidy runs to 30. So hours 20–30 were discarded for an
   * attested child (an under-claim), and because the caps were gated on the attestation they were
   * not applied at all to an unattested one (an over-statement). See `twentyHoursWeeklyCap` for
   * the component and unverified-claims items 54 and 6.
   */
  maxHoursPerWeek: number;
  /**
   * The 20 Hours ECE component's own weekly cap, inside `maxHoursPerWeek`.
   *
   * Source: Handbook §9-3 — *"20 Hours ECE hours must only be claimed for up to 20 hours per week
   * for each child"* — and, for the remainder, *"The remainder (up to 30 hours) may be claimed as
   * Plus 10 ECE hours."*
   *
   * So for an attested child a week's funded hours split in two: up to 20 as 20 Hours ECE, the
   * rest up to 30 as Plus 10. RS7 asks for both by name, `TwentyHoursFundedChildCount` and
   * `TwentyHoursFundedChildPlusTenCount`.
   */
  twentyHoursWeeklyCap: number;
  /** Where these came from, shown wherever the figures are. */
  basis: string;
}

export const DEFAULT_CAPS: FundingCaps = {
  maxHoursPerDay: 6,
  maxHoursPerWeek: 30,
  twentyHoursWeeklyCap: 20,
  basis:
    'ECE Funding Subsidy: 6 hours a day and 30 a week per child, of which up to 20 a week may be claimed as 20 Hours ECE for a child aged 3 or older and under 6 — the remainder is Plus 10. Ministry of Education ECE Funding Handbook §9-2 and §9-3, read 2026-09-04.',
};

/**
 * The 20 Hours ECE age band, in whole months.
 *
 * The entitlement runs from a child's third birthday to their sixth: "3 years or older but less
 * than 6 years old". The Ministry states this as a business rule it checks automatically and raises
 * with vendors, which is what makes it worth enforcing here rather than trusting the tick box.
 *
 * Months rather than years because `ageInMonths` does calendar arithmetic and a birthday must land
 * on the day it falls, not somewhere inside a rounding error.
 */
const TWENTY_HOURS_MIN_MONTHS = 36;
const TWENTY_HOURS_MAX_MONTHS = 72;

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

/**
 * Where a child's funded hours came from — §9-2's two steps, plus the two ways of not knowing.
 *
 * Four states rather than a boolean, because they are different facts rather than degrees of
 * one. Two are correct by the Handbook and two under-claim, and a readiness surface has to be
 * able to tell a service which of those it is looking at.
 */
export type HoursBasis =
  /**
   * §9-2 step 1, for a permanently enrolled child: *"List the daily number of hours of
   * **enrolment**"*. The agreement is the source and the absence rules decide how much of it
   * survives. This is the only basis that can claim an absence.
   */
  | 'agreement'
  /**
   * §9-2 step 2, and **correct rather than a fallback**: *"If any children … attended the
   * service on a casual or conditional basis, list the number of hours each of these children
   * **attended**."* For these children attendance IS the rule, and §6-4 is explicit that a
   * casual child who books and does not turn up must never be claimed.
   */
  | 'attendance'
  /**
   * A permanently enrolled child with no booking-schedule blocks. Attendance is all there is,
   * and it **under-claims** — the child may have claimable absences nobody can compute. Every
   * existing child is in this state, because `child_booking_schedule` ships empty.
   */
  | 'attendance-no-agreement'
  /**
   * `enrolments.enrolment_type` is null. Not stated is **not** permanent — §6-4 lets only a
   * permanent child be claimed for absences, so assuming permanent would over-claim, which is
   * the one direction these figures promise they never go. Under-claims deliberately.
   */
  | 'attendance-type-not-stated';

/** An enrolled session the absence rules refused, with the Handbook's reason. */
export interface UnclaimableAbsence {
  date: string;
  hours: number;
  reason: string;
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
  /**
   * Of `fundedHours`, the part claimable as **20 Hours ECE** — up to 20 in an ISO week.
   *
   * Zero for a child with no attestation, who has no 20 Hours component at all. Source: §9-3,
   * *"20 Hours ECE hours must only be claimed for up to 20 hours per week for each child"*.
   */
  twentyHoursHours: number;
  /**
   * Of `fundedHours`, the part claimable as **Plus 10** — the week's funded hours above 20.
   *
   * §9-3: *"The remainder (up to 30 hours) may be claimed as Plus 10 ECE hours."* Zero for an
   * unattested child. `twentyHoursHours + plusTenHours` equals `fundedHours` for an attested
   * child, and both are zero for an unattested one, whose whole figure is subsidy.
   *
   * RS7 asks for these two separately, `TwentyHoursFundedChildCount` and
   * `TwentyHoursFundedChildPlusTenCount`, which is why they are carried rather than derived at
   * the call site.
   */
  plusTenHours: number;
  /**
   * Daily-capped hours per date — **before the weekly cap**, and the name says so on purpose.
   *
   * Exposed for one reason: the licensed-place cap is a **daily** constraint (6 funded child
   * hours per child-place per day), so checking it needs each date's hours across every child.
   * See `placeCapExceedances`.
   *
   * WHY NOT "FUNDED HOURS PER DATE", WHICH IS WHAT A READER WILL WANT. Because that quantity is
   * not defined by anything read so far. When the **weekly** cap bites — a week's daily-capped
   * hours exceeding 30 — the Handbook states the maximum and does not say which days lose the
   * excess. Allocating it would be inventing an attribution rule and then reporting per-date
   * figures derived from the invention.
   *
   * So `sum(dailyCappedByDate)` equals `fundedHours` **only when no week was capped**. That is an
   * uncomfortable invariant and it is the honest one: the daily figures are exact, the weekly
   * total is exact, and the split of a weekly reduction across days is unknown. A single
   * `fundedByDate` would have hidden that behind a plausible number.
   */
  dailyCappedByDate: Record<string, number>;
  /** Days where the daily cap bit, so a manager can see why attended and funded differ. */
  cappedDates: string[];
  /**
   * Days this child was attested for 20 Hours ECE and was outside the 3-to-under-6 band.
   *
   * **The hours are still counted.** Two reasons, and the second is the one that decides it: the
   * hours are not in doubt — only the entitlement is — so excluding them would be the estimating
   * this file exists not to do; and the attestation belongs to the centre, which is the party that
   * can fix it. So this names the problem and leaves the arithmetic alone, the same way a capped
   * day is reported rather than silently trimmed.
   *
   * Empty when the child has no date of birth, which is not the same as "eligible" — it means no
   * check was possible. An attested child with no date of birth is an enrolment somebody has not
   * finished, and it shows up as that on the child's record rather than as a funding figure.
   */
  ineligibleDates: string[];
  twentyHoursEce: boolean;

  /**
   * Which of §9-2's sources produced `fundedHours`. Never inferred by a caller from the other
   * fields: two of the four states look identical in the numbers and differ only in whether
   * the figure is right.
   */
  hoursBasis: HoursBasis;

  /**
   * The part of `fundedHours` that came from enrolled-but-absent sessions. Always 0 on any
   * attendance basis, because only a permanently enrolled child with an agreement can claim an
   * absence at all.
   *
   * Separated because it is the figure an auditor asks about first, and because a service
   * looking at a number larger than last month deserves to know which half moved.
   */
  absenceHours: number;

  /**
   * The enrolment type this figure was computed for, echoed back.
   *
   * Needed because §6-4 distinguishes **casual** from **conditional**, and `hoursBasis` collapses
   * both into `attendance`. The Glossary makes that distinction load-bearing: a conditional
   * enrolment is *"above the service's licensed maximum number of child-places"*, so a conditional
   * child who attends is by definition occupying a place they do not hold, and a casual child may
   * not be.
   */
  enrolmentType: EnrolmentType | null;

  /**
   * Claimed absence hours by date — the absence half of `dailyCappedByDate`.
   *
   * Added for §6-4's cross-child pass, which has to ask "was an absence claimed on this day"
   * about a specific date rather than about the period. `absenceHours` is the period total and
   * cannot answer it.
   *
   * Uncapped, deliberately: these are the hours the agreement says, before the daily cap trims
   * them, because §6-4 is about whether a place was claimed twice and not about how much of it
   * survives the cap. A caller comparing this against `dailyCappedByDate` will find days where
   * this is larger, and that is correct.
   */
  absenceHoursByDate: Record<string, number>;

  /** Enrolled sessions the absence rules refused, each with the reason. */
  unclaimableAbsences: UnclaimableAbsence[];

  /**
   * §6-7 month by month — the Frequent Absence Rule's verdict on each calendar month the period
   * touches, with the triggers that fired and anything that could not be assessed.
   *
   * Returned even where every month is claimable, because "no month triggered" and "§6-7 was
   * never applied" are different statements and a caller cannot tell them apart from
   * `unclaimableAbsences` alone. Empty only on an attendance basis, where §6-7 has no agreement
   * to compare attendance against.
   */
  frequentAbsence: FrequentAbsenceMonth[];

  /**
   * Days the child attended that the agreement does not cover.
   *
   * REPORTED AND NEVER CLAIMED. §9-2 step 1 says to list the hours of *enrolment*, so extra
   * attendance by a permanent child is not claimable on that basis — and whether it should be
   * is not something this module gets to decide. A service seeing these dates can change the
   * agreement, which is what §6-7 asks for when attendance stops matching it. Empty on any
   * attendance basis, where the question does not arise.
   */
  attendedOutsideAgreement: string[];
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
  /**
   * Children attested for 20 Hours ECE on at least one day they were outside the age band.
   *
   * Separate from `complete`, because it is a different kind of problem: an incomplete record
   * cannot be calculated, while this one calculates fine and may not be claimable. Folding it into
   * `complete` would either block an export over somebody else's tick box or hide it entirely.
   */
  ineligibleChildCount: number;
  /**
   * The first day this centre has any attendance record for, in its own timezone.
   *
   * Null means either "no attendance events at all" or "the caller did not supply it" —
   * `periodPrecedesRecord` is what tells those apart, and it is the field to read.
   */
  recordStartsOn: string | null;
  /**
   * Does this period begin before the attendance record does?
   *
   * **Three states, and null is not false.** `true` = the record does not cover the whole
   * period. `false` = it does. `null` = nobody said, so nothing is claimed either way — the
   * `overdue: null` contract from `drillStatuses`, and it must render differently from `false`.
   *
   * WHY THIS EXISTS, AND IT IS NOT A HYPOTHETICAL
   *
   * `childFunding` filters a child's days into `complete` and `unresolved`. A child with **no
   * attendance rows at all** in the period yields an empty `inPeriod`, so both lists are empty:
   * `fundedHours` is 0 and `unresolvedDates` is `[]`. `unresolvedChildCount` is therefore 0 and
   * `complete` is **true**. The period reports zero hours and declares itself final.
   *
   * That is correct arithmetic on the rows that exist and a false picture of the period. The
   * "excluded and named" treatment this file insists on for a *broken* day cannot fire, because
   * a period with no records is not a broken record — it is silence, and silence reads as zero.
   *
   * It bites the moment a centre starts using this product partway through a funding period,
   * which every centre does exactly once, and RS7 periods are four-monthly.
   *
   * WHY IT IS NOT FOLDED INTO `complete`
   *
   * The same argument `ineligibleChildCount` above makes for itself: it is a different kind of
   * problem. An incomplete record cannot be calculated; this one calculates fine over a period
   * the records do not cover. Folding it in would overload one boolean with two failures that
   * need different actions — fix the record, versus do not use this period at all.
   */
  periodPrecedesRecord: boolean | null;
  verified: boolean;
  capsBasis: string;

  /**
   * How many children in this period were funded from each of §9-2's sources.
   *
   * ON THE SUMMARY RATHER THAN DERIVED BY THE CALLER, because `exportDisclaimer` needs it and a
   * disclaimer computed from a field somebody forgot to pass is a disclaimer that quietly stops
   * appearing. Every key is always present, so a caller reading `agreement` gets 0 rather than
   * `undefined` when nobody is on it.
   *
   * The reason this exists at all: the paragraph a manager reads before keying a figure into a
   * Crown system used to be able to say one thing about the whole period. It cannot any more —
   * a period can mix children funded from their agreement with children funded from attendance,
   * and those two carry **opposite** risks.
   */
  basisCounts: Record<HoursBasis, number>;
}

/**
 * When this centre's attendance record begins.
 *
 * A parameter object rather than a bare `string | null`, so the two nulls stay apart at the call
 * site: not passing this at all means "unknown", while passing `{ startsOn: null }` means "there
 * are no attendance events" — a much stronger statement, and the worse of the two.
 */
export interface AttendanceRecordStart {
  /**
   * The earliest attendance event for the centre, as a calendar date in the centre's timezone.
   * `null` when the centre has no attendance events at all, which makes every period precede it.
   */
  startsOn: string | null;
}

/**
 * ISO week key, so the weekly cap can be applied to the right seven days.
 *
 * Buckets the same seven days as `mondayOf` in `weekdayBlock.ts`, which is where the shared
 * weekday arithmetic now lives, but returns `2026-W36` rather than the Monday. Left as it is on
 * purpose: the weekly cap is built on this shape and re-bucketing a cap is not a side errand.
 * **Do not write a fifth copy** — if you need the Monday, import it from there.
 */
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
  /** Needed only to check the 20 Hours age band. Null means the check cannot run — see `ineligibleDates`. */
  dateOfBirth?: string | null;
  caps?: FundingCaps;

  /**
   * `permanent`, `casual`, `conditional`, or null for not stated (`0084`). Optional so that no
   * existing caller changes behaviour by upgrading — omitting it yields
   * `attendance-type-not-stated`, which is what an unclassified child honestly is.
   */
  enrolmentType?: EnrolmentType | null;

  /**
   * The agreement, for §9-2 step 1. Build `sessions` with `enrolledSessions()`, which already
   * excludes days the service was closed.
   *
   * ONLY CONSULTED FOR A PERMANENTLY ENROLLED CHILD. Passing it for a casual child is not an
   * error and is ignored, because §9-2 step 2 and §6-4 both say attendance is the rule for
   * them — silently switching them to the agreement would claim for a casual child who booked
   * and did not turn up, which §6-4 says is recovered in an audit.
   *
   * A session counts as attended if the child was present at all, including on a day whose
   * attendance record is incomplete: the child was there, and a broken sign-out does not change
   * what the agreement entitled them to. That is the caller's decision when it builds
   * `attendedDates`, and it is why the agreement basis is less sensitive to a broken record
   * than the attendance basis is.
   */
  agreement?: {
    sessions: readonly EnrolledSession[];
    closures: readonly ServiceClosure[];
    isExemptOn?: (date: string) => boolean;
    noticeGivenOn?: string | null;
    /**
     * `centres.service_model === 'sessional'` (0083). §6-7's third trigger *"excludes sessional
     * services"*, and null — not recorded — makes that trigger unassessable rather than absent.
     */
    isSessionalService?: boolean | null;
    /**
     * Dates from `enrolment_reconfirmations` (0092) **for this enrolment**. What unlocks a
     * third-month claim, and 0092 keys on the enrolment precisely so a reconfirmation of an
     * earlier agreement cannot unlock a later one.
     */
    reconfirmedOn?: readonly string[];
  } | null;
}): ChildFunding {
  const caps = input.caps ?? DEFAULT_CAPS;
  const all = attendedHours({ events: input.events, timeZone: input.timeZone });

  const inPeriod = all.days.filter((d) => d.date >= input.period.from && d.date <= input.period.to);
  const complete = inPeriod.filter((d) => d.complete);
  const unresolved = inPeriod.filter((d) => !d.complete);

  const cappedDates: string[] = [];
  const ineligibleDates: string[] = [];

  /*
    ═══════════════════════════════════════════════════════════════════════════
    §9-2's TWO SOURCES, AND THE TWO WAYS OF NOT KNOWING — added 2026-09-04

    Step 1, for a permanently enrolled child: "List the daily number of hours of ENROLMENT".
    Step 2, separately, for casual and conditional children: the hours each "ATTENDED".

    This function used attended hours for both until today, which is exactly right for a casual
    child and UNDER-CLAIMS for a permanent one — unverified-claims item 55. Nothing below changes
    the result for a caller that passes no agreement, and no caller passes one yet, so no
    published figure moves in this commit.

    WHY NOT "ATTENDANCE PLUS CLAIMABLE ABSENCES". The two agree when a child attends exactly as
    enrolled, and the derivation is what an auditor follows: starting from the agreement and
    deducting what the absence rules refuse is not the same computation as starting from the
    turnstile and adding what they allow. They diverge the moment a child attends MORE than the
    agreement — which is why those days are reported and never folded in.
  */
  const permanent = input.enrolmentType === 'permanent';
  const agreement = permanent ? (input.agreement ?? null) : null;
  const useAgreement = agreement !== null && agreement.sessions.length > 0;

  let hoursBasis: HoursBasis;
  let sourceDays: { date: string; minutes: number }[];
  let absenceMinutes = 0;
  const unclaimableAbsences: UnclaimableAbsence[] = [];
  const absenceHoursByDate: Record<string, number> = {};
  let frequentAbsence: FrequentAbsenceMonth[] = [];
  let attendedOutsideAgreement: string[] = [];

  if (useAgreement) {
    hoursBasis = 'agreement';
    sourceDays = [];
    const rows = classifyAbsences({
      sessions: agreement.sessions,
      closures: agreement.closures,
      isExemptOn: agreement.isExemptOn,
      noticeGivenOn: agreement.noticeGivenOn,
    });

    /*
      §6-7 ON TOP OF §6-5, AND IT REFUSES A MONTH RATHER THAN A SESSION.

      Two rules over the same sessions, and they are not redundant: §6-5 asks how long this spell
      has run, §6-7 asks whether the agreement still describes this child. Every absence in a
      month can sit comfortably inside its three-week window and still be a pattern the Handbook
      refuses by the third month.

      **It refuses ABSENCES, not the month.** §6-7's sentences are about *"funding for absences
      in the third month"* and, for the fourth, that they *"must not be claimed"*. Hours the
      child actually attended are not in scope, so a refused month still funds every day the
      child was there. Reading it as a blanket month refusal would withhold funding for
      attendance nobody disputes.

      The attended minutes come from the same `attendedHours()` days this function already
      computed, so §6-7's third trigger is answerable without the caller assembling it twice —
      and an incomplete day arrives as `null`, which the assessment reports as a gap rather than
      counting as a shortfall.
    */
    const attendedMinutesByDate = new Map(
      inPeriod.map((day) => [day.date, day.complete ? day.minutes : null]),
    );
    frequentAbsence = assessFrequentAbsence({
      sessions: agreement.sessions.map((session) => ({
        ...session,
        attendedMinutes: session.attended
          ? (attendedMinutesByDate.get(session.date) ?? null)
          : 0,
      })),
      closures: agreement.closures,
      isSessionalService: agreement.isSessionalService ?? null,
      reconfirmedOn: agreement.reconfirmedOn,
    });
    const monthRefusedBy = new Map<string, string>();
    for (const month of frequentAbsence) {
      if (!month.claimable && month.reason !== null) monthRefusedBy.set(month.month, month.reason);
    }

    for (const row of rows) {
      if (!row.absent) {
        // Present, so the enrolled hours stand — not the attended hours. §9-2 asks for the
        // hours of enrolment, and a child collected an hour early was still enrolled for it.
        sourceDays.push({ date: row.date, minutes: row.minutes });
      } else if (row.claimable && !monthRefusedBy.has(row.date.slice(0, 7))) {
        sourceDays.push({ date: row.date, minutes: row.minutes });
        absenceMinutes += row.minutes;
        absenceHoursByDate[row.date] = toHours(row.minutes);
      } else if (row.claimable) {
        // Inside §6-5's window, and refused by §6-7 anyway. The reason names the month rule, not
        // the window, because a service told "past the three-week window" about a day that is
        // three days into a spell would go looking for the wrong mistake.
        unclaimableAbsences.push({
          date: row.date,
          hours: toHours(row.minutes),
          reason: monthRefusedBy.get(row.date.slice(0, 7)) as string,
        });
      } else {
        unclaimableAbsences.push({
          date: row.date,
          hours: toHours(row.minutes),
          reason: row.reason ?? 'refused by the absence rules',
        });
      }
    }
    /*
      Attendance the agreement does not cover — reported, never claimed. Both complete and
      unresolved days are included: an extra day with a broken sign-out is still an extra day,
      and leaving it out would mean a second fault is what hides the first.
    */
    const enrolledDates = new Set(rows.map((r) => r.date));
    attendedOutsideAgreement = inPeriod
      .filter((d) => !enrolledDates.has(d.date))
      .map((d) => d.date);
  } else {
    sourceDays = complete.map((d) => ({ date: d.date, minutes: d.minutes }));
    hoursBasis =
      input.enrolmentType == null
        ? 'attendance-type-not-stated'
        : permanent
          ? 'attendance-no-agreement'
          : 'attendance';
  }

  const perDay = sourceDays.map((day) => {
    const hours = toHours(day.minutes);
    /*
      THE DAILY CAP APPLIES TO EVERY CHILD — changed 2026-09-04, and it changes a money figure.

      It used to return early here for a child without a 20 Hours attestation, on the reasoning
      that "there is nothing to cap without the entitlement". That conflated 20 Hours ECE with the
      **ECE Funding Subsidy**, which an ordinary fee-paying enrolment also attracts and which §9-2
      caps at six hours a day regardless of any attestation. A nine-hour day used to yield nine
      funded hours where six are claimable — an over-statement, on the one figure this product
      promises never over-states. unverified-claims item 54.
    */
    // Age as at the day being counted, never as at today. A child who turned three in March was
    // not entitled in February, and using today's age would rewrite that in the centre's favour —
    // the same reasoning `replayDay` applies to the ratio bands.
    if (input.twentyHoursEce && input.dateOfBirth) {
      const months = ageInMonths(input.dateOfBirth, day.date);
      if (months < TWENTY_HOURS_MIN_MONTHS || months >= TWENTY_HOURS_MAX_MONTHS) {
        ineligibleDates.push(day.date);
      }
    }
    if (hours > caps.maxHoursPerDay) {
      cappedDates.push(day.date);
      return { date: day.date, hours: caps.maxHoursPerDay };
    }
    return { date: day.date, hours };
  });

  /*
    THE WEEKLY CAP ALSO APPLIES TO EVERY CHILD, and for an attested one the week's funded hours
    now split into the two components RS7 asks for by name.

    Per ISO week, on what the daily cap already allowed — the ordering matters and is tested: a
    long Monday's excess is not transferable to Tuesday, so capping the week first would claim
    hours nobody was entitled to.

    §9-3: up to 20 of the week's hours may be claimed as 20 Hours ECE, and "The remainder (up to
    30 hours) may be claimed as Plus 10 ECE hours". An unattested child has no 20 Hours component
    at all, so both parts are zero and the whole of `fundedHours` is subsidy.

    WHAT IS DELIBERATELY NOT DECIDED HERE. §9-2 computes the RS7 two-and-over subsidy figure "less
    any hours for children claimed as 20 Hours ECE", and whether that deduction includes the Plus
    10 hours or only the first twenty is **not settled** by anything read so far. It changes an RS7
    aggregate, not this per-child split, so it belongs to `rs7.ts` and to the enquiry — not to a
    guess made here. See unverified-claims item 56.
  */
  const byWeek = new Map<string, number>();
  for (const d of perDay) {
    byWeek.set(isoWeekKey(d.date), (byWeek.get(isoWeekKey(d.date)) ?? 0) + d.hours);
  }

  let fundedHours = 0;
  let twentyHoursHours = 0;
  let plusTenHours = 0;
  for (const weekHours of byWeek.values()) {
    const funded = Math.min(weekHours, caps.maxHoursPerWeek);
    fundedHours += funded;
    if (input.twentyHoursEce) {
      const twenty = Math.min(funded, caps.twentyHoursWeeklyCap);
      twentyHoursHours += twenty;
      plusTenHours += funded - twenty;
    }
  }

  return {
    childId: input.childId,
    attendedHours: toHours(complete.reduce((t, d) => t + d.minutes, 0)),
    // Rounded down again after summing, so the total cannot creep above the sum of its parts.
    fundedHours: Math.floor(fundedHours * 100) / 100,
    dailyCappedByDate: Object.fromEntries(perDay.map((d) => [d.date, d.hours])),
    // Floored the same way and for the same reason as the total above them.
    twentyHoursHours: Math.floor(twentyHoursHours * 100) / 100,
    plusTenHours: Math.floor(plusTenHours * 100) / 100,
    unresolvedHours: toHours(unresolved.reduce((t, d) => t + d.minutes, 0)),
    unresolvedDates: unresolved.map((d) => d.date),
    cappedDates,
    ineligibleDates,
    twentyHoursEce: input.twentyHoursEce,
    hoursBasis,
    /*
      Floored the same way as the totals above. Note this is the absent minutes the rules
      ALLOWED, before the daily and weekly caps — so it can exceed the share of `fundedHours`
      that survived them. Named `absenceHours` rather than `fundedAbsenceHours` for exactly that
      reason: it is what the absence rules permitted, not what the caps then paid for.
    */
    absenceHours: Math.floor(toHours(absenceMinutes) * 100) / 100,
    enrolmentType: input.enrolmentType ?? null,
    absenceHoursByDate,
    unclaimableAbsences,
    frequentAbsence,
    attendedOutsideAgreement,
  };
}

export function summariseFunding(
  period: FundingPeriod,
  children: ChildFunding[],
  /**
   * Optional so no existing caller breaks, and every caller that produces a figure somebody
   * keys into ELI Web should pass it. Omitting it yields `periodPrecedesRecord: null` —
   * "nobody said", which is honest, and is not the same as "the record covers this".
   */
  recordStart?: AttendanceRecordStart,
  /**
   * The caps these figures were computed under, so the summary reports the basis it actually
   * used rather than the default's.
   *
   * Added 2026-09-03 to close a latent trap. This function used to print
   * `(children[0] ? DEFAULT_CAPS : DEFAULT_CAPS).basis` — a ternary with identical branches,
   * so a caller that passed custom caps to `childFunding` got a summary describing
   * `DEFAULT_CAPS` instead. Nothing in production passes custom caps today, so nothing was
   * ever wrong on screen; the trap is that `capsBasis` is rendered directly under an
   * official-looking total, and the first caller to use the override `childFunding` already
   * accepts would have printed a false provenance for a figure somebody keys into ELI Web.
   *
   * Not plumbed through `readFundingPeriod`, deliberately: it passes no caps, so the default
   * is the truth there, and adding a parameter no caller sets would be configurability
   * nobody asked for.
   */
  caps: FundingCaps = DEFAULT_CAPS,
): FundingSummary {
  const unresolvedChildCount = children.filter((c) => c.unresolvedDates.length > 0).length;

  const periodPrecedesRecord =
    recordStart === undefined
      ? null
      : recordStart.startsOn === null
        ? // No attendance events anywhere in this centre. Every period precedes the record,
          // including this one, and the total below is zero for that reason rather than because
          // nobody attended.
          true
        : // String comparison is correct and intentional: both are `YYYY-MM-DD` in the centre's
          // own timezone, which sorts lexicographically. No Date is constructed, so no zone is
          // consulted and there is nothing here for `localDates.test.ts` to catch.
          recordStart.startsOn > period.from;

  return {
    period,
    children,
    totalFundedHours: Math.floor(children.reduce((t, c) => t + c.fundedHours, 0) * 100) / 100,
    complete: unresolvedChildCount === 0,
    unresolvedChildCount,
    ineligibleChildCount: children.filter((c) => c.ineligibleDates.length > 0).length,
    recordStartsOn: recordStart?.startsOn ?? null,
    periodPrecedesRecord,
    verified: FUNDING_RULES_VERIFIED,
    capsBasis: caps.basis,
    /*
      Seeded with every key at zero and then counted up, rather than built by reducing into an
      empty object. A `Record<HoursBasis, number>` assembled from the data alone would be missing
      the keys nobody happened to be on, and `basisCounts.agreement` would read `undefined` —
      which is falsy, so the disclaimer's "did anybody use the agreement" test would silently
      answer no in exactly the case it matters.
    */
    basisCounts: children.reduce<Record<HoursBasis, number>>(
      (acc, c) => {
        acc[c.hoursBasis] += 1;
        return acc;
      },
      {
        agreement: 0,
        attendance: 0,
        'attendance-no-agreement': 0,
        'attendance-type-not-stated': 0,
      },
    ),
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
    /*
      Added 2026-08-31, and it is the only sentence here the Ministry asked for by name. Its
      reply of that date, which confirmed a service may keep its Chapter 6 records outside an
      approved SMS, closes by addressing vendors: customers must be told that use of the
      system "does not remove the service's responsibility to comply with Ministry funding,
      record-keeping, and reporting requirements", and that RS7 figures a system produces are
      there to *support* the return — the service "remains responsible for reviewing,
      validating, and submitting", including "any over-claiming or under-claiming".

      THREE THINGS ABOUT THE SHAPE, EACH OF WHICH WAS A DECISION.

      It is UNCONDITIONAL. Every other sentence in this function is gated on something being
      wrong. This one is not, because it is true on the day every flag goes green — and the
      obvious place to put it, behind `!summary.verified`, is a wiring that deletes it exactly
      when the figures look most trustworthy and a manager is least likely to check them.

      It is in OUR WORDS, not the Ministry's. Quoting a marked government email at a customer
      implies the Ministry is speaking about this product. It is not: it described the
      conditions under which any system qualifies, and reviewed nothing here.

      It sits SECOND, not last. The sentences after it are the ones a manager can act on today
      — days to resolve, enrolments to check — and a paragraph that is skimmed should end on
      the actionable thing. This one belongs with "what this document is", which is the first
      sentence's job.
    */
    'Using this system does not move any of your obligations to the Ministry. You remain responsible for your funding, record-keeping and reporting requirements, and for reviewing and validating these figures — including any over- or under-claim in them — before anything is submitted.',
  ];

  /*
    First, and ahead of the unresolved-days sentence, because it is the more serious of the two
    and the only one that is invisible in the figures.

    An unresolved day announces itself — the total is missing hours somebody can go and fix. A
    period that starts before the records do produces a total that looks finished and is simply
    too small, with nothing on the page to suggest it. Order matters in a paragraph somebody
    skims before keying a number into a Ministry system.
  */
  if (summary.periodPrecedesRecord === true) {
    parts.push(
      summary.recordStartsOn === null
        ? 'This centre has no attendance records at all, so every figure below is zero because nothing has been recorded — not because nobody attended. Do not key these into a return.'
        : `This period starts on ${summary.period.from}, but the attendance record here does not begin until ${summary.recordStartsOn}. Days before that are missing rather than empty, so the total below is lower than what was actually attended. Use the system that holds the earlier records for this period.`,
    );
  }

  if (!summary.complete) {
    parts.push(
      `${summary.unresolvedChildCount} ${summary.unresolvedChildCount === 1 ? 'child has' : 'children have'} days that could not be calculated because the attendance record is incomplete. Those days are excluded from the totals below — resolve them and re-run before using these figures.`,
    );
  }
  if (summary.ineligibleChildCount > 0) {
    parts.push(
      `${summary.ineligibleChildCount} ${summary.ineligibleChildCount === 1 ? 'child is' : 'children are'} marked as 20 Hours ECE on days when they were under 3 or 6 and over. Their hours are included as recorded — check the enrolment before claiming, because the entitlement runs from the third birthday to the sixth.`,
    );
  }
  if (!summary.verified) {
    /*
      Narrowed 2026-08-18. This used to say the caps had not been checked; they have been, and the
      sentence was becoming the false-caveat problem the ratio banner just went through. What is
      actually missing is absence funding, so the disclaimer names it — a manager can act on "you
      may be able to claim more than this", and cannot act on "something is unverified".

      WIDENED 2026-09-03, because it named one under-claim and there are two.

      `DEFAULT_CAPS.maxHoursPerWeek` is 20, which is the cap on the 20 Hours ECE **component** —
      not on subsidy funding, where the Ministry allows up to 30 hours a week per child. The
      difference is "Plus 10", RS7 asks for it by name, and this file has never modelled it. So
      the hours between 20 and 30 a week are discarded silently, on top of the absent days.

      Naming both matters more than it looks: a manager reading the old sentence could have
      concluded that once absences were accounted for by hand, the figure was complete. It was
      not, and nothing on the page said so.
    */
    /*
      REPLACED, NOT DELETED — 2026-09-04, later the same day, and this is the third revision of
      this sentence in three weeks.

      It used to read: "These figures count attended hours only. Under sections 6-4 to 6-7 of the
      Funding Handbook a service may also claim funding for days a permanently enrolled child was
      booked but absent, and this system does not calculate that."

      Both halves stopped being unconditionally true when the agreement basis landed. For a
      permanently enrolled child with recorded days and times, the figures no longer count
      attended hours only, and the system DOES calculate the absence funding. For everybody else
      the old sentence is still exactly right.

      So it splits by what actually happened in this period, which is what `basisCounts` is for.
      A disclaimer that describes the product in general is a disclaimer that is wrong for half
      the rows on the page.
    */
    const fromAgreement = summary.basisCounts.agreement;
    const fromAttendance =
      summary.basisCounts.attendance +
      summary.basisCounts['attendance-no-agreement'] +
      summary.basisCounts['attendance-type-not-stated'];

    if (fromAgreement === 0) {
      parts.push(
        'These figures count attended hours only. Under sections 6-4 to 6-7 of the Funding Handbook a service may also claim funding for days a permanently enrolled child was booked but absent, and no child here has recorded days and times for that to be worked out from — so the total may be lower than what you are entitled to claim.',
      );
    } else {
      parts.push(
        `For ${fromAgreement} ${fromAgreement === 1 ? 'child' : 'children'} these figures start from the enrolment agreement and include absences the Handbook allows, under sections 6-4 to 6-7.` +
          (fromAttendance > 0
            ? ` The other ${fromAttendance} count attended hours only, because no days and times are recorded or the enrolment type is not stated, so those may be lower than what you are entitled to claim.`
            : ''),
      );
      /*
        AND THE ONE PLACE THIS PRODUCT CAN NOW RUN HIGH, WHICH HAS TO BE SAID OUT LOUD.

        Every other caveat in this function warns that a figure may be too LOW, and item 6 and
        this file have both promised for weeks that the error only ever runs that way. The
        agreement basis breaks that promise in exactly one way: §6-5 stops a claim the moment a
        parent gives notice the child will not return, "even if the three week period has not
        ended" — and nothing in this schema records notice, so the window runs its full length.

        Conditional on the agreement basis actually being used, because for an attendance-only
        period it cannot happen and the sentence would be a false caveat — the thing this
        function has already had to remove twice.

        It sits with the sentence above it rather than at the end, because a manager who reads
        that absences are now included needs the qualification in the same breath.
      */
      parts.push(
        'One caution in the other direction: if a family has given notice that a child is leaving, the Handbook stops absence funding from that date, and this system does not record notice — so check any child who has stopped attending before you claim.',
      );
    }
    /*
      TWO SENTENCES CAME OUT HERE EARLIER ON 2026-09-04, because the things they described were
      fixed rather than because they became inconvenient — which is the distinction that matters
      for a disclaimer.

      One said Plus 10 was not computed. It is now: `plusTenHours` on every child.

      The other said the figure could run HIGH for a child with no 20 Hours attestation, because
      the caps were gated on the attestation. They are not any more — 6 a day and 30 a week apply
      to every child — so that sentence would now be a false caveat.

      Deleting a warning is only honest when the warning has stopped being true. Both had. The
      absence sentence above was replaced rather than deleted for the same reason in reverse: it
      is still true for most rows, and the new one says which.
    */
  }
  return parts.join(' ');
}


/**
 * A day where the centre's claimable hours exceed what its licence allows.
 *
 * Handbook Glossary, read 2026-09-04: a funded child hour is *"an occupied child-place that is
 * funded for 1 hour"*, and a service may be funded *"for up to 6 FCHs per child-place per day, to a
 * maximum of 30 FCHs per child-place per week"*. A child-place *"may be used by more than 1 child
 * during the course of a day"*.
 *
 * So the cap is on a **place**, and `childFunding` applies it to a **child**. That is exact whenever
 * a day's children do not outnumber the licensed places — `sum(min(hᵢ, 6)) ≤ 6N ≤ 6P` — and it
 * over-states when they do, which happens in a sessional service where a morning child and an
 * afternoon child share a place, and on any day with conditional enrolments (which the Glossary
 * defines as being *above* the licensed maximum).
 */
export interface PlaceCapExceedance {
  date: string;
  /** The centre's total daily-capped hours for that date, across every child. */
  claimedHours: number;
  /** `6 × licensed places`. */
  allowedHours: number;
}

/**
 * Which days exceed the licensed-place cap, or **null** when the licence is not stated.
 *
 * `null` is not an empty array, and the difference is the whole point — the same three-state
 * contract as `periodPrecedesRecord` and `drillStatuses.overdue`. An empty array means *checked, and
 * no day exceeds*. Null means *nobody has told this product how many places it is licensed for*, so
 * the question was not asked. `centres.licensed_places` (0050) is nullable precisely because a
 * default would produce confident figures against a number no centre gave.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: reduce anything. It reports the days and the amounts, and
 * leaves the figures alone.
 *
 * Two reasons, and the second decides it. The obvious behaviour is to trim the excess — but nothing
 * read so far says WHICH child's hours to trim, and RS7 needs the surviving hours split by age band
 * and 20 Hours status, so a trim implies an attribution rule this product would be inventing. And
 * the choice is the service's to make and to defend in an audit, not this product's to make
 * silently. Naming the day and the amount is the same treatment a broken attendance day gets:
 * excluded from any claim of correctness, and reported to the person who can act on it.
 */
export function placeCapExceedances(input: {
  children: ChildFunding[];
  /** From `centres.licensed_places`. Null means not stated. */
  licensedPlaces: number | null;
  caps?: FundingCaps;
}): PlaceCapExceedance[] | null {
  if (input.licensedPlaces === null) return null;

  const caps = input.caps ?? DEFAULT_CAPS;
  const allowedHours = caps.maxHoursPerDay * input.licensedPlaces;

  const byDate = new Map<string, number>();
  for (const child of input.children) {
    for (const [date, hours] of Object.entries(child.dailyCappedByDate)) {
      byDate.set(date, (byDate.get(date) ?? 0) + hours);
    }
  }

  const out: PlaceCapExceedance[] = [];
  for (const [date, claimed] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    // Floored the same way every other total here is, so a floating-point tail cannot invent an
    // exceedance of 0.0000001 hours and put a warning on a screen for it.
    const claimedHours = Math.floor(claimed * 100) / 100;
    if (claimedHours > allowedHours) out.push({ date, claimedHours, allowedHours });
  }
  return out;
}


/**
 * One day on which §6-4 forbids part of what this product has computed.
 *
 * §6-4: *"Funding must not be claimed for both an absent permanently enrolled child under an
 * absence rule and for the conditional or casual child who fills the absent child's place."*
 */
export interface SixFourOverlap {
  date: string;
  /** Claimed absence hours for permanently enrolled children on this date. */
  claimedAbsenceHours: number;
  /** Hours claimed for casual and conditional children, who are funded on attendance. */
  replacementHours: number;
  /**
   * The hours §6-4 forbids claiming twice — the smaller of the two figures above. **Reported,
   * never deducted**; see the function's note.
   */
  overlapHours: number;
  /**
   * Why this day is caught.
   *
   * `conditional-enrolment` needs no capacity arithmetic: the Glossary defines a conditional
   * enrolment as one *"above the service's licensed maximum number of child-places"*, so a
   * conditional child who attends is occupying a place they do not hold.
   *
   * `at-or-over-capacity` is the casual case, where "fills the absent child's place" only has
   * content if the places are otherwise full.
   *
   * `capacity-unknown` is `centres.licensed_places` being null. Reported rather than skipped: a
   * missing denominator must not be able to silence a rule about over-claiming.
   */
  basis: 'conditional-enrolment' | 'at-or-over-capacity' | 'capacity-unknown';
}

/**
 * §6-4's cross-child rule — the one absence rule `childFunding` cannot see.
 *
 * Every other figure in this file is computed per child. This one is about **two children
 * competing for one place**, so it takes the whole period's results and works by date.
 *
 * WHY IT REPORTS AND DOES NOT DEDUCT, WHICH IS NOT THE SAME REASON AS THE PLACE CAP'S
 *
 * `placeCapExceedances` reports without adjusting because the attribution rule is unknown —
 * *whose* hours go, when a day exceeds `6 × places`, is [[unverified-claims]] item 57 and nothing
 * read so far answers it.
 *
 * **Here the attribution IS known**, and it narrows item 57. §7-7 says it in as many words:
 * *"Another child may attend the absent child's place without claiming funding for that
 * replacement child."* So for the part of an excess that involves a claimed absence, the
 * replacement child's hours are the ones not claimed. That is a quotation, not a reading.
 *
 * What still blocks deducting is the other half of item 57's warning: RS7 needs the surviving
 * hours split by age band and 20 Hours status, so a trim applied here propagates into a Crown
 * return, and choosing *which* casual child among several is a judgement the Handbook does not
 * make. So the day, the amount and the basis are named — which is enough for the manager keying
 * a figure into ELI Web, and is what a "preparation export" is for — and `fundedHours` is left
 * alone.
 *
 * NOT SYMMETRICAL WITH THE PLACE CAP, and deliberately. A day can be caught here without
 * exceeding `6 × licensed places` at all: one absent permanent child claimed, one conditional
 * child attending, and eight empty places. Two claims on one place, no aggregate exceedance.
 */
export function sixFourOverlaps(input: {
  children: ChildFunding[];
  /** From `centres.licensed_places`. Null means the licence is not stated. */
  licensedPlaces: number | null;
}): SixFourOverlap[] {
  const absenceByDate = new Map<string, number>();
  const replacementByDate = new Map<string, number>();
  const conditionalDates = new Set<string>();
  const headcountByDate = new Map<string, number>();

  for (const child of input.children) {
    for (const [date, hours] of Object.entries(child.absenceHoursByDate)) {
      absenceByDate.set(date, (absenceByDate.get(date) ?? 0) + hours);
    }
    /*
      A child funded on attendance whose type is casual or conditional is §6-4's replacement
      candidate. `attendance-no-agreement` and `attendance-type-not-stated` are excluded: the
      first is a permanent child, and the second is a child nobody has classified — treating an
      unclassified child as a replacement would refuse hours on a guess about their enrolment.
    */
    const replacement =
      child.enrolmentType === 'casual' || child.enrolmentType === 'conditional';

    for (const [date, hours] of Object.entries(child.dailyCappedByDate)) {
      /*
        PRESENT, not claimed — and the difference is the whole capacity test.

        On the agreement basis `dailyCappedByDate` includes days the child was absent and the
        absence was claimed. Counting those as heads would say a day was at capacity when a place
        was in fact standing empty, and then report a §6-4 overlap on a day where the casual child
        had a place of their own to sit in. So an absent day is not a head.

        Known undercount, and it errs towards reporting rather than towards silence: a permanent
        child who attends a day their agreement does not cover appears in
        `attendedOutsideAgreement`, not here, so they are not counted as present. That surface
        reports those days separately.
      */
      if (child.absenceHoursByDate[date] === undefined) {
        headcountByDate.set(date, (headcountByDate.get(date) ?? 0) + 1);
      }
      if (!replacement) continue;
      replacementByDate.set(date, (replacementByDate.get(date) ?? 0) + hours);
      if (child.enrolmentType === 'conditional') conditionalDates.add(date);
    }
  }

  const out: SixFourOverlap[] = [];
  for (const [date, claimedAbsenceHours] of [...absenceByDate].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    /*
      No `claimedAbsenceHours <= 0` test, and its absence is deliberate. This loop walks
      `absenceByDate`, which only has a key where an absence was claimed, and `blockMinutes`
      cannot return 0 — so a zero entry is unreachable. A first draft guarded it anyway and the
      mutation drill could not kill the branch, which is how it was found. The same dead branch
      was found the same way in `enrolledSessions`.
    */
    const replacementHours = replacementByDate.get(date) ?? 0;
    if (replacementHours <= 0) continue;

    let basis: SixFourOverlap['basis'];
    if (conditionalDates.has(date)) {
      basis = 'conditional-enrolment';
    } else if (input.licensedPlaces === null) {
      basis = 'capacity-unknown';
    } else if ((headcountByDate.get(date) ?? 0) >= input.licensedPlaces) {
      basis = 'at-or-over-capacity';
    } else {
      /*
        A casual child attending a day with places to spare is not filling anybody's place, so
        §6-4 does not bite. This is the branch that keeps the report from crying wolf on every
        day a casual child happens to attend — and it is the reason `licensedPlaces` is read at
        all.
      */
      continue;
    }

    // Floored like every other total here, so a floating-point tail cannot report an overlap of
    // 0.0000001 hours.
    const overlapHours =
      Math.floor(Math.min(claimedAbsenceHours, replacementHours) * 100) / 100;
    out.push({ date, claimedAbsenceHours, replacementHours, overlapHours, basis });
  }
  return out;
}

/**
 * The Ministry's three funding periods for a calendar year.
 *
 * Added 2026-08-18. `FundingPeriod` is still supplied by the caller — a centre may want an
 * arbitrary window, and a period that cannot be chosen is a screen somebody works around. What
 * changed is that the real boundaries are now known, so a manager no longer has to invent dates on
 * a document that looks official.
 *
 * The periods are four-monthly and one of them straddles the new year: February–May, June–September,
 * and October–January. `year` names the year the period **starts** in, so `2026` gives an
 * October 2026 – January 2027 period.
 *
 * Not modelled here, deliberately: the submission window (a period may be submitted from the first
 * of the month after it ends, and the electronic cut-off is three months later — 31 August,
 * 31 December, 30 April respectively). That belongs with a reminder somebody has asked for, and
 * this product cannot submit anything, so a cut-off date here would describe a deadline it plays no
 * part in.
 */
export function ministryFundingPeriods(year: number): FundingPeriod[] {
  const next = year + 1;
  return [
    { label: `February–May ${year}`, from: `${year}-02-01`, to: `${year}-05-31` },
    { label: `June–September ${year}`, from: `${year}-06-01`, to: `${year}-09-30` },
    { label: `October ${year} – January ${next}`, from: `${year}-10-01`, to: `${next}-01-31` },
  ];
}

// ---------------------------------------------------------------------------
// Claimed against received (0046)
// ---------------------------------------------------------------------------

export interface FundingReceipt {
  id: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  /** Null means the centre has not stated one. Not zero. */
  claimedCents: number | null;
  receivedCents: number;
  receivedOn: string | null;
}

export interface FundingVariance extends FundingReceipt {
  /**
   * Claimed minus received, in cents. **Null when no claim was stated** — the whole
   * point of the distinction.
   *
   * Positive means the Ministry paid less than the centre claimed, which is the case
   * worth a phone call. Negative means it paid more, which is worth one too: an
   * overpayment that nobody notices is a debt nobody has budgeted for.
   */
  varianceCents: number | null;
}

/**
 * Compare what a centre says it claimed against what arrived.
 *
 * **Nothing here computes a claim.** This product holds no funding rates — none are in
 * the repo, deliberately — so both figures are entered by the centre and this does the
 * subtraction. Multiplying the funded hours on `/funding` by a rate would put a dollar
 * sign on a number nobody has checked, which is the one thing this feature must not do.
 *
 * A period with no stated claim is **not** treated as a claim of zero. Zero would make
 * every unstated period look like a total overpayment and bury the real ones.
 */
export function summariseVariance(receipts: FundingReceipt[]): {
  rows: FundingVariance[];
  /** Total shortfall across periods where a claim WAS stated. */
  shortfallCents: number;
  /** Total overpayment, kept separate — it is a different conversation. */
  overpaidCents: number;
  /** How many periods cannot be compared at all. */
  unstated: number;
} {
  const rows = receipts.map((r) => ({
    ...r,
    varianceCents: r.claimedCents === null ? null : r.claimedCents - r.receivedCents,
  }));

  let shortfallCents = 0;
  let overpaidCents = 0;
  let unstated = 0;
  for (const row of rows) {
    if (row.varianceCents === null) unstated += 1;
    else if (row.varianceCents > 0) shortfallCents += row.varianceCents;
    else overpaidCents += -row.varianceCents;
  }

  // Worst shortfall first; unstated periods last, because they are a data problem
  // rather than a money one.
  rows.sort((a, b) => (b.varianceCents ?? -Infinity) - (a.varianceCents ?? -Infinity));

  return { rows, shortfallCents, overpaidCents, unstated };
}
