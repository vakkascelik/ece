/**
 * How full the centre has been, and when it cannot say.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ABSENT DENOMINATOR IS A RESULT, NOT A ZERO
 *
 * Occupancy is attendance over licensed places, and `licensed_places` is null until a
 * centre types it in (0050). The tempting shapes are all wrong in the same direction:
 *
 *   - `percent: 0` — reads as an empty centre, which is a crisis rather than a blank field.
 *   - `percent: null` and let the screen decide — every call site re-invents the sentence,
 *     and one of them eventually renders "null%" or silently `?? 0`.
 *   - default the licence to something — a licence is 10 to 150 places depending on the
 *     service, so being wrong by a factor of three produces a confident, actionable lie.
 *
 * So the return type has two branches and a caller cannot read a percentage without
 * having handled the case where there is not one. The type does the arguing.
 */

import type { OperatingDays } from './closures';

/** One day's attendance, already counted. */
export interface DayAttendance {
  /** Local date, `YYYY-MM-DD`. Never derived from a UTC instant here. */
  date: string;
  /** Distinct children present at any point that day. */
  children: number;
}

export type DayOccupancy =
  | { date: string; children: number; stated: true; licensedPlaces: number; percent: number }
  | { date: string; children: number; stated: false };

/**
 * Attendance against the licence, per day.
 *
 * `percent` is rounded to one decimal and **not capped at 100**. A day over the licence
 * is the single most important row this report can contain — it is a compliance event —
 * and clamping it to 100% would hide exactly the thing somebody is looking for. It is
 * also possible without anybody breaking a rule: `children` counts everyone present at
 * any point in the day, so a morning child leaving before an afternoon child arrives can
 * exceed the licence over a day while never exceeding it at any instant.
 *
 * That distinction is real and the screen has to say it, because the alternative is a
 * report that accuses a centre of a breach it did not commit. `replayDay` is what
 * answers the instantaneous question; this answers the daily one.
 */
export function dayOccupancy(
  day: DayAttendance,
  licensedPlaces: number | null,
): DayOccupancy {
  if (licensedPlaces === null || licensedPlaces <= 0) {
    return { date: day.date, children: day.children, stated: false };
  }
  return {
    date: day.date,
    children: day.children,
    stated: true,
    licensedPlaces,
    percent: Math.round((day.children / licensedPlaces) * 1000) / 10,
  };
}

export interface OccupancySummary {
  days: DayOccupancy[];
  /** Days with at least one child. The denominator for the average below. */
  daysWithAttendance: number;
  /** Busiest day, or null when nothing was recorded at all. */
  busiest: DayAttendance | null;
  /**
   * Mean children per day **across days that had any**, or null when none did.
   *
   * Closed days are excluded deliberately. Averaging a fortnight that contains ten
   * weekends and four open days over fourteen produces a figure a third of the truth,
   * and it is the figure somebody would put in a board paper. The count is returned
   * alongside so a reader knows what the average is over.
   */
  averageChildren: number | null;
  /**
   * What `averageChildren` is over. **A screen must render this** — the two bases produce
   * different figures from the same attendance, and item 59 is on this page because one of
   * them was presented as the other for weeks.
   */
  averageBasis: AverageBasis;
  /** The denominator `averageChildren` used. */
  denominatorDays: number;
  /** Days at or above the licence, when there is one. Empty when not stated. */
  daysAtOrOverLicence: string[];
}

/** What an average was computed over. Returned, never inferred from the numbers. */
export type AverageBasis =
  /** The operating calendar: closures and the booking schedule decided the denominator. */
  | 'operating-days'
  /** No schedule was available, so days with no attendance were assumed closed. */
  | 'attendance-proxy';

