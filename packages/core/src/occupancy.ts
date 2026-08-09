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
  /** Days at or above the licence, when there is one. Empty when not stated. */
  daysAtOrOverLicence: string[];
}

/**
 * Mean children **across days that had any attendance**, or null when none did.
 *
 * The one averaging rule this product uses everywhere a span of days is reduced to one
 * number — here, and in `attendanceTrend.ts`'s weekly and weekday summaries. Factored out
 * because it was about to be written a third time with a fourth chance to drift: the first
 * two copies (the overall figure and, briefly, a per-week draft of it) already disagreed on
 * rounding before this existed. Closed days are excluded for the reason `OccupancySummary`
 * documents above — averaging them in reports a fraction of the truth that looks precise.
 */
export function averageOverOpenDays(
  days: readonly DayAttendance[],
): { daysWithAttendance: number; averageChildren: number | null } {
  const open = days.filter((d) => d.children > 0);
  return {
    daysWithAttendance: open.length,
    averageChildren:
      open.length === 0
        ? null
        : Math.round((open.reduce((sum, d) => sum + d.children, 0) / open.length) * 10) / 10,
  };
}

export function summariseOccupancy(
  days: readonly DayAttendance[],
  licensedPlaces: number | null,
): OccupancySummary {
  const assessed = days.map((d) => dayOccupancy(d, licensedPlaces));
  const open = days.filter((d) => d.children > 0);

  const busiest = open.reduce<DayAttendance | null>(
    (best, d) => (best === null || d.children > best.children ? d : best),
    null,
  );

  const { daysWithAttendance, averageChildren } = averageOverOpenDays(days);

  const daysAtOrOverLicence = assessed
    .filter((d) => d.stated && d.children >= d.licensedPlaces)
    .map((d) => d.date);

  return {
    days: assessed,
    daysWithAttendance,
    busiest,
    averageChildren,
    daysAtOrOverLicence,
  };
}
