import { listGuardians, listOutstandingInvoices, listPaymentsFor } from '@ece/api';
import { BUCKETS, formatCents, summariseArrears, todayInZone } from '@ece/core';
import { requireCapability } from '@/lib/auth';
import { serverDb } from '@/lib/supabase';
import { PageHeader } from '../PageHeader';
import { PageActions } from '../PageActions';
import { InvoiceRow } from './InvoiceRow';
import './billing.css';
import { appPath } from '@/lib/origin';

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

  // Aged into a bucket that means "late", which `daysOverdue` already decides — rather than
  // a second definition of overdue written on this page.
  const overdueCount = arrears.invoices.filter((i) => i.daysOverdue !== null).length;

  /*
    The movements behind each balance, in one query rather than one per row.

    Fetched after `summariseArrears` so only the invoices actually shown are asked about —
    an invoice that is settled is not on this screen and its payments are nobody's question
    here.
  */
  const payments = await listPaymentsFor(db, arrears.invoices.map((i) => i.invoiceId));
  const paymentsByInvoice = new Map<string, typeof payments>();
  for (const p of payments) {
    const list = paymentsByInvoice.get(p.invoiceId) ?? [];
    list.push(p);
    paymentsByInvoice.set(p.invoiceId, list);
  }

  return (
    <div className="binder">
      <PageHeader
        title="Accounts"
        helpHref="/billing"
        /*
          The count, then what is actually late. No single "total outstanding" figure, and
          that is not an omission: `summariseArrears` deliberately does not compute one,
          because credits are never netted against arrears and any single number would either
          do that or need a paragraph explaining why it does not. The count of invoices is
          inventory; the overdue figure is the reason somebody opened the screen.
        */
        subtitle={
          <>
            {arrears.invoices.length} invoice{arrears.invoices.length === 1 ? '' : 's'}{' '}
            outstanding as at {today}
            {/*
              How many are late, not how much — the card below already carries the money, and
              repeating the same figure in the same words twice on one screen is noise rather
              than emphasis. The count is the more useful of the two here anyway: it is how
              many families somebody has to ring.
            */}
            {` · ${overdueCount} of them overdue`}
          </>
        }
        actions={
          <PageActions
            csvHref={appPath('/billing/export.csv')}
            hint="The spreadsheet has the same figures as plain numbers, so a column can be summed. The Xero file covers last month's issued invoices and leaves the account code and tax rate blank — those are your chart of accounts, not ours."
          >
            {/*
              A second download rather than a second format of the first. They answer
              different questions: the accounts CSV is what families owe *now*, the Xero
              file is what was *issued* in a period. Merging them would produce a file that
              was wrong for both — an accounting import must not contain a balance, and an
              arrears report must not be limited to one month.
            */}
            <a className="btn secondary" href={appPath('/billing/xero.csv')}>
              Download for Xero
            </a>
          </PageActions>
        }
      />

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
              {/* The disclosure column. Named for a screen reader, which would otherwise
                  announce a blank column heading once per row. */}
              <th style={{ width: '1%' }}>
                <span className="visually-hidden">Payments</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {arrears.invoices.map((i) => (
              <InvoiceRow
                key={i.invoiceId}
                row={{
                  invoiceId: i.invoiceId,
                  family: nameOf.get(i.guardianId) ?? 'Not on the list',
                  reference: i.reference,
                  dueOn: i.dueOn,
                  outstandingCents: i.outstandingCents,
                  paidCents: i.paidCents,
                  totalCents: i.totalCents,
                  daysOverdue: i.daysOverdue,
                  bucketLabel: LABELS[i.bucket] ?? i.bucket,
                  payments: (paymentsByInvoice.get(i.invoiceId) ?? []).map((p) => ({
                    id: p.id,
                    amountCents: p.amountCents,
                    paidOn: p.paidOn,
                    method: p.method,
                  })),
                }}
              />
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