/**
 * Mean children per day, and **what the mean is over**.
 *
 * The one averaging rule this product uses everywhere a span of days is reduced to one
 * number — here, and in `attendanceTrend.ts`'s weekly and weekday summaries. Factored out
 * because it was about to be written a third time with a fourth chance to drift: the first
 * two copies already disagreed on rounding before this existed.
 *
 * THE PROXY THIS USED TO BE, AND WHY IT WAS WRONG — [[unverified-claims]] item 59
 *
 * It filtered with `d.children > 0` and called the result "open days". That cannot tell a
 * **closed** day from an **open day nobody attended**, and the two belong on opposite sides
 * of the division: a Saturday is not a data point, and a wet Tuesday when four children came
 * out of thirty is the most important one in the range. Excluding it flatters the average by
 * exactly the days a centre would most want to see.
 *
 * The proxy also could not be fixed by counting every day instead. A fortnight holds ten
 * weekend days no service records as closures, so averaging over all fourteen reports about a
 * third of the truth — and it is the figure that ends up in a board paper.
 *
 * So the denominator is now the **operating calendar** where one can be derived, and the
 * proxy survives, named, for where it cannot. `operatingDays()` in `./closures` answers the
 * question and refuses to guess; this function decides what to do about the refusal, because
 * it is the one that knows what the figure means.
 */
export function averageOverOpenDays(
  days: readonly DayAttendance[],
  operating?: OperatingDays | null,
): {
  daysWithAttendance: number;
  averageChildren: number | null;
  basis: AverageBasis;
  /** The denominator actually used. Equals `daysWithAttendance` on the proxy basis. */
  denominatorDays: number;
} {
  const attended = days.filter((d) => d.children > 0);

  /*
    `basis === 'schedule'` is the only value that licenses the operating calendar. `unknown`
    means no block was effective in the range, and an empty `dates` there would make every
    average null rather than falling back.
  */
  if (operating && operating.basis === 'schedule') {
    const operated = new Set(operating.dates);
    /*
      Days the service operated, whether or not anybody came — a real zero belongs in the
      denominator. A day with attendance that is NOT in the calendar is still counted: the
      children were demonstrably there, so the calendar is what is wrong, and dropping the day
      would hide an attendance record that contradicts the schedule.
    */
    const counted = days.filter((d) => operated.has(d.date) || d.children > 0);
    return {
      daysWithAttendance: attended.length,
      averageChildren:
        counted.length === 0
          ? null
          : Math.round((counted.reduce((sum, d) => sum + d.children, 0) / counted.length) * 10) /
            10,
      basis: 'operating-days',
      denominatorDays: counted.length,
    };
  }

  return {
    daysWithAttendance: attended.length,
    averageChildren:
      attended.length === 0
        ? null
        : Math.round((attended.reduce((sum, d) => sum + d.children, 0) / attended.length) * 10) /
          10,
    basis: 'attendance-proxy',
    denominatorDays: attended.length,
  };
}

export function summariseOccupancy(
  days: readonly DayAttendance[],
  licensedPlaces: number | null,
  /**
   * The operating calendar, from `operatingDays()`. Optional so no existing caller changes
   * behaviour by upgrading — omitting it yields the proxy basis, which is what those callers
   * were already getting, and now says so.
   */
  operating?: OperatingDays | null,
): OccupancySummary {
  const assessed = days.map((d) => dayOccupancy(d, licensedPlaces));
  const open = days.filter((d) => d.children > 0);

  const busiest = open.reduce<DayAttendance | null>(
    (best, d) => (best === null || d.children > best.children ? d : best),
    null,
  );

  const { daysWithAttendance, averageChildren, basis, denominatorDays } = averageOverOpenDays(
    days,
    operating,
  );

  const daysAtOrOverLicence = assessed
    .filter((d) => d.stated && d.children >= d.licensedPlaces)
    .map((d) => d.date);

  return {
    days: assessed,
    daysWithAttendance,
    busiest,
    averageChildren,
    averageBasis: basis,
    denominatorDays,
    daysAtOrOverLicence,
  };
}
