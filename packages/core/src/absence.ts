/**
 * Which enrolled-but-absent sessions may be claimed — §6-4, §6-5, §6-6 and §7-7.
 *
 * THE FIRST SLICE OF THE ABSENCE RULES, AND DELIBERATELY NOT WIRED INTO `childFunding` YET.
 *
 * Nothing in this module changes a funded-hours figure. It answers one question — *was this
 * absent session claimable?* — and answers it purely, from data the caller already holds. The
 * arithmetic that would consume it needs two further things this module does not attempt (the
 * §9-2 hours source, and §6-4's cross-child pass), and shipping the classifier first means the
 * hard part is testable before any published number moves.
 *
 * `FUNDING_RULES.absence.verified` therefore stays FALSE. The rules are read and sourced, and
 * the product still claims none of it: a flag that said otherwise would be a claim about the
 * law made by a module nothing calls. See `funding.ts` for what that flag means.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE RULES, IN THE HANDBOOK'S WORDS
 *
 * §6-4 — funding may be claimed for hours a **permanently enrolled** child did not attend, if
 * the absence falls under one of the absence rules. For a casual or conditional child, funding
 * is on attendance **only**. That gate is the caller's: this module is given the sessions of
 * one enrolment and does not know its type, because a classifier that silently returned
 * "nothing claimable" for a casual child would be indistinguishable from one that had a bug.
 *
 * §6-5, the Three Week Rule — claim every enrolled-but-absent session within three weeks of
 * the **first** day of absence; nothing from the fourth week onward; funding resumes when the
 * child returns. And it stops the moment a parent gives notice the child is not coming back,
 * *"even if the three week period has not ended"*.
 *
 * §6-6 — *"Services that do not operate for a continuous period of 2 weeks or more may claim
 * funding for enrolled children who are absent before and after the break."* The mechanism is
 * a **suspension, not an extension**: the rule *"will be suspended on the date of the child's
 * last session before the service closes"* and *"will restart from the first date the child is
 * enrolled to attend after the centre re-opens."*
 *
 * §7-7 — with a qualifying exemption the window is **twelve** weeks, not three, and *"the
 * 12-week period begins on the first day of absence"* — the same anchor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SPELL IS THE UNIT
 *
 * Both windows are measured from *"the first day of absence"* and both reset when the child
 * returns, so the classifier cannot decide one session at a time: whether a Tuesday is
 * claimable depends on when the current run of absences started, which depends on every
 * session before it. Hence one pass over the enrolled sessions in order, carrying the spell.
 *
 * A SPELL IS BROKEN BY ATTENDANCE, NOT BY A GAP IN ENROLLED DAYS. A child enrolled Monday,
 * Wednesday and Friday who misses three consecutive Mondays is in one spell three weeks long,
 * not three spells — the intervening Wednesdays are not enrolled days and say nothing. That is
 * why the input is the *enrolled* sessions rather than a calendar.
 */

import { isClosedOn, type ServiceClosure } from './closures';
import {
  blockMinutes,
  blocksOn,
  isoWeekdayOf,
  lastDayOf,
  mondayOf,
  nextMonth,
  type WeekdayBlock,
} from './weekdayBlock';
// `shiftLocalDate` lives in `children.ts` beside the other date helpers rather than in a
// module of its own. Imported from there rather than reimplemented: it already handles the
// month and year boundaries this loop walks over.
import { shiftLocalDate } from './children';

/** One session the agreement says the child was expected to attend. */
export interface EnrolledSession {
  /** ISO date in the centre's zone. */
  date: string;
  /** Minutes the agreement expected, from the booking-schedule block. */
  minutes: number;
  /** Whether the child attended at all that day. Any attendance ends a spell. */
  attended: boolean;
  /**
   * Minutes actually attended, for §6-7's third trigger — *"attends fewer hours than enrolled
   * daily"*. Optional, and **three-state on purpose**:
   *
   *   - a number: the day's attendance record is complete and this is what it says
   *   - `null`: the child attended and the record is broken (a missing sign-out), so the day
   *     cannot be compared. `assessFrequentAbsence` counts it as a named gap, never as a match
   *     and never as a shortfall
   *   - `undefined`: the caller did not supply attended hours at all, so the whole trigger is
   *     reported as unevaluated rather than silently answered "no"
   *
   * `attendedHours()` in `hours.ts` already produces exactly this: `days[].minutes` with a
   * `complete` flag, so the caller passes `complete ? minutes : null`.
   */
  attendedMinutes?: number | null;
}

