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
 * Total claimable absent minutes, for a caller that only wants the figure.
 *
 * Separate from the classifier rather than an option on it, because the per-session reasons
 * are the thing a service needs when a figure looks wrong — and a function that returned only
 * a total would make the next screen recompute the classification to explain itself.
 */
export function claimableAbsentMinutes(rows: readonly AbsenceClassification[]): number {
  return rows.reduce((sum, r) => (r.absent && r.claimable ? sum + r.minutes : sum), 0);
}
