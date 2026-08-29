import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getChild,
  getIncidentInvestigation,
  listHazards,
  listIncidentPhotos,
  listIncidents,
  listRooms,
  readDayRatio,
  signEvidenceUrl,
} from '@ece/api';
import {
  INCIDENT_KIND_LABELS,
  ratioInputCaveat,
  roomName,
  snapshotAt,
  todayInZone,
} from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../../PageHeader';
import { EvidencePhotos } from '../../evidence/EvidencePhotos';
import { InvestigationForm } from './InvestigationForm';

/**
 * One incident: its investigation, the ratio at the time, its photos.
 *
 * The other half of 1Place's incident form — their Investigation tab, found in the
 * 2026-08-29 screenshots (docs/replacing-1place.md §7.3). Staff-only; a guardian
 * reads the report itself through the child record, and 0074's policy is what keeps
 * this page's content from them, not this route.
 *
 * THE RATIO IS COMPUTED, NOT ASKED FOR
 *
 * 1Place asks staff to type "Staff : Child Ratio (in the child's room at the time of
 * the incident)" into a text box, from memory, after the event. This page replays
 * the attendance register instead — the same `replayDay` the compliance binder uses
 * — and reports what was *recorded*, with its limits stated: centre-wide (attendance
 * does not know rooms), and only as good as what was signed in.
 */
const WINDOW_DAYS = 400;

export default async function IncidentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  // Same window-and-find as the print page, for the same reason: no `getIncident`
  // means a guessed URL cannot probe for a record's existence.
  const today = todayInZone(ctx.centre.timezone);
  const { fromUtc } = dayWindow(shiftLocalDate(today, -WINDOW_DAYS), ctx.centre.timezone);
  const { toUtc } = dayWindow(today, ctx.centre.timezone);

  const incidents = await listIncidents(db, ctx.centre.id, fromUtc, toUtc);
  const incident = incidents.find((i) => i.id === id) ?? null;
  if (!incident) notFound();

  const [child, rooms, hazards, investigation, photos] = await Promise.all([
    getChild(db, incident.childId),
    listRooms(db, ctx.centre.id),
    listHazards(db, ctx.centre.id),
    getIncidentInvestigation(db, incident.id),
    listIncidentPhotos(db, incident.id),
  ]);

  /*
    The ratio at the moment it happened, replayed from the register. One day's
    events, then the last snapshot at or before the incident — the ratio is a step
    function, so this is exact, not sampled. Null means the register holds nothing
    before that moment on that day, and the page says so rather than inventing an
    empty room.
  */
  const incidentDate = todayInZone(ctx.centre.timezone, new Date(incident.occurredAt));
  const window = dayWindow(incidentDate, ctx.centre.timezone);
  const replay = await readDayRatio(db, {
    centreId: ctx.centre.id,
    date: incidentDate,
    fromUtc: window.fromUtc,
    toUtc: window.toUtc,
    adultSource: ctx.centre.ratioSource,
  });
  const atTheTime = snapshotAt(replay.snapshots, incident.occurredAt);

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  const timeOnly = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    hour: '2-digit',
    minute: '2-digit',
  });

  const where = [roomName(rooms, incident.roomId), incident.location].filter(Boolean).join(' · ');
  const childName = child ? `${child.firstName} ${child.lastName}` : 'Record no longer available';

  const signedPhotos = await Promise.all(
    photos.map(async (p) => ({
      id: p.id,
      caption: p.caption,
      url: await signEvidenceUrl(db, p.storagePath),
    })),
  );

  const statusSentence =
    atTheTime === null
      ? null
      : atTheTime.assessment.status === 'breach'
        ? 'below the required staffing'
        : atTheTime.assessment.status === 'at-limit'
          ? 'at the stated limit'
          : 'within the stated ratios';

  return (
    <>
      <div className="inline" style={{ marginBottom: '1rem' }}>
        <Link href="/incidents">Back to incidents</Link>
      </div>

      <PageHeader
        title={`${INCIDENT_KIND_LABELS[incident.kind]} — ${childName}`}
        subtitle={
          <>
            {when.format(new Date(incident.occurredAt))}
            {where ? ` · ${where}` : ''}
            {' · '}
            <Link href={`/incidents/${incident.id}/print`}>Print the report</Link>
          </>
        }
      />

      {incident.status === 'draft' && (
        <p className="flag flag-warn" style={{ display: 'inline-block' }}>
          Draft — whānau cannot see this report
        </p>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>What happened</h2>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{incident.description}</p>
        {incident.firstAidGiven && (
          <p className="sub" style={{ marginBottom: 0 }}>
            First aid: {incident.firstAidGiven}
          </p>
        )}
      </div>

      {/*
        What the register can say about that moment — and what it cannot. The
        limits are stated on screen because a figure with silent limits reads as
        more than it is, which is the failure AGENTS.md §4.5 exists to prevent.
      */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0 }}>Staffing at the time, from the attendance register</h2>
        {atTheTime === null ? (
          <p style={{ margin: 0 }}>
            The register holds no attendance events before{' '}
            {timeOnly.format(new Date(incident.occurredAt))} on that day, so no figure can be
            computed. That is a statement about what was recorded, not about who was present.
          </p>
        ) : (
          <>
            <p style={{ margin: 0 }}>
              As at {timeOnly.format(new Date(incident.occurredAt))},{' '}
              <strong>{atTheTime.assessment.present}</strong>{' '}
              {atTheTime.assessment.present === 1 ? 'child was' : 'children were'} signed in and{' '}
              <strong>{atTheTime.assessment.adultsPresent}</strong>{' '}
              {atTheTime.assessment.adultsPresent === 1 ? 'adult was' : 'adults were'} recorded
              present, against a requirement of{' '}
              <strong>{atTheTime.assessment.adultsRequired}</strong> — {statusSentence}.
            </p>
            <p className="sub" style={{ marginBottom: 0 }}>
              Centre-wide: attendance does not record rooms, so a room-level figure cannot be
              computed and is not shown.{' '}
              {replay.adultSource === 'declared'
                ? 'The adult figure is the count staff last typed before that moment, not a per-person record.'
                : 'The adult figure is derived from staff sign-ins.'}{' '}
              {ratioInputCaveat()}
            </p>
          </>
        )}
      </div>

      <EvidencePhotos
        photos={signedPhotos}
        parent={{ kind: 'incident', id: incident.id }}
        locked={incident.status !== 'draft'}
        lockedReason="This report is final, so its photos are frozen with it. An amendment carries its own photos."
      />

      <InvestigationForm
        incidentId={incident.id}
        investigation={investigation}
        hazards={hazards
          .filter((h) => h.resolvedAt === null)
          .map((h) => ({ id: h.id, label: h.description }))}
      />
    </>
  );
}