/**
 * §7-7's two qualifying bases, transcribed from the section itself.
 *
 * *"A child qualifies if either: they have an ongoing learning support need … or they have a
 * short-term illness or condition."* Not a vocabulary anybody here chose, and the CHECK in `0089`
 * carries the same two values.
 */
export const EXEMPTION_BASES = ['ongoing_learning_support', 'short_term_illness'] as const;
export type ExemptionBasis = (typeof EXEMPTION_BASES)[number];

export const EXEMPTION_BASIS_LABELS: Record<ExemptionBasis, string> = {
  ongoing_learning_support: 'Ongoing learning support need',
  short_term_illness: 'Short-term illness or condition',
};

/**
 * The three documents §7-7 accepts, and the rules between them are not symmetric.
 *
 * A short-term illness may be evidenced **only** by an EC13 — a Child Disability Allowance letter
 * does not evidence a fortnight of chickenpox — and an IDP must carry its issue date, because
 * §7-7 requires it *"issued within previous 6 months"* and without a date that condition cannot be
 * answered at all. `0089` enforces both.
 */
export const EXEMPTION_EVIDENCE = ['idp', 'ec13', 'child_disability_allowance'] as const;
export type ExemptionEvidence = (typeof EXEMPTION_EVIDENCE)[number];

export const EXEMPTION_EVIDENCE_LABELS: Record<ExemptionEvidence, string> = {
  idp: 'Individual Development Plan',
  ec13: 'EC13 form',
  child_disability_allowance: 'Child Disability Allowance documentation',
};

/** One recorded §7-7 exemption — a row of `absence_exemptions` (0089). */
export interface AbsenceExemption {
  id: string;
  enrolmentId: string;
  basis: ExemptionBasis;
  evidence: ExemptionEvidence;
  /** The date the evidence itself carries. Required for an IDP. */
  evidenceDatedOn: string | null;
  /** When the SERVICE completed its EC12. Not an approval date — nobody approves this. */
  ec12CompletedOn: string;
  exemptFrom: string;
  /** Null is open-ended, which only an ongoing learning support need may be. */
  exemptTo: string | null;
  notes: string | null;
}

/**
 * §6-7's two reconfirmation outcomes, and they are not degrees of one thing.
 *
 * *"Signed, dated confirmation from parents/guardians either affirming the agreement remains valid
 * or documenting revised attendance days/times."*
 *
 * **Affirmed** says the absences were incidental and the agreement was right. **Revised** says the
 * agreement was wrong, and satisfies month four's *"the enrolment agreement must be changed to
 * match the child's attendance"* — by a new `child_booking_schedule` block, not by this row.
 *
 * Both unlock a third-month claim. The distinction matters for what happens next, not for the
 * claim, which is why `assessFrequentAbsence` takes only the dates.
 */
export const RECONFIRMATION_OUTCOMES = ['affirmed', 'revised'] as const;
export type ReconfirmationOutcome = (typeof RECONFIRMATION_OUTCOMES)[number];

export const RECONFIRMATION_OUTCOME_LABELS: Record<ReconfirmationOutcome, string> = {
  affirmed: 'The agreement still stands',
  revised: 'The days or times have changed',
};

/** One recorded §6-7 reconfirmation — a row of `enrolment_reconfirmations` (0092). */
export interface EnrolmentReconfirmation {
  id: string;
  enrolmentId: string;
  /** Who confirmed it. §6-7 wants a named parent or guardian, not "the family". */
  guardianId: string;
  guardianName: string | null;
  confirmedOn: string;
  outcome: ReconfirmationOutcome;
  /** `portal`, `kiosk` or `paper` — the same enum attendance verification uses (0061). */
  method: 'portal' | 'kiosk' | 'paper';
  /** What changed, in words. Required when the outcome is `revised`. */
  detail: string | null;
}

export const THREE_WEEK_RULE_DAYS = 21;
export const EXEMPT_WINDOW_DAYS = 84;

