'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  buildRoll,
  compareBySeverity,
  displayName,
  formatAge,
  hasCriticalCondition,
  initials,
  isUnderTwo,
  todayInZone,
  type Child,
  type HealthCondition,
  type ServerAttendanceState,
} from '@ece/core';
import { browserDb } from '@/lib/supabaseBrowser';
import { flush, enqueue, pending, OUTBOX_EVENT, type OutboxEntry } from '@/lib/outbox';
import { AttendanceRow } from './AttendanceRow';
import { OfflineStrip } from './OfflineStrip';
import { RatioBanner } from './RatioBanner';

/**
 * The roll, and screen 4 of the design pack.
 *
 * WHY THE ROLL MOVED TO THE CLIENT
 *
 * Not for interactivity — it had that already through server actions. It moved because a
 * queued sign-in has to **count toward the ratio**, and the ratio is derived from the roll. A
 * server component cannot see a queue that lives in the browser, so an offline sign-in would
 * have shown a child present while the ratio still counted the room one short. Wrong in the
 * dangerous direction, which is the one direction this feature exists to avoid.
 *
 * `buildRoll` in `@ece/core` does the merge and is tested there. Its rule is the part that is
 * easy to get wrong: for each child the state is whichever event is **latest by its own
 * timestamp**, server or queued — not "queued wins", which would show a child present all
 * evening after a working tablet signed them out.
 *
 * ONE WRITE PATH, NOT TWO
 *
 * Every tap enqueues locally and then tries to flush immediately. There is no separate
 * "online" branch, and that is deliberate: a fallback path only exercised when the wifi drops
 * is a path nobody has ever seen work. This is the same shape the mobile app has used since
 * Phase 2. The cost is that the write no longer goes through a server action, so
 * `router.refresh()` is what pulls the server's own view back down once the queue drains.
 */
export function RollClient({
  childList,
  serverStates,
  healthPairs,
  adultsPresent,
  timeZone,
}: {
  /** Not `children`: that name is React's slot prop and this component takes no slot. */
  childList: Child[];
  serverStates: (ServerAttendanceState & { eventId?: number })[];
  /** A Map cannot cross the server/client boundary, so it arrives as pairs. */
  healthPairs: [string, HealthCondition[]][];
  adultsPresent: number;
  timeZone: string;
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<OutboxEntry[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Read on mount rather than during render: localStorage does not exist on the server, and
  // reading it in render would make the first client paint disagree with the server's HTML.
  useEffect(() => {
    const sync = () => setQueue(pending());
    sync();
    window.addEventListener(OUTBOX_EVENT, sync);
    // `storage` fires for *other* tabs. Two tablets in one room are two devices, but two tabs
    // on one tablet are one queue and must not disagree about it.
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(OUTBOX_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const send = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await flush(browserDb());
      setQueue(pending());
      // Only when something actually landed. A refresh on every failed attempt would
      // re-render the roll from the server on a loop while the wifi is down.
      if (result.sent > 0) router.refresh();
    } finally {
      setSyncing(false);
    }
  }, [router]);

  useEffect(() => {
    setOnline(navigator.onLine);
    const back = () => {
      setOnline(true);
      void send();
    };
    const gone = () => setOnline(false);
    window.addEventListener('online', back);
    window.addEventListener('offline', gone);
    // A queue left over from a previous visit — the tablet was closed with work in it.
    if (navigator.onLine) void send();
    return () => {
      window.removeEventListener('online', back);
      window.removeEventListener('offline', gone);
    };
  }, [send]);

  const toggle = useCallback(
    (childId: string, present: boolean) => {
      // Local first, always. The row shows its chip in this same tick, which is why the
      // outbox is synchronous.
      enqueue({ childId, kind: present ? 'out' : 'in' });
      setQueue(pending());
      void send();
    },
    [send],
  );

  const health = new Map(healthPairs);
  // The server event id per child, for the correction form. Not part of `buildRoll`'s domain
  // shape — it is a database row id, and core deliberately knows nothing about those.
  const eventIds = new Map(serverStates.map((s) => [s.childId, s.eventId ?? null]));
  const roll = buildRoll({
    children: childList,
    serverStates,
    queued: queue,
    health,
    adultsPresent,
    timeZone,
  });

  const here = roll.entries.filter((e) => e.present);
  const away = roll.entries.filter((e) => !e.present);

  /*
    The centre's date, resolved once.

    `formatAge(dob, on)` takes a DATE as its second argument; `splitByAgeBand(children, tz)`
    takes a TIMEZONE. Both are optional strings and the trap is obvious in hindsight — passing
    a zone where a date belongs throws `Not an ISO date: Pacific/Auckland`, which is how this
    was caught. `buildRoll` above gets the zone because it forwards to `splitByAgeBand`; the
    two calls below get the date.
  */
  const today = todayInZone(timeZone);

  return (
    <>
      <RatioBanner ratio={roll.ratio} />

      <OfflineStrip
        online={online}
        pendingCount={roll.pendingCount}
        syncing={syncing}
        onRetry={() => void send()}
      />

      <section className="section" aria-labelledby="here-heading">
        <h2 id="here-heading">Here now — {here.length}</h2>
        {here.length === 0 ? (
          <div className="card">
            <p className="empty">Nobody signed in yet.</p>
          </div>
        ) : (
          <Rows entries={here} onToggle={toggle} today={today} eventIds={eventIds} />
        )}
      </section>

      <section className="section" aria-labelledby="away-heading">
        <h2 id="away-heading">Not here — {away.length}</h2>
        {away.length === 0 ? (
          <div className="card">
            <p className="empty">Everyone enrolled is signed in.</p>
          </div>
        ) : (
          <Rows entries={away} onToggle={toggle} today={today} eventIds={eventIds} />
        )}
      </section>
    </>
  );
}

function Rows({
  entries,
  onToggle,
  today,
  eventIds,
}: {
  entries: ReturnType<typeof buildRoll>['entries'];
  onToggle: (childId: string, present: boolean) => void;
  /** The centre's date, not its timezone. See the note where it is computed. */
  today: string;
  eventIds: Map<string, number | null>;
}) {
  return (
    <ul className="roll">
      {entries.map(({ child, present, since, conditions, pending: unsent }) => {
        const worst = [...conditions].sort(compareBySeverity)[0];
        return (
          <AttendanceRow
            key={child.id}
            childId={child.id}
            name={displayName(child)}
            monogram={initials(child)}
            age={formatAge(child.dateOfBirth, today)}
            underTwo={isUnderTwo(child.dateOfBirth, today)}
            present={present}
            since={since}
            unsent={unsent}
            eventId={eventIds.get(child.id) ?? null}
            onToggle={() => onToggle(child.id, present)}
            critical={
              hasCriticalCondition(conditions) && worst
                ? {
                    label: worst.severity === 'anaphylaxis' ? 'Anaphylaxis' : 'Severe',
                    name: worst.name,
                  }
                : null
            }
          />
        );
      })}
    </ul>
  );
}
