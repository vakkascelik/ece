import { listChildren, listIncidents } from '@ece/api';
import { summariseIncidents, supersededIds, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { IncidentList, type IncidentRow } from './IncidentList';
import { NewIncident, type BasedOn } from './NewIncident';

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
  searchParams: Promise<{ days?: string; amend?: string; edit?: string }>;
}) {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const params = await searchParams;
  const requested = Number(params.days);
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

  const replaced = supersededIds(incidents);

  const rows: IncidentRow[] = incidents.map((incident) => ({
    incident,
    superseded: replaced.has(incident.id),
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

  /*
    The report the form is opened from — `?edit=` for a draft, `?amend=` for a final
    one. Never both: `edit` wins, arbitrarily, because a URL carrying both is
    malformed and picking one is better than rendering neither.

    Resolved from the rows already fetched rather than by a lookup, so an id outside
    this window or belonging to another centre simply does not match and the form
    opens as an ordinary new report. The safe direction, and it means the query
    parameter cannot be used to confirm that an incident exists somewhere the caller
    cannot see.

    Each mode refuses the other's rows. A draft cannot be amended — it is editable in
    place, so amending one would produce two rows where an edit was meant. A final
    report cannot be edited — 0030's trigger refuses it, and offering the control
    would be offering a button that fails.
  */
  const editTarget = params.edit
    ? incidents.find((i) => i.id === params.edit && i.status === 'draft')
    : undefined;
  const amendTarget =
    !editTarget && params.amend
      ? incidents.find(
          (i) => i.id === params.amend && i.status === 'final' && !replaced.has(i.id),
        )
      : undefined;
  const target = editTarget ?? amendTarget;

  // The wall clock the form starts from is the original's time in the centre's
  // zone — the incident happened when it happened, whatever the correction changes.
  const wallClockOf = (instant: string) => {
    const p = new Intl.DateTimeFormat('en-CA', {
      timeZone: ctx.centre.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(instant));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
  };

  const basedOn: BasedOn | null = target
    ? {
        mode: editTarget ? 'edit' : 'amend',
        id: target.id,
        childId: target.childId,
        kind: target.kind,
        occurredWallClock: wallClockOf(target.occurredAt),
        description: target.description,
        location: target.location,
        firstAidGiven: target.firstAidGiven,
        witnessName: target.witnessName,
      }
    : null;

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

      {/*
        `key` forces a remount when the form's subject or mode changes.

        Navigating from `/incidents` to `/incidents?amend=…` is the same route with
        different search params, so Next re-renders this client component rather than
        replacing it — `useState(Boolean(basedOn))` keeps whatever it was initialised
        with and the form stays collapsed while its props say otherwise. Every default
        value inside it has the same problem, so an effect that only opened the form
        would leave the fields showing the previous report.
      */}
      <NewIncident
        key={basedOn ? `${basedOn.mode}-${basedOn.id}` : 'new'}
        childOptions={children.map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }))}
        defaultWallClock={defaultWallClock}
        basedOn={basedOn}
      />

      <IncidentList rows={rows} />
    </>
  );
}
