import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getChild, listIncidents, listRooms } from '@ece/api';
import { INCIDENT_KIND_LABELS, roomName, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { dayWindow, shiftLocalDate } from '@/lib/dayWindow';
import { serverDb } from '@/lib/supabase';
import { PageActions } from '../../../PageActions';
import { PageHeader } from '../../../PageHeader';

/**
 * One incident, as a document.
 *
 * 1Place puts a PDF icon on every row of its incident list, and this is what replaces
 * it. Same mechanism as the compliance binder and for the same reasons written up
 * there and in `exports.md`: a print-optimised page produces exactly the artefact —
 * every browser prints to PDF — and costs no dependency, no headless Chrome in the
 * deploy, and no second rendering of the truth that could drift from the screen.
 *
 * WHAT IS ON IT, AND ONE THING THAT IS NOT
 *
 * Everything the record holds, including whether the family were told and whether they
 * acknowledged it, because those two facts are the reason a reviewer asks for the
 * document at all.
 *
 * It does **not** say "signed" anywhere, and there is no signature line. This product
 * has no signature on an incident — `status` goes draft → final and `acknowledged_by`
 * names a guardian who confirmed in the app. Printing a blank signature line would
 * invite a centre to treat a wet signature as the record, at which point the
 * authoritative version is a piece of paper in a drawer and everything this schema
 * does about immutability is decoration.
 *
 * A draft prints with a banner saying so. It is deliberately printable: a manager
 * reviewing a report before it goes final often wants it on paper, and refusing would
 * push that work back into a Word document.
 */
const WINDOW_DAYS = 400;

export default async function IncidentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  /*
    `listIncidents` takes a window rather than an id, and there is no `getIncident`.
    Rather than add one reaching past the list's row cap, this reads a wide window and
    picks the row — 400 days covers "the incident a reviewer is asking about" and stays
    inside the pager. A record older than that is reachable from the child's own page.
  */
  const today = todayInZone(ctx.centre.timezone);
  const { fromUtc } = dayWindow(shiftLocalDate(today, -WINDOW_DAYS), ctx.centre.timezone);
  const { toUtc } = dayWindow(today, ctx.centre.timezone);

  const [incidents, rooms] = await Promise.all([
    listIncidents(db, ctx.centre.id, fromUtc, toUtc),
    listRooms(db, ctx.centre.id),
  ]);

  const incident = incidents.find((i) => i.id === id) ?? null;
  // RLS has already decided this. A record at another centre reads as absent rather
  // than forbidden, which is right for a URL somebody could guess.
  if (!incident) notFound();

  const child = await getChild(db, incident.childId);

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const generatedAt = when.format(new Date());
  const where = [roomName(rooms, incident.roomId), incident.location].filter(Boolean).join(' · ');

  return (
    <div className="binder">
      <div className="no-print inline" style={{ marginBottom: '1.5rem' }}>
        <Link href="/incidents">Back to incidents</Link>
      </div>

      <PageHeader
        title="Incident report"
        subtitle={
          <>
            <strong>{ctx.centre.name}</strong>
            {ctx.centre.moeServiceNumber
              ? ` · Ministry service number ${ctx.centre.moeServiceNumber}`
              : ''}
          </>
        }
        actions={
          <PageActions hint="Choose &ldquo;Save as PDF&rdquo; as the destination in the print dialogue." />
        }
      />

      {incident.status === 'draft' && (
        <p className="flag flag-warn" style={{ display: 'inline-block' }}>
          Draft — not yet finalised, and no family has seen it
        </p>
      )}

      <p className="sub">Printed {generatedAt}</p>

      <dl>
        <dt>Child</dt>
        <dd>{child ? `${child.firstName} ${child.lastName}` : 'Record no longer available'}</dd>

        <dt>What kind</dt>
        <dd>{INCIDENT_KIND_LABELS[incident.kind]}</dd>

        <dt>When</dt>
        <dd>{when.format(new Date(incident.occurredAt))}</dd>

        <dt>Where</dt>
        <dd>{where || 'Not recorded'}</dd>

        <dt>What happened</dt>
        <dd style={{ whiteSpace: 'pre-wrap' }}>{incident.description}</dd>

        <dt>First aid given</dt>
        <dd>{incident.firstAidGiven || 'None recorded'}</dd>

        <dt>Witness</dt>
        <dd>{incident.witnessName || 'None recorded'}</dd>

        {/*
          Two different facts, and a review cares about both — the schema splits them
          for that reason. "We told the family" and "the family said they had been
          told" are not the same claim, and a document that merges them lets the first
          stand in for the second.
        */}
        <dt>Whānau notified</dt>
        <dd>
          {incident.parentNotifiedAt
            ? when.format(new Date(incident.parentNotifiedAt))
            : 'Not recorded'}
        </dd>

        <dt>Acknowledged by whānau</dt>
        <dd>
          {incident.acknowledgedAt
            ? when.format(new Date(incident.acknowledgedAt))
            : 'Not acknowledged'}
        </dd>

        {incident.supersedes && (
          <>
            <dt>Note</dt>
            <dd>This report replaces an earlier one, which remains on file unchanged.</dd>
          </>
        )}
      </dl>
    </div>
  );
}