export interface AbsenceClassification {
  date: string;
  minutes: number;
  /** False for a session the child attended — those are not absences at all. */
  absent: boolean;
  claimable: boolean;
  /**
   * Why not, in the Handbook's terms, or null when claimable. A string rather than an enum
   * because it goes on a screen beside a figure and the reason is the useful part; the caller
   * that needs to branch has `claimable`.
   */
  reason: string | null;
  /** The first day of the spell this session belongs to, or null if it is not an absence. */
  spellStartedOn: string | null;
  /**
   * Days of the window consumed as at this session — closure days excluded per §6-6. Exposed
   * because "this is day 19 of 21" is the single most useful thing to show somebody deciding
   * whether to chase a family, and because it is what the tests assert against.
   */
  windowDaysUsed: number | null;
}

/**
 * A closure long enough to suspend the Three Week Rule — §6-6's *"continuous period of 2 weeks
 * or more"*.
 *
 * An open-ended closure qualifies: it has no end, so it is at least two weeks by construction.
 * Measured inclusively, matching `coversDate` and the `[]` range bound `0088` uses, so a
 * closure from the 1st to the 14th is fourteen days and qualifies rather than falling one short
 * of its own boundary.
 */
export function suspendsTheWindow(closure: ServiceClosure): boolean {
  if (closure.endsOn === null) return true;
  const from = Date.parse(`${closure.startsOn}T00:00:00Z`);
  const to = Date.parse(`${closure.endsOn}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return false;
  return (to - from) / 86_400_000 + 1 >= 14;
}

/**
 * Classify every enrolled session of one enrolment.
 *
 * The caller supplies §6-4's gate and §7-7's exemption, because both are facts about the
 * enrolment rather than about the sessions, and both are things this module must not guess:
 * `enrolmentType` null means not stated, and a child whose type nobody has recorded is
 * **ineligible** for absence funding rather than eligible. That is the direction these figures
 * promise they never get wrong.
 */
export function classifyAbsences(input: {
  sessions: readonly EnrolledSession[];
  closures: readonly ServiceClosure[];
  /**
   * True where a §7-7 exemption covers a date. A predicate rather than a list, because the
   * caller holds the exemption rows and their date arithmetic is `coversDate`'s job, not this
   * module's second copy of it.
   */
  isExemptOn?: (date: string) => boolean;
  /**
   * The date a parent gave notice the child will not return. §6-5 stops on notice *"even if
   * the three week period has not ended"*, so this is not the enrolment's end date — notice
   * comes first and the end date may be later or absent.
   */
  noticeGivenOn?: string | null;
}): AbsenceClassification[] {
  const suspending = input.closures.filter(suspendsTheWindow);
  const sessions = [...input.sessions].sort((a, b) => a.date.localeCompare(b.date));

  let spellStart: string | null = null;
  const out: AbsenceClassification[] = [];

  for (const session of sessions) {
    if (session.attended) {
      // §6-5: "funding resumes when the child returns". The spell ends here, so the next
      // absence starts a fresh window rather than continuing this one.
      spellStart = null;
      out.push({
        date: session.date,
        minutes: session.minutes,
        absent: false,
        claimable: false,
        reason: null,
        spellStartedOn: null,
        windowDaysUsed: null,
      });
      continue;
    }

    if (spellStart === null) spellStart = session.date;

    const used = windowDaysUsed(spellStart, session.date, suspending);
    const limit = input.isExemptOn?.(spellStart) ? EXEMPT_WINDOW_DAYS : THREE_WEEK_RULE_DAYS;

    let claimable: boolean;
    let reason: string | null;

    if (input.noticeGivenOn && session.date >= input.noticeGivenOn) {
      /*
        §6-5 is explicit that this beats the window: notice stops the claim "even if the three
        week period has not ended", and the Ministry recovers anything claimed after it. So the
        notice test comes first, and it is `>=` because the day notice is given is already
        after the child is known not to be returning.
      */
      claimable = false;
      reason = 'the family gave notice the child would not return';
    } else if (used < limit) {
      claimable = true;
      reason = null;
    } else {
      claimable = false;
      reason =
        limit === EXEMPT_WINDOW_DAYS
          ? 'past the twelve-week window a §7-7 exemption allows'
          : 'past the three-week window, and no exemption is recorded';
    }

    out.push({
      date: session.date,
      minutes: session.minutes,
      absent: true,
      claimable,
      reason,
      spellStartedOn: spellStart,
      windowDaysUsed: used,
    });
  }

  return out;
}

/**
 * Days of the window consumed between the spell's first day and this session.
 *
 * §6-6 IS WHY THIS IS NOT SUBTRACTION. The obvious implementation is
 * `daysBetween(start, date) - closedDays`, and it gives the right answer for a closure wholly
 * inside the spell and the wrong one for a closure that starts before it. Counting forward and
 * skipping suspended days is the same shape as the Handbook's own wording — the rule is
 * *"suspended"* on one date and *"restart[s]"* on another — and it cannot go negative.
 *
 * Day 0 is the spell's first day, so a session on that day has consumed nothing and
 * `used < 21` admits twenty-one days of absence rather than twenty. That is the reading of
 * *"within three weeks of the first day"* with *"nothing from the fourth week onward"*: the
 * first day is inside the window, and day 21 is the start of week four.
 */
function windowDaysUsed(
  spellStart: string,
  date: string,
  suspending: readonly ServiceClosure[],
): number {
  let used = 0;
  let cursor = spellStart;
  // Bounded by construction: `date` is never before `spellStart` because the sessions are
  // sorted and the spell starts at one of them.
  while (cursor < date) {
    if (!isClosedOn(suspending, cursor)) used += 1;
    cursor = shiftLocalDate(cursor, 1);
  }
  return used;
}

/**
 * The sessions the agreement says a child was expected to attend, across a period.
 *
 * THE BRIDGE FROM `child_booking_schedule` TO THE CLASSIFIER. Without it the classifier takes
 * an input nothing can produce, which is how a pure function ends up with no callers for
 * reasons nobody wrote down.
 *
 * A CLOSED DAY PRODUCES NO SESSION. §6-5 claims sessions a child was *"enrolled to attend, but
 * was absent from"*, and on a day the service did not operate there was no session to be absent
 * from — the child was not expected and the agreement was not in force. Leaving those days in
 * would spend a three-week window on days nobody could have attended, which is the opposite of
 * what §6-6 exists to prevent.
 *
 * WHAT THAT DELIBERATELY LEAVES OUT: §7-5's claimable emergency closure. An approved emergency
 * closure IS claimable — *"actual booked hours for the day(s) of emergency closure"* — but that
 * is a different mechanism from an absence, with its own eligibility (`claimed_as_emergency`
 * and an ERO letter, `0091`) and no window to run. It is not an absence and must not be
 * classified as one, so those days are excluded here too and the §7-5 path is still unbuilt.
 * `unverified-claims` item 60 carries what remains of it.
 *
 * MINUTES COME FROM THE BLOCKS IN FORCE ON THAT DATE, summed. A child with a morning and an
 * afternoon block on one Tuesday has one session of both, because the funding question is
 * hours per day and §9-2 asks for *"the daily number of hours of enrolment"*.
 */
export function enrolledSessions(input: {
  /** The child's booking-schedule blocks, superseded ones included — `blocksOn` filters. */
  blocks: readonly WeekdayBlock[];
  /** Inclusive ISO date range, normally a funding period. */
  from: string;
  to: string;
  /** Dates the child attended at all. Any attendance ends a spell, per §6-5. */
  attendedDates: ReadonlySet<string>;
  /** Every closure for the centre. Days covered by one produce no session. */
  closures: readonly ServiceClosure[];
}): EnrolledSession[] {
  const out: EnrolledSession[] = [];
  const blocks = [...input.blocks];

  for (let date = input.from; date <= input.to; date = shiftLocalDate(date, 1)) {
    if (isClosedOn(input.closures, date)) continue;

    // Matching `child_booking_schedule.weekday`, where 1 is Monday. This was an inline
    // conversion until the shared helper was extracted on 2026-09-04 — see `mondayOf`'s note in
    // `weekdayBlock.ts` for the four copies that prompted it.
    const today = blocksOn(blocks, date).filter((b) => b.weekday === isoWeekdayOf(date));
    if (today.length === 0) continue;

    /*
      Null means every block on that day had unparseable or inverted times. Skipped rather than
      counted as zero: a session of no hours would be an absence a service could be told about
      for a day the agreement never described, and the real fault is the block, which the
      schedule panel shows.

      NULL IS THE ONLY FALSY CASE, and this is checked rather than assumed. `blockMinutes`
      returns `any ? total : null` and only sets `any` when `to > from`, so it cannot return 0 —
      a first draft here also tested `minutes === 0` and the mutation drill could not kill that
      branch, because nothing could reach it. Dead code found by asking what test would fail if
      it were removed, and answering "none".
    */
    const minutes = blockMinutes(today);
    if (minutes === null) continue;

    out.push({ date, minutes, attended: input.attendedDates.has(date) });
  }

  return out;
}

/**
 * Total claimable absent minutes, for a caller that only wants the figure.
 *
 * Separate from the classifier rather than an option on it, because the per-session reasons
 * are the thing a service needs when a figure looks wrong — and a function that returned only
 * a total would make the next screen recompute the classification to explain itself.
 */
export function claimableAbsentMinutes(rows: readonly AbsenceClassification[]): number {
  return rows.reduce((sum, r) => (r.absent && r.claimable ? sum + r.minutes : sum), 0);
}

// ---------------------------------------------------------------------------
// §6-7, the Frequent Absence Rule
// ---------------------------------------------------------------------------

/**
 * One of §6-7's three trigger situations, with the counts that made it fire.
 *
 * The counts are carried rather than recomputed by the screen, because "absent 3 of 4 Fridays" is
 * the sentence a service needs and rebuilding it from a boolean would mean a second copy of this
 * arithmetic in a component.
 */
export type FrequentAbsenceTrigger =
  /** *"Absent on the same enrolled day(s) for more than half of those days in a calendar month."* */
  | { kind: 'same-enrolled-day'; isoWeekday: number; enrolled: number; absent: number }
  /** *"Attends fewer days per week than enrolled, in more than half the weeks in a month."* */
  | { kind: 'fewer-days-per-week'; weeks: number; weeksShort: number }
  /** *"Attends fewer hours than enrolled daily, on more than half of enrolled days in a month."* */
  | { kind: 'fewer-hours-per-day'; enrolledDays: number; daysShort: number };

/** One calendar month of one enrolment, assessed against §6-7. */
export interface FrequentAbsenceMonth {
  /** `YYYY-MM`, in the centre's zone — the sessions already carry local dates. */
  month: string;
  /** Enrolled sessions in the month. Zero means the month could not be assessed at all. */
  enrolledDays: number;
  attendedDays: number;
  triggers: readonly FrequentAbsenceTrigger[];
  triggered: boolean;
  /**
   * Position in the current run of triggered months, 1-based; 0 when this month did not trigger.
   * This is the number §6-7's timeline is written against — month 3 needs a reconfirmation,
   * month 4 must not be claimed.
   */
  monthOfRun: number;
  claimable: boolean;
  /** Why not, in the Handbook's terms, or null when claimable. */
  reason: string | null;
  /**
   * What could not be evaluated, named. Same contract as `census.ts`: a missing input produces a
   * sentence saying which input is missing, never a default that reads like an answer.
   */
  gaps: readonly string[];
}

/** Does any part of `month` fall inside the closure? */
function overlapsMonth(closure: ServiceClosure, month: string): boolean {
  const first = `${month}-01`;
  const last = lastDayOf(month);
  return closure.startsOn <= last && (closure.endsOn === null || closure.endsOn >= first);
}

/**
 * §6-7: *"A child's attendance must match their enrolment agreement for at least half (i.e. 50
 * per cent or more) of each calendar month."*
 *
 * Returns one row per calendar month from the first month with an enrolled session to the last,
 * **including months with none** — a month absent from the output would be indistinguishable
 * from a month nobody assessed.
 *
 * WHY THIS IS SEPARATE FROM `classifyAbsences`
 *
 * They answer different questions on different units. §6-5 asks *how long has this spell run*,
 * and its answer is per session. §6-7 asks *does the agreement still describe this child*, and
 * its answer is per calendar month, then per run of months. Folding the second into the first
 * would make a per-session function return a month's verdict, and the two rules can disagree:
 * every absence in a month can sit inside its three-week window and still be a pattern.
 *
 * WHAT A §7-7 EXEMPTION DOES **NOT** DO HERE
 *
 * Nothing, and that is from the source rather than from caution. §7-7 changes one thing — §6-5's
 * window, from three weeks to twelve — and its text is about *"continuous absences"*. It says
 * nothing about the Frequent Absence Rule, and a pattern of half-attended months is not a
 * continuous absence. So `isExemptOn` is deliberately not a parameter of this function; if the
 * Ministry's answer is that an exemption also suspends §6-7, that is a change with a quotation
 * behind it, not a default.
 *
 * THE MONTH-3 READING, AND WHY THE TWO SOURCES MAY NOT ACTUALLY DISAGREE
 *
 * §6-7's prose allows a month-3 claim only where the agreement *"has been reconfirmed"*. §6-8's
 * three worked examples add *"OR attendance returns to normal"* — recorded as
 * [[unverified-claims]] item 61, which this code takes the narrow side of.
 *
 * But notice what this implementation does with the permissive route anyway: a month where
 * attendance returned to normal does not trigger, so it **ends the run**, and its own absences
 * are claimable under the 50% test with no reconfirmation needed. The two readings therefore
 * converge on every one of §6-8's examples. They can still part company on a month that returns
 * to normal overall while failing one trigger — absent three of four Fridays, say — and there the
 * narrow reading applies and under-claims. Item 61 stays open for that edge, and this is the
 * sharper question to put to the Ministry than the one recorded there.
 */
export function assessFrequentAbsence(input: {
  sessions: readonly EnrolledSession[];
  closures: readonly ServiceClosure[];
  /**
   * §6-7's third trigger *"excludes sessional services"*, so this decides whether it runs at all.
   * `null` means `centres.service_model` is not recorded, and the trigger is then reported as
   * unevaluated rather than skipped quietly.
   *
   * A boolean rather than the `ServiceModel` union because that union lives in `index.ts`, which
   * re-exports this module — importing it here would close a cycle. The mapping is one comparison
   * at the caller, which already holds the centre row.
   */
  isSessionalService: boolean | null;
  /**
   * Dates of `enrolment_reconfirmations` for **this enrolment** (0092 keys on the enrolment for
   * exactly this reason: a reconfirmation of a previous agreement must not unlock a month-3 claim
   * against a later one).
   */
  reconfirmedOn?: readonly string[];
}): FrequentAbsenceMonth[] {
  const byMonth = new Map<string, EnrolledSession[]>();
  for (const session of input.sessions) {
    const month = session.date.slice(0, 7);
    const list = byMonth.get(month);
    if (list) list.push(session);
    else byMonth.set(month, [session]);
  }
  if (byMonth.size === 0) return [];

  const months = [...byMonth.keys()].sort();
  const first = months[0] as string;
  const last = months[months.length - 1] as string;
  const suspending = input.closures.filter(suspendsTheWindow);
  const reconfirmations = input.reconfirmedOn ?? [];

  const out: FrequentAbsenceMonth[] = [];
  let runStart: string | null = null;
  let runLength = 0;

  for (let month = first; month <= last; month = nextMonth(month)) {
    const sessions = byMonth.get(month) ?? [];
    const gaps: string[] = [];

    if (sessions.length === 0) {
      /*
        No enrolled sessions at all: a month of closure, or one before the agreement started.
        It neither triggers nor resets, and the run carries across it **without advancing** —
        which is the neutral choice of the three available and the only one that is not an
        assertion about a month nobody can assess.
      */
      out.push({
        month,
        enrolledDays: 0,
        attendedDays: 0,
        triggers: [],
        triggered: false,
        monthOfRun: 0,
        claimable: true,
        reason: null,
        gaps: ['no enrolled sessions in this month, so §6-7 could not be assessed'],
      });
      continue;
    }

    const triggers: FrequentAbsenceTrigger[] = [];

    // Trigger 1 — the same enrolled weekday, more than half of them missed.
    const byWeekday = new Map<number, { enrolled: number; absent: number }>();
    for (const session of sessions) {
      const weekday = isoWeekdayOf(session.date);
      const seen = byWeekday.get(weekday) ?? { enrolled: 0, absent: 0 };
      seen.enrolled += 1;
      if (!session.attended) seen.absent += 1;
      byWeekday.set(weekday, seen);
    }
    for (const [weekday, seen] of [...byWeekday].sort((a, b) => a[0] - b[0])) {
      // `* 2 >` rather than `> / 2`: "more than half" of an odd count in integers, and no float.
      if (seen.absent * 2 > seen.enrolled) {
        triggers.push({
          kind: 'same-enrolled-day',
          isoWeekday: weekday,
          enrolled: seen.enrolled,
          absent: seen.absent,
        });
      }
    }

    // Trigger 2 — fewer days per week than enrolled, in more than half the weeks.
    const byWeek = new Map<string, { enrolled: number; attended: number }>();
    for (const session of sessions) {
      const key = mondayOf(session.date);
      const seen = byWeek.get(key) ?? { enrolled: 0, attended: 0 };
      seen.enrolled += 1;
      if (session.attended) seen.attended += 1;
      byWeek.set(key, seen);
    }
    let weeksShort = 0;
    for (const week of byWeek.values()) if (week.attended < week.enrolled) weeksShort += 1;
    if (weeksShort * 2 > byWeek.size) {
      triggers.push({ kind: 'fewer-days-per-week', weeks: byWeek.size, weeksShort });
    }

    // Trigger 3 — fewer hours than enrolled, on more than half of enrolled days. Sessional
    // services are excluded by the Handbook, in those words.
    if (input.isSessionalService === null) {
      gaps.push(
        "the service model is not recorded, so §6-7's third trigger — fewer hours than enrolled — was not assessed. The Handbook excludes sessional services from it, so the answer depends on which this is",
      );
    } else if (input.isSessionalService === false) {
      let daysShort = 0;
      let unknown = 0;
      for (const session of sessions) {
        /*
          An absent day is zero hours attended, which is literally fewer than enrolled, so it
          counts here as well as under trigger 1. That overlap is deliberate: the triggers are
          three routes to the same conclusion, not a partition, and excluding absences from the
          hours test would let a month of half-days-and-half-absences fail neither.
        */
        const actual = session.attended ? session.attendedMinutes ?? null : 0;
        if (actual === null) {
          unknown += 1;
          continue;
        }
        if (actual < session.minutes) daysShort += 1;
      }
      if (unknown === sessions.length) {
        gaps.push(
          "attended hours were not supplied, so §6-7's third trigger — fewer hours than enrolled — was not assessed",
        );
      } else if (unknown > 0) {
        gaps.push(
          `${unknown} of ${sessions.length} enrolled days have no complete attendance record, so the hours comparison skipped them`,
        );
      }
      if (daysShort * 2 > sessions.length) {
        triggers.push({ kind: 'fewer-hours-per-day', enrolledDays: sessions.length, daysShort });
      }
    }

    const triggered = triggers.length > 0;

    if (!triggered) {
      runStart = null;
      runLength = 0;
    } else {
      if (runStart === null) runStart = month;
      runLength += 1;

      /*
        §6-7: the rule *"may be extended"* across *"periods of two or more weeks of non-operation
        (holidays, renovations, etc.)"* — the same clause as §6-6.

        **This product does not apply that extension**, and says so here rather than deciding
        quietly. "May" is permissive and does not say by whom or on what terms, and applying it
        would push month 3 and month 4 later, making MORE months claimable on an inference. The
        direction these figures never get wrong is the other one. So the closure is reported and
        the run keeps counting — the same shape as the place cap, which `placeCapExceedances`
        reports and deliberately does not apply.
      */
      if (suspending.some((closure) => overlapsMonth(closure, month))) {
        gaps.push(
          'a closure of two weeks or more falls in this month. §6-7 says the rule "may be extended" across such a period; this product does not apply that extension, so the month still counts towards the run',
        );
      }
    }

    let claimable: boolean;
    let reason: string | null;

    if (!triggered) {
      claimable = true;
      reason = null;
    } else if (runLength <= 2) {
      // Month 1: note it and claim. Month 2: re-check, reconfirm if it continues, and claim.
      claimable = true;
      reason = null;
    } else if (runLength === 3) {
      /*
        *"Funding for absences in the third month must only be claimed if the child's enrolment
        agreement has been reconfirmed."*

        The window for that reconfirmation is the run itself: from the first day of the month the
        pattern started to the last day of this one. A reconfirmation predating the pattern
        reconfirms an agreement nobody had yet questioned, and one dated after the month it
        unlocks would be a claim made before its own condition existed.
      */
      const from = `${runStart as string}-01`;
      const to = lastDayOf(month);
      const reconfirmed = reconfirmations.some((date) => date >= from && date <= to);
      claimable = reconfirmed;
      reason = reconfirmed
        ? null
        : 'the third month of a frequent-absence pattern, and no reconfirmation of the enrolment agreement is recorded for it';
    } else {
      claimable = false;
      reason =
        'the fourth month or later of a frequent-absence pattern — §6-7 says these absences must not be claimed and the enrolment agreement must be changed to match the attendance';
    }

    out.push({
      month,
      enrolledDays: sessions.length,
      attendedDays: sessions.filter((session) => session.attended).length,
      triggers,
      triggered,
      monthOfRun: triggered ? runLength : 0,
      claimable,
      reason,
      gaps,
    });
  }

  return out;
}
