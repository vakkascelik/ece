import Link from 'next/link';
import { listExcursions } from '@ece/api';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PlanExcursion } from './PlanExcursion';

/**
 * The outings list. One row per excursion, newest departure first; the work — the
 * consent chase, the departure gate, the headcounts — lives on the detail page,
 * because it is per-outing work.
 */
export default async function ExcursionsPage() {
  const ctx = await requireCapability('recordDailyPractice');
  const db = await serverDb();

  const excursions = await listExcursions(db, ctx.centre.id);

  const when = new Intl.DateTimeFormat('en-NZ', {
    timeZone: ctx.centre.timezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

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

  // "Off site right now" above everything else: during an emergency at the centre,
  // the first question about outings is who is not in the building.
  const out = excursions.filter((e) => e.status === 'departed');

  return (
    <>
      <h1>Excursions</h1>
      <p className="sub">Outings from {ctx.centre.name}.</p>

      {out.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p className="inline" style={{ margin: 0 }}>
            <span className="flag flag-warn">
              {'●'} {out.length === 1 ? 'A group is' : `${out.length} groups are`} off site right
              now
            </span>
            {out.map((e) => (
              <Link key={e.id} href={`/excursions/${e.id}`}>
                {e.destination}
              </Link>
            ))}
          </p>
        </div>
      )}

      <PlanExcursion defaultWallClock={defaultWallClock} />

      <div className="card">
        {excursions.length === 0 ? (
          <p className="empty">No outings planned.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Where</th>
                <th>Leaves</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {excursions.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>
                      <Link href={`/excursions/${e.id}`}>{e.destination}</Link>
                    </strong>
                    {e.purpose && (
                      <div className="sub" style={{ fontSize: '0.8125rem' }}>
                        {e.purpose}
                      </div>
                    )}
                  </td>
                  <td>{when.format(new Date(e.departsAt))}</td>
                  <td>
                    {e.status === 'planned' && <span className="flag flag-quiet">Planned</span>}
                    {e.status === 'departed' && (
                      <span className="flag flag-warn">{'●'} Off site</span>
                    )}
                    {e.status === 'returned' && (
                      <span className="flag flag-ok">{'✓'} Returned</span>
                    )}
                    {e.status === 'cancelled' && (
                      <span className="flag flag-quiet">Cancelled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
