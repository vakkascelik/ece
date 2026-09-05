/**
 * Staff hours **counted towards regulated staff** — Funding Handbook §9-4.
 *
 * The RS7 return wants `StaffHourQualifiedCount` and `StaffHourNotQualifiedCount` for each
 * calendar date, and §9-4 is specific about which hours those are: the ones *"at times when
 * they were counted towards regulated (ratio) staff"*. Not hours present. Not hours rostered.
 *
 *     counted = paired attendance  −  the intervals in `staff_off_floor` (0094)
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE PAIRING IS `attendedHours` AND NOT A SECOND COPY
 *
 * `staff_attendance_events` (0039) has the same shape as children's attendance and says so:
 * the same `attendance_kind` enum, the same `corrects` supersession, the same `client_uuid`
 * idempotency. So the pairing, the correction resolution, and the definition of a day whose
 * record is broken all come from `attendedHours` in `./hours`.
 *
 * That matters beyond tidiness. `pairDay` treats a missing sign-out as making the day's total
 * **unknown**, and a payroll-shaped figure that silently assumed somebody went home at closing
 * time would be a different and worse kind of wrong on a Crown return.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THREE STATES FOR "QUALIFIED", BECAUSE TWO WOULD INVENT AN ANSWER
 *
 * `registrationOf` in `./census` is already three-state — a person has a current practising
 * certificate, has one that lapsed, or **has none on file at all**. RS7 offers two buckets and
 * no third, so the hours of a person nobody has recorded a certificate for cannot go in either
 * without asserting something.
 *
 * They go in `unknownMinutes` and are named. A service that has not linked its certificates
 * would otherwise see every hour land in `StaffHourNotQualifiedCount`, which is a claim about
 * its teachers rather than about its paperwork.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS CANNOT ANSWER, AND IT IS THE CENTRE'S CONFIGURATION RATHER THAN A GAP HERE
 *
 * `centres.ratio_source` (0040) defaults to `'declared'`, and a declared centre records no
 * per-person staff attendance at all — only the aggregate somebody typed into the adult count.
 * There is nothing for the off-floor intervals to subtract from, so §9-4's figures are
 * unavailable for such a centre and the caller must say so rather than report a zero.
 */

import { attendedHours, type HoursEvent } from './hours';
// `timeToMinutes` is `weekdayBlock`'s. A second copy was written here and deleted before it
// shipped: identical rules, identical null-on-unparseable contract, and this repo has paid
// for two hand-maintained copies of one thing before — `tokens:check` exists because of it.
import { timeToMinutes } from './weekdayBlock';

/** One interval a person was present and not counted — a row of `staff_off_floor` (0094). */
export interface OffFloorInterval {
  staffMemberId: string;
  /** Local date, `YYYY-MM-DD`. */
  onDate: string;
  /** Local wall clock, `HH:MM` or `HH:MM:SS`. */
  fromTime: string;
  toTime: string;
}

/** One person's day. */
export interface StaffDayHours {
  staffMemberId: string;
  date: string;
  presentMinutes: number;
  /** The part of `presentMinutes` that overlapped an off-floor interval. */
  offFloorMinutes: number;
  /** `presentMinutes − offFloorMinutes`, never negative. */
  countedMinutes: number;
  /**
   * False when the day's attendance record is broken — a missing sign-out. The minutes are
   * still reported, and a caller must not add them to a claim.
   */
  complete: boolean;
}

/** One calendar date, across everybody. */
export interface StaffDayTotals {
  date: string;
  qualifiedMinutes: number;
  notQualifiedMinutes: number;
  /** Minutes belonging to somebody with no practising certificate on file. Neither bucket. */
  unknownMinutes: number;
  /** Minutes on a day whose attendance record is incomplete. Excluded from the three above. */
  unresolvedMinutes: number;
}

/**
 * An instant → minutes from midnight **in the centre's zone**.
 *
 * A separate question from `todayInZone`, which answers the date, and it uses the same
 * `formatToParts` idiom for the same reason: a locale that happens to format ISO-ish is a
 * dependency on locale data. `hour12: false` because `hourCycle` support has been uneven, and
 * midnight is the case that differs — `h23` gives `00`, `h12` gives `24`.
 */
function localMinutes(at: string, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(at));
    const get = (type: string) => parts.find((p) => p.type === type)?.value;
    const h = get('hour');
    const m = get('minute');
    if (h === undefined || m === undefined) return null;
    // `en-US` with hour12:false yields `24` for midnight in some ICU versions.
    const hours = Number(h) % 24;
    return hours * 60 + Number(m);
  } catch {
    return null;
  }
}

/** Minutes shared by `[aFrom, aTo)` and `[bFrom, bTo)`. */
function overlap(aFrom: number, aTo: number, bFrom: number, bTo: number): number {
  return Math.max(0, Math.min(aTo, bTo) - Math.max(aFrom, bFrom));
}

/**
 * Counted staff hours, per person per day and per date in total.
 *
 * `qualified` is the caller's three-state answer for that person — `registrationOf` in
 * `./census` produces exactly it, and keying on a **current practising certificate** rather
 * than on `highest_qualification_code` is deliberate: the qualification code is free text
 * against a Ministry list that ships empty, and a currency rule already exists in
 * `countCertificated` (a null expiry is **not** current).
 */
