import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  listExcursionChildren,
  listExcursionConsents,
  listExcursions,
  listChildren,
  listGuardiansOfChild,
  listHeadcounts,
} from '@ece/api';
import { consentGaps, currentConsent, lastHeadcount } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { Roster, type RosterRow } from './Roster';
import { Runsheet } from './Runsheet';

/**
 * One outing: the plan, the roster with its consent states, and the counts.
 *
 * The page a phone is open to at the gate. The consent chase happens here before
 * departure; the headcounts happen here during; and the two must not be far apart,
 * because they are the same person's job on the same morning.
 */
export default async function ExcursionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  // Resolved from the centre's list rather than by a point lookup, exactly as
  // /incidents does: an id from another centre simply does not match, and the URL
  // cannot be used to confirm an outing exists somewhere the caller cannot see.
  const excursions = await listExcursions(db, ctx.centre.id);
  const excursion = excursions.find((e) => e.id === id);
  if (!excursion) notFound();

  const [childIds, consents, headcounts, children] = await Promise.all([
    listExcursionChildren(db, id),
    listExcursionConsents(db, id),
    listHeadcounts(db, id),
    listChildren(db, ctx.centre.id),
  ]);

  /*
    Guardians per child on the outing, not the centre-wide list. Consent must only be
    attributable to that child's own guardians — a select offering every guardian at
    the centre invites recording a decision against the wrong family, and the staff
    transcription path in 0037 does not re-check the link. Bounded by outing size,
    which a licence caps at dozens.
  */
  const guardiansByChild = new Map(
    await Promise.all(
      childIds.map(
        async (childId) =>
          [childId, await listGuardiansOfChild(db, childId)] as const,
      ),
    ),
  );

  const nameOf = new Map(children.map((c) => [c.id, `${c.firstName} ${c.lastName}`]));
  const gaps = consentGaps(childIds, consents, id);

  const rosterRows: RosterRow[] = childIds.map((childId) => ({
    childId,
    childName: nameOf.get(childId) ?? 'A child no longer enrolled',
    consent: currentConsent(consents, id, childId),
    guardians: (guardiansByChild.get(childId) ?? []).map((g) => ({
      id: g.guardian.id,
      name: g.guardian.fullName,
    })),
  }));

  // Children not yet on the outing, for the add selector.
  const onOuting = new Set(childIds);
  const addable = children
    .filter((c) => !onOuting.has(c.id) && !c.archivedAt)
    .map((c) => ({ id: c.id, name: `${c.firstName} ${c.lastName}` }));

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

  const last = lastHeadcount(headcounts, id);
  const countRows = headcounts.map((h) => ({
    id: h.id,
    label: when.format(new Date(h.at)),
    counted: h.counted,
    expected: h.expected,
    note: h.note,
  }));

  return (
    <>
      <p style={{ fontSize: 'var(--text-sm)', margin: '0 0 12px' }}>
        <Link href="/excursions">Back to outings</Link>
      </p>

      <h1>{excursion.destination}</h1>
      <p className="sub">
        Leaves {when.format(new Date(excursion.departsAt))}
        {excursion.returnsAt && <> · back by {when.format(new Date(excursion.returnsAt))}</>}
        {excursion.transport && <> · {excursion.transport}</>}
        {excursion.adultsAttending !== null && <> · {excursion.adultsAttending} adults</>}
      </p>

      {excursion.plan && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>The plan</h2>
          <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{excursion.plan}</p>
        </div>
      )}

      <Runsheet
        excursionId={id}
        status={excursion.status}
        unanswered={gaps.unanswered.length}
        refused={gaps.refused.length}
        childrenOnOuting={childIds.length}
        lastCount={
          last
            ? {
                label: when.format(new Date(last.count.at)),
                counted: last.count.counted,
                expected: last.count.expected,
                short: last.short,
              }
            : null
        }
        countRows={countRows}
      />

      <h2>Who is going</h2>
      <Roster
        excursionId={id}
        status={excursion.status}
        rows={rosterRows}
        addable={addable}
      />
    </>
  );
}
