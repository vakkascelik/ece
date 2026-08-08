/**
 * The ratio **next Tuesday**, before anybody is standing in the room.
 *
 * Everything else in this repo answers "what is the ratio now" or "what was it at
 * 10:40 last Tuesday". Both are necessary and both are late: a breach you learn about
 * at 10:41 has already happened, and one you learn about in a binder happened months
 * ago. This answers the only version of the question that can still be acted on —
 * *given who is booked and who is rostered, is the plan short, and when?*
 *
 * It is the join between two halves that already existed separately: `bookings` (0018)
 * holds the children expected on a day, `shifts` and `staff_leave` (0041) hold the
 * adults. Neither is worth much alone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT RUNS ON `assessRatio`, WHICH MEANS IT INHERITS `RATIO_TABLES_VERIFIED = false`
 *
 * Deliberately. A forecast computed against unverified bands is an unverified
 * forecast, and it says so through the same `verified` flag every other surface uses.
 * A forward-looking number is *more* dangerous to be confidently wrong about, not
 * less: it is the one a manager acts on by not calling a reliever.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY IT WORKS IN LOCAL CLOCK TIME AND NEVER TOUCHES A TIMEZONE
 *
 * Both sides are stored as a local date plus local times, which is the reason 0041
 * chose that shape over a `timestamptz` range. A roster is written as "Tuesday, 8
 * till 4" in the centre's own clock and a booking is written the same way, so the
 * comparison is a string comparison between two things already in the same frame.
 * Converting to instants would introduce a timezone conversion on each side of the
 * join, in a different place, with a different bug.
 *
 * WHY IT IS SEGMENTS AND NOT A SINGLE VERDICT
 *
 * Same reason `replayDay` is a replay and not a sample. The planned ratio is a step
 * function: it changes only where a booking or a shift begins or ends. "Tuesday is
 * short" is not actionable; "Tuesday between 15:00 and 16:00 you are one adult short"
 * tells somebody which two hours to cover.
 */

import { isUnderTwo } from './children';
import { assessRatio, RATIO_TABLES_VERIFIED, type RatioAssessment, type RatioTable } from './ratios';

/** A child expected on the day. Only `booked` is counted — see `forecastDay`. */
export interface ForecastBooking {
  childId: string;
  status: 'booked' | 'absent' | 'cancelled' | 'closed';
  /** Local clock. Null when the centre has not set hours for this booking. */
  fromTime: string | null;
  toTime: string | null;
}

export interface ForecastShift {
  staffMemberId: string;
  fromTime: string;
  toTime: string;
  status: 'planned' | 'confirmed' | 'cancelled';
}

export interface ForecastLeave {
  staffMemberId: string;
  fromDate: string;
  toDate: string;
  status: 'requested' | 'approved' | 'declined';
}

export interface ForecastSegment {
  /** Local clock, `HH:MM`. */
  from: string;
  to: string;
  assessment: RatioAssessment;
  /** Who is planned to be on. Named, so a shortfall says who is already covering it. */
  staffMemberIds: string[];
}

export interface DayForecast {
  date: string;
  segments: ForecastSegment[];
  /** The segments the whole thing exists for: where the plan is already short. */
  shortfalls: ForecastSegment[];
  /** Worst shortfall across the day, in adults. Zero when the plan holds. */
  worstShortfall: number;
  /**
   * Bookings with no hours set, counted across **every** segment.
   *
   * Reported rather than absorbed. Counting them everywhere is the conservative
   * direction — it can say "short" when the child would have gone home at noon, and
   * cannot say "fine" when they were there all day — but a forecast quietly inflated
   * by a data-entry gap teaches people to distrust it, so the screen gets to say why.
   */
  bookingsWithoutTimes: number;
  /**
   * Rostered people removed because approved leave covers this date.
   *
   * The single most valuable line here. The roster still shows them; without this the
   * forecast counts an adult who is on holiday.
   */
  onLeave: string[];
  verified: boolean;
}

/**
 * Normalise a Postgres `time` to `HH:MM`.
 *
 * Postgres returns `08:00:00`; a form returns `08:00`. Both sort correctly as strings
 * once they are the same width, and string comparison is the only comparison this
 * module does.
 */
