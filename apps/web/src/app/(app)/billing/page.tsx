import { listGuardians, listOutstandingInvoices } from '@ece/api';
import { BUCKETS, formatCents, summariseArrears, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';

/**
 * Who owes what, and for how long.
 *
 * The first screen in this product to render money. `packages/api` has had invoices
 * since Phase 5 and nothing imported them, which is why this page exists before any
 * screen that *creates* an invoice: a centre reconciling payments in its accounting
 * system still needs to know who is behind, and that is answerable from what the schema
 * already holds.
 *
 * **Read-only, deliberately.** Nothing here issues, edits or voids. Those are guarded by
 * a transition trigger and a policy that freezes an issued invoice, and putting a button
 * on this page would mean reproducing that reasoning in a form. A screen that only
 * reports cannot break the ledger.
 *
 * WHY THE DATE IS RESOLVED HERE
 *
 * `summariseArrears` requires it. Ageing is arithmetic on a calendar, and computing
 * "today" any deeper down would read the server's clock, which is UTC and therefore
 * yesterday for the whole New Zealand morning. `todayInZone(centre.timezone)` is the
 * only place the current day is decided.
 */
export default async function BillingPage() {
  const ctx = await requireCapability('manageCentre');
  const db = await serverDb();
  const today = todayInZone(ctx.centre.timezone);

  const [outstanding, guardians] = await Promise.all([
    listOutstandingInvoices(db, ctx.centre.id),
    listGuardians(db, ctx.centre.id),
  ]);

  const nameOf = new Map(guardians.map((g) => [g.id, g.fullName]));
  const arrears = summariseArrears(outstanding, today);

  return (
    <div className="binder">
      <div className="no-print">
        <h1>Accounts</h1>
        <p className="sub">
          What families still owe on invoices this centre has issued, as at {today}.
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <p className="inline" style={{ margin: 0 }}>
          <span className={`flag ${arrears.overdueCents > 0 ? 'flag-warn' : 'flag-ok'}`}>
            {arrears.overdueCents > 0 ? '●' : '✓'} {formatCents(arrears.overdueCents)} overdue
          </span>
          {arrears.notDueCents > 0 && (
            <span className="flag flag-quiet">
              {formatCents(arrears.notDueCents)} owing but not yet due
            </span>
          )}
          {arrears.creditCents > 0 && (
            // Never netted against what is owed. One family in credit does not reduce
            // another family's debt, and a single "net" figure would say exactly that.
            <span className="flag flag-quiet">{formatCents(arrears.creditCents)} in credit</span>
          )}
        </p>

        {arrears.noDueDateCents > 0 && (
          /*
            The line that makes the rest honest. An invoice with no due date cannot be
            aged at all, so a centre that never sets them would read a clean report and
            conclude nobody is late.
          */
          <p className="sub" style={{ margin: '0.5rem 0 0' }}>
            <span className="flag flag-warn">
              {'●'} {formatCents(arrears.noDueDateCents)} on invoices with no due date
            </span>{' '}
            These cannot be aged, so they are in none of the columns below. Set a due date on an
            invoice for it to appear.
          </p>
        )}

        <p className="sub" style={{ margin: '0.5rem 0 0' }}>
          Balances come from the payments recorded against each invoice, not from its status &mdash;
          so an invoice marked paid that has not been paid still appears here.
        </p>
      </div>

      <h2>By age</h2>
      <table>
        <caption className="visually-hidden">Outstanding balances by age</caption>
        <thead>
          <tr>
            {BUCKETS.map((b) => (
              <th key={b} scope="col">
                {LABELS[b]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* Every bucket, including the empty ones — a table that drops a zero column
                reflows its own headings between two visits. */}
            {BUCKETS.map((b) => (
              <td key={b}>{formatCents(arrears.byBucket[b])}</td>
            ))}
          </tr>
        </tbody>
      </table>

      <h2>Invoices</h2>
      {arrears.invoices.length === 0 ? (
        <p className="empty">Nothing outstanding. Every issued invoice is settled.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Family</th>
              <th>Invoice</th>
              <th>Due</th>
              <th>Owing</th>
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {arrears.invoices.map((i) => (
              <tr key={i.invoiceId}>
                <td>{nameOf.get(i.guardianId) ?? <span className="empty">Not on the list</span>}</td>
                <td>{i.reference}</td>
                <td>{i.dueOn ?? <span className="empty">none set</span>}</td>
                <td>
                  <strong>{formatCents(i.outstandingCents)}</strong>
                  {i.paidCents > 0 && (
                    <div className="sub" style={{ fontSize: '0.8125rem' }}>
                      {formatCents(i.paidCents)} of {formatCents(i.totalCents)} paid
                    </div>
                  )}
                </td>
                <td>
                  {i.daysOverdue === null ? (
                    <span className="flag flag-quiet">{LABELS[i.bucket]}</span>
                  ) : (
                    <span className="flag flag-warn">
                      {'●'} {i.daysOverdue} {i.daysOverdue === 1 ? 'day' : 'days'}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="sub" style={{ marginTop: '1rem' }}>
        {ctx.centre.name} &middot; {today}
      </footer>
    </div>
  );
}

/** Column headings. `no-due-date` is a sentence because it is a problem, not a bucket. */
const LABELS: Record<string, string> = {
  'no-due-date': 'No due date',
  'not-due': 'Not yet due',
  '1-30': '1–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': 'Over 90 days',
};