export function countedStaffHours(input: {
  staff: readonly {
    staffMemberId: string;
    events: HoursEvent[];
    /**
     * Was this person a certificated teacher **on that date**, three-state.
     *
     * A predicate rather than a boolean because a practising certificate expires, and over a
     * four-month funding period one plausibly expires mid-way. Hours before the expiry are
     * qualified and hours after are not, and asking "are they certificated today" would
     * reclassify the whole period by when the return happened to be run.
     *
     * The same rule `ageInMonths(dob, date)` follows for the age bands, and `replayDay` for
     * the ratio: judge as at the day being counted, never as at now.
     */
    qualifiedOn: (date: string) => boolean | null;
  }[];
  offFloor: readonly OffFloorInterval[];
  timeZone: string;
}): { people: StaffDayHours[]; totals: StaffDayTotals[]; gaps: string[] } {
  const byMember = new Map<string, OffFloorInterval[]>();
  for (const interval of input.offFloor) {
    const list = byMember.get(interval.staffMemberId);
    if (list) list.push(interval);
    else byMember.set(interval.staffMemberId, [interval]);
  }

  const people: StaffDayHours[] = [];
  const unparseable: string[] = [];

  for (const person of input.staff) {
    const { days } = attendedHours({ events: person.events, timeZone: input.timeZone });
    const intervals = byMember.get(person.staffMemberId) ?? [];

    for (const day of days) {
      let offFloorMinutes = 0;

      for (const interval of intervals) {
        if (interval.onDate !== day.date) continue;
        const from = timeToMinutes(interval.fromTime);
        const to = timeToMinutes(interval.toTime);
        if (from === null || to === null || to <= from) {
          unparseable.push(`${interval.onDate} ${interval.fromTime}–${interval.toTime}`);
          continue;
        }

        /*
          Subtract only the part that overlapped an actual session. An interval recorded for a
          day somebody did not work, or outside the hours they did, removes nothing — the
          database deliberately does not constrain an off-floor row to fall inside attendance,
          because that is a cross-table check and the intersection already handles it.
        */
        for (const session of day.sessions) {
          const start = localMinutes(session.in, input.timeZone);
          const end = localMinutes(session.out, input.timeZone);
          if (start === null || end === null || end <= start) continue;
          offFloorMinutes += overlap(start, end, from, to);
        }
      }

      people.push({
        staffMemberId: person.staffMemberId,
        date: day.date,
        presentMinutes: day.minutes,
        offFloorMinutes,
        // Never negative. Overlapping intervals cannot both be counted — 0094's exclusion
        // constraint refuses them — but a clamp is cheaper than trusting a constraint from here.
        countedMinutes: Math.max(0, day.minutes - offFloorMinutes),
        complete: day.complete,
      });
    }
  }

  const totals = new Map<string, StaffDayTotals>();
  const qualifiedOf = new Map(input.staff.map((p) => [p.staffMemberId, p.qualifiedOn]));
  const unknownPeople = new Set<string>();

  for (const row of people) {
    let day = totals.get(row.date);
    if (!day) {
      day = {
        date: row.date,
        qualifiedMinutes: 0,
        notQualifiedMinutes: 0,
        unknownMinutes: 0,
        unresolvedMinutes: 0,
      };
      totals.set(row.date, day);
    }

    /*
      An incomplete day is not split by qualification at all. Its total is unknown — a missing
      sign-out means nobody knows when the person left — so attributing it to either bucket
      would put a guessed number on the return under a confident heading.
    */
    if (!row.complete) {
      day.unresolvedMinutes += row.countedMinutes;
      continue;
    }

    const qualified = qualifiedOf.get(row.staffMemberId)?.(row.date) ?? null;
    if (qualified === true) day.qualifiedMinutes += row.countedMinutes;
    else if (qualified === false) day.notQualifiedMinutes += row.countedMinutes;
    else {
      day.unknownMinutes += row.countedMinutes;
      unknownPeople.add(row.staffMemberId);
    }
  }

  const gaps: string[] = [];
  if (unknownPeople.size > 0) {
    gaps.push(
      `${unknownPeople.size} ${unknownPeople.size === 1 ? 'person has' : 'people have'} no practising certificate on file, so their hours are in neither the qualified nor the not-qualified figure. Linking the certificate to the staff record places them.`,
    );
  }
  if (unparseable.length > 0) {
    gaps.push(
      `${unparseable.length} off-floor interval${unparseable.length === 1 ? '' : 's'} could not be read and ${unparseable.length === 1 ? 'was' : 'were'} not subtracted: ${unparseable.slice(0, 3).join(', ')}.`,
    );
  }
  /*
    KEYED ON THE FLAG, NOT ON THE MINUTES, and the first draft had it the other way round.

    An incomplete day's minutes are **zero** by construction: `pairDay` completes no session
    when the sign-out is missing, so there is nothing to add up. Testing `unresolvedMinutes > 0`
    therefore made a broken attendance record invisible — the exact condition this gap exists to
    surface, silently dropped. The test caught it.
  */
  const unresolved = new Set(people.filter((p) => !p.complete).map((p) => p.date));
  if (unresolved.size > 0) {
    gaps.push(
      `${unresolved.size} date${unresolved.size === 1 ? ' has' : 's have'} an incomplete staff attendance record — somebody signed in and not out — so those hours are in no figure.`,
    );
  }

  return {
    people,
    totals: [...totals.values()].sort((a, b) => a.date.localeCompare(b.date)),
    gaps,
  };
}
