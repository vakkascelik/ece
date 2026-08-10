import { notFound } from 'next/navigation';
import {
  getChild,
  listChildBookings,
  listConsents,
  listGuardiansOfChild,
  listImmunisation,
} from '@ece/api';
import { missingConsents, shiftLocalDate, todayInZone } from '@ece/core';
import { requireCtx } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { HelpNote } from '../../HelpNote';
import { BookingsPanel } from './BookingsPanel';

/**
 * The overview — the answers somebody wants before they decide which tab to open.
 *
 * Three questions and no editing. Who may collect this child, what is booked, and what the
 * office has not finished. Everything here is a read of something owned by another tab, so
 * nothing on this page can drift from the record: change a consent under Documents and the
 * "Outstanding" card changes with it.
 *
 * The urgent things are not here. Allergies and medication are in the header above, on every
 * tab, because a summary page is not where somebody looks when a child has eaten something.
 */
export default async function ChildOverviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requireCtx();
  const db = await serverDb();

  // The layout has already resolved this and 404'd if it is not readable; this re-reads it
  // because a page cannot receive data from its layout, and the alternative — a context
  // provider around a server component — costs more than one indexed lookup.
  const child = await getChild(db, id);
  if (!child) notFound();

  const today = todayInZone(ctx.centre.timezone);

  const [whanau, bookings, consents, immunisation] = await Promise.all([
    listGuardiansOfChild(db, id),
    // Four weeks forward, from the centre's today. A guardian reports an absence from here;
    // 0051 is what decides they may, and it refuses a past date regardless of what this
    // window happens to include.
    listChildBookings(db, id, today, shiftLocalDate(today, 28)),
    listConsents(db, id),
    listImmunisation(db, id),
  ]);

  const collectors = whanau.filter((g) => g.canCollect);
  const gaps = missingConsents(consents);

  return (
    <>
      <div className="record-summary">
        <div className="card">
          <div className="record-summary-eyebrow">Who may collect</div>
          <div className="record-summary-body">
            {collectors.length === 0 ? (
              /*
                Not a dash. Nobody recorded as able to collect is a real gap that somebody at
                the door has to resolve by ringing the office, and a blank cell reads as "we
                did not bother to show it".
              */
              <span className="empty">Nobody is recorded as able to collect this child.</span>
            ) : (
              collectors.map((g) => (
                <div key={g.guardian.id}>
                  {g.guardian.fullName}
                  {g.relationship ? ` · ${g.relationship}` : ''}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="record-summary-eyebrow">Booked next</div>
          <div className="record-summary-body">
            {bookings.length === 0 ? (
              <span className="empty">No booked days in the next four weeks.</span>
            ) : (
              bookings.slice(0, 3).map((b) => <div key={b.id}>{b.onDate}</div>)
            )}
          </div>
        </div>

        <div className="card">
          <div className="record-summary-eyebrow">Outstanding</div>
          <div className="record-summary-body">
            {/*
              What is unfinished, never what is done. The same rule the incident register
              follows: a record with everything filed reads the same as one with nothing to
              file, and a list that only grows is a list nobody opens.
            */}
            {gaps.length === 0 && immunisation.length > 0 ? (
              <span className="empty">Nothing outstanding on this record.</span>
            ) : (
              <>
                {gaps.length > 0 && ctx.role !== 'parent' && (
                  <div>
                    {gaps.length} consent{gaps.length === 1 ? '' : 's'} unanswered
                  </div>
                )}
                {immunisation.length === 0 && <div>No immunisation record</div>}
                {gaps.length > 0 && ctx.role === 'parent' && (
                  <div>The centre is waiting on a consent decision.</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/*
        Bookings on the overview rather than under Attendance, because it is the only thing on
        this record a family can ACT on — everything else is something they read. A parent
        opening this at 7am with a sick child should reach it without choosing a tab first.
      */}
      <div className="section">
        <div className="has-help">
          <h2>Booked days</h2>
          <HelpNote label="Booked days">
            <p>
              The days this child is expected. Bookings are what the roster is planned against
              and are separate from attendance, which is what actually happened.
            </p>
            <p>
              A parent sees this panel too and can tell the centre their child will not be in.
              That records an absence — it does not cancel the booking and it does not change
              what the family is charged.
            </p>
          </HelpNote>
        </div>
        <div className="card">
          <BookingsPanel bookings={bookings} isParent={ctx.role === 'parent'} />
        </div>
      </div>
    </>
  );
}