function hhmm(t: string): string {
  const [h = '', m = '00'] = t.split(':');
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/**
 * Forecast one day.
 *
 * `children` carries dates of birth so the age band is computed **as at the forecast
 * date**, not today. The mirror of the rule in `replayDay`, running the other way: a
 * child who turns two next Tuesday is in the over-2 band next Tuesday, and using
 * today's ages would forecast against a room that will not exist.
 */
export function forecastDay(input: {
  date: string;
  bookings: ForecastBooking[];
  shifts: ForecastShift[];
  leave: ForecastLeave[];
  children: { id: string; dateOfBirth: string }[];
  underTwoTable?: RatioTable;
  twoAndOverTable?: RatioTable;
}): DayForecast {
  const dobById = new Map(input.children.map((c) => [c.id, c.dateOfBirth]));

  /*
   * Only APPROVED leave removes an adult.
   *
   * A requested-but-undecided day is not yet a fact about the roster, and forecasting
   * against it would show a manager a shortfall they can dismiss by declining — which
   * is a forecast that argues for its own conclusion. Declined leave obviously counts
   * for nothing. The same rule is written into `staff_leave_range_idx`, which only
   * indexes approved rows.
   */
  const onLeave = new Set(
    input.leave
      .filter((l) => l.status === 'approved' && l.fromDate <= input.date && l.toDate >= input.date)
      .map((l) => l.staffMemberId),
  );

  const shifts = input.shifts
    .filter((s) => s.status !== 'cancelled' && !onLeave.has(s.staffMemberId))
    .map((s) => ({ ...s, fromTime: hhmm(s.fromTime), toTime: hhmm(s.toTime) }));

  // `closed` is the centre being shut and `cancelled` is the booking being withdrawn;
  // `absent` is a family who have already said they are not coming. None of the three
  // put a child in the room.
  const booked = input.bookings.filter((b) => b.status === 'booked');
  const timed = booked
    .filter((b) => b.fromTime !== null && b.toTime !== null)
    .map((b) => ({
      childId: b.childId,
      fromTime: hhmm(b.fromTime as string),
      toTime: hhmm(b.toTime as string),
    }));
  const untimed = booked.filter((b) => b.fromTime === null || b.toTime === null);

  /*
   * Boundaries are the only moments the answer can change.
   *
   * Sampling every fifteen minutes would miss a forty-minute gap that starts at 14:50,
   * and store a hundred rows to say nothing happened. Same argument as `replayDay`.
   */
  const boundaries = [
    ...new Set([
      ...timed.flatMap((b) => [b.fromTime, b.toTime]),
      ...shifts.flatMap((s) => [s.fromTime, s.toTime]),
    ]),
  ].sort();

  const segments: ForecastSegment[] = [];

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const from = boundaries[i] as string;
    const to = boundaries[i + 1] as string;

    // Half-open, `[from, to)`: a shift ending at 16:00 does not staff the segment
    // starting at 16:00, and a child leaving at 16:00 is not in it. The same bound the
    // exclusion constraint in 0041 uses, for the same reason — a handover is not an
    // overlap, and treating it as one invents an adult.
    const presentChildIds = [
      ...timed.filter((b) => b.fromTime <= from && b.toTime > from).map((b) => b.childId),
      ...untimed.map((b) => b.childId),
    ];
    const staffMemberIds = shifts
      .filter((s) => s.fromTime <= from && s.toTime > from)
      .map((s) => s.staffMemberId);

    let underTwo = 0;
    for (const childId of presentChildIds) {
      const dob = dobById.get(childId);
      // A booking whose child is not in `children` is counted and banded as over 2 —
      // the same weaker assumption `replayDay` makes, so the two never disagree about
      // the same child. Leaving them out would flatter the forecast.
      if (dob && isUnderTwo(dob, input.date)) underTwo += 1;
    }

    segments.push({
      from,
      to,
      staffMemberIds,
      assessment: assessRatio({
        underTwo,
        twoAndOver: presentChildIds.length - underTwo,
        adultsPresent: staffMemberIds.length,
        underTwoTable: input.underTwoTable,
        twoAndOverTable: input.twoAndOverTable,
      }),
    });
  }

  const merged = mergeAdjacent(segments);
  const shortfalls = merged.filter((s) => s.assessment.shortfall > 0);

  return {
    date: input.date,
    segments: merged,
    shortfalls,
    worstShortfall: shortfalls.reduce((worst, s) => Math.max(worst, s.assessment.shortfall), 0),
    bookingsWithoutTimes: untimed.length,
    onLeave: [...onLeave],
    verified: RATIO_TABLES_VERIFIED,
  };
}

/**
 * Collapse neighbouring segments that say the same thing.
 *
 * One child leaving at 15:00 while another arrives at 15:00 creates a boundary where
 * nothing net changes, and a day of those renders as a wall of identical strips that
 * nobody reads. Merged only when the counts **and the people** match: two segments
 * with three adults are not the same segment if they are three different adults, and
 * a shortfall that names the wrong person is worse than one that names nobody.
 */
function mergeAdjacent(segments: ForecastSegment[]): ForecastSegment[] {
  const out: ForecastSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    const same =
      last !== undefined &&
      last.to === segment.from &&
      last.assessment.underTwo === segment.assessment.underTwo &&
      last.assessment.twoAndOver === segment.assessment.twoAndOver &&
      last.staffMemberIds.length === segment.staffMemberIds.length &&
      last.staffMemberIds.every((id) => segment.staffMemberIds.includes(id));

    if (same) last.to = segment.to;
    else out.push({ ...segment, staffMemberIds: [...segment.staffMemberIds] });
  }
  return out;
}

/**
 * One line for a day, for a week view that has no room for segments.
 *
 * Says nothing rather than "fine" when there is nothing to go on. An empty plan
 * reported as compliant is the exact failure this module exists to prevent, one level
 * up.
 */
export function summariseForecast(day: DayForecast): string {
  if (day.segments.length === 0) return 'Nothing booked or rostered.';
  if (day.shortfalls.length === 0) return 'The plan covers the day.';

  const first = day.shortfalls[0] as ForecastSegment;
  const more = day.shortfalls.length - 1;
  const adults = day.worstShortfall === 1 ? '1 adult' : `${day.worstShortfall} adults`;

  return `Short ${adults} from ${first.from}${
    more > 0 ? `, and in ${more} other period${more === 1 ? '' : 's'}` : ''
  }.`;
}
