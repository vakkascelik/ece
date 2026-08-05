import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listAttendanceToday,
  listChildren,
  listHealthByChild,
  readAdultsPresent,
  type AttendanceState,
} from '@ece/api';
import {
  buildRoll,
  hasCriticalCondition,
  type Child,
  type HealthCondition,
  type Roll,
  type RollEntry,
} from '@ece/core';
import { supabase } from '../lib/supabase';
import { useSession } from '../state/SessionProvider';

/**
 * The roll: who is enrolled, who is here, and what must not be forgotten about them.
 *
 * WHY THIS IS SEPARATE FROM THE FEED
 *
 * It used to be one function. `loadRoll` fetched the children, the attendance, the health
 * conditions, the adult count **and** the post feed with all of its signed media URLs — which was
 * fine when there was one screen. With tabs it means opening Pānui refetches the entire roll, and
 * every pull-to-refresh on the roll re-signs every photo URL.
 *
 * They are also wanted at different moments: the roll is read constantly between 7.30 and 9.00,
 * and the feed once. Splitting them lets the roll be cheap.
 *
 * THE QUEUE IS PART OF THE ANSWER
 *
 * `buildRoll` merges the server's attendance with the device's unsent queue, and that is not a
 * nicety: a child signed in while the wifi was down is in the building, and a ratio that does not
 * count them tells an educator the room is emptier than it is. The queue comes from the session
 * provider so that the badge, the ratio and the roll cannot disagree.
 */
export function useRoll() {
  const { activeCentre, centre, queued, online } = useSession();

  const [children, setChildren] = useState<Child[]>([]);
  const [serverStates, setServerStates] = useState<AttendanceState[]>([]);
  const [health, setHealth] = useState<Map<string, HealthCondition[]>>(new Map());
  const [adults, setAdults] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!activeCentre) return;
    setLoading(true);
    try {
      const [kids, states, conditions, adultCount] = await Promise.all([
        listChildren(supabase, activeCentre),
        listAttendanceToday(supabase, activeCentre),
        listHealthByChild(supabase, activeCentre),
        readAdultsPresent(supabase, activeCentre),
      ]);
      setChildren(kids);
      setServerStates(states);
      setHealth(conditions);
      setAdults(adultCount);
      setError(null);
    } catch (err) {
      // Offline is not an error worth clearing the screen for. What is on display is the last
      // roll fetched, merged with the queue: stale reference data, current attendance. That is
      // the right trade — an educator needs to know who is in the room now.
      setError(err instanceof Error ? err.message : 'Could not refresh the roll.');
    } finally {
      setLoading(false);
    }
  }, [activeCentre]);

  useEffect(() => {
    void load();
  }, [load]);

  const roll: Roll = useMemo(
    () =>
      buildRoll({
        children,
        serverStates,
        queued,
        health,
        adultsPresent: adults,
        // The centre's own zone, not the device's. An age band decides which ratio applies, and
        // a child who turns two overnight must do so on the centre's calendar — the old code
        // omitted this and leaned on the NZ default, which is right by luck rather than by rule.
        timeZone: centre?.timezone,
      }),
    [children, serverStates, queued, health, adults, centre?.timezone],
  );

  /**
   * Critical conditions first, then any condition, then alphabetical.
   *
   * Not cosmetic. An educator scanning a list at the door needs the anaphylaxis at the top,
   * because the cost of missing it is not the same as the cost of scrolling.
   */
  const ordered = useMemo(
    () =>
      // `entry.conditions`, not a second lookup in the health map: buildRoll has already
      // attached them, and reading the same fact from two places is how they come to disagree.
      [...roll.entries].sort((a, b) => {
        const rank = (e: RollEntry) =>
          hasCriticalCondition(e.conditions) ? 0 : e.conditions.length > 0 ? 1 : 2;
        const byRisk = rank(a) - rank(b);
        if (byRisk !== 0) return byRisk;
        return a.child.lastName.localeCompare(b.child.lastName);
      }),
    [roll.entries],
  );

  return { roll, ordered, health, loading, error, reload: load, online };
}
