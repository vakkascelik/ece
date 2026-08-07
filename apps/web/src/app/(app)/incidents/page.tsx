import { listChildren, listIncidents } from '@ece/api';
import { summariseIncidents, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { IncidentList, type IncidentRow } from './IncidentList';
import { NewIncident } from './NewIncident';

/**
 * The incident register.
 *
 * Staff only. A guardian reads their own child's *final* reports through the child
 * record, and 0030's policy is what enforces that — this page is behind
 * `recordDailyPractice` so the nav does not offer a parent a door they cannot open,
 * which is a usability decision and not the boundary.
 *
 * Defaults to the last fourteen days rather than today. An incident register is read
 * to answer "what is outstanding", and a draft opened on Friday afternoon that nobody
 * finalised is exactly the row a Monday visit needs to surface — a today-scoped page
 * would hide it.
 */
const WINDOW_DAYS = 14;

export default async function IncidentsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const requested = Number((await searchParams).days);
  const days = Number.isFinite(requested) && requested > 0 && requested <= 365 ? requested : WINDOW_DAYS;

  const today = todayInZone(ctx.centre.timezone);
  const start = shiftLocalDate(today, -(days - 1));

  const { fromUtc } = dayWindow(start, ctx.centre.timezone);
  const { toUtc } = dayWindow(today, ctx.centre.timezone);

  const [children, incidents] = await Promise.all([
    listChildren(db, ctx.centre.id),
    listIncidents(db, ctx.centre.id, fromUtc, toUtc),
  ]);

  const nameOf = new Map(children.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));

  /*
    Formatted here rather than in the client component. `toLocaleString` in the
    browser uses the device's zone, which is right on a tablet in the room and wrong
    on a laptop in another country — and an incident time that shifts depending on
    who opens the page is worse than useless in a review.
  */
  const fmt = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const rows: IncidentRow[] = incidents.map((incident) => ({
    incident,
    childName: nameOf.get(incident.childId) ?? 'A child no longer enrolled',
    occurredLabel: fmt.format(new Date(incident.occurredAt)),
    notifiedLabel: incident.parentNotifiedAt ? fmt.format(new Date(incident.parentNotifiedAt)) : null,
    acknowledgedLabel: incident.acknowledgedAt ? fmt.format(new Date(incident.acknowledgedAt)) : null,
  }));

  const summary = summariseIncidents(incidents);

  // The default for the "when" field: now, as a wall clock in the centre's zone.
  const nowParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ctx.centre.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const part = (t: string) => nowParts.find((p) => p.type === t)?.value ?? '00';
  const defaultWallClock = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;

  return (
    <>
      <h1>Incidents</h1>
      <p className="sub">
        Injuries, illness, behaviour and near misses at {ctx.centre.name}, over the last {days}{' '}
        days.
      </p>

      {/*
        What is outstanding, not how many happened. A centre with forty resolved
        incidents is in the same state as one with none, and a counter that only ever
        goes up is a counter nobody reads.
      */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        {summary.clear ? (
          <p style={{ margin: 0 }}>
            <span className="flag flag-ok">{'✓'} Nothing outstanding</span>{' '}
            <span className="sub">Every report in this period is final, sent and acknowledged.</span>
          </p>
        ) : (
          <p className="inline" style={{ margin: 0 }}>
            {summary.drafts > 0 && (
              <span className="flag flag-warn">
                {'●'} {summary.drafts} draft{summary.drafts === 1 ? '' : 's'}
              </span>
            )}
            {summary.awaitingNotification > 0 && (
              <span className="flag flag-critical">
                {'▲'} {summary.awaitingNotification} whānau not told
              </span>
            )}
            {summary.awaitingAcknowledgement > 0 && (
              <span className="flag flag-quiet">
                {summary.awaitingAcknowledgement} awaiting acknowledgement
              </span>
            )}
          </p>
        )}
      </div>

      <NewIncident
        childOptions={children.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }))}
        defaultWallClock={defaultWallClock}
      />

      <IncidentList rows={rows} />
    </>
  );
}
