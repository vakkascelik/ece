'use client';

import { useState } from 'react';
import { formatCents } from '@ece/core';
import { Status } from '../Status';

export interface InvoiceRowView {
  invoiceId: string;
  family: string;
  reference: string;
  dueOn: string | null;
  outstandingCents: number;
  paidCents: number;
  totalCents: number;
  daysOverdue: number | null;
  bucketLabel: string;
  payments: { id: string; amountCents: number; paidOn: string; method: string | null }[];
}

/**
 * One invoice, and the movements behind its balance.
 *
 * A balance on its own is not enough to have a conversation with a family about. "Owes $240"
 * and "owes $240, paid $180 last Tuesday" lead to different phone calls, and until now the
 * second was unavailable anywhere in the product — `recordPayment` had written those rows
 * since Phase 5 and nothing read them back.
 *
 * EXPANDS IN PLACE RATHER THAN NAVIGATING
 *
 * Because the question is comparative: somebody scanning arrears is deciding *which* families
 * to ring, and a detail page loses the row's neighbours the moment it answers the question
 * about one of them. The whole list stays on screen.
 *
 * A `<button>` in the row with `aria-expanded`, not a link and not a clickable `<tr>`. The
 * disclosure is a control, so it is announced as one and reachable by keyboard; a row that
 * expands when you click anywhere on it is a row that expands when you meant to select the
 * reference number to paste into a bank statement.
 */
export function InvoiceRow({ row }: { row: InvoiceRowView }) {
  const [open, setOpen] = useState(false);
  const panelId = `payments-${row.invoiceId}`;

  return (
    <>
      <tr>
        <td>{row.family}</td>
        <td>{row.reference}</td>
        <td>{row.dueOn ?? <span className="empty">none set</span>}</td>
        <td>
          <strong>{formatCents(row.outstandingCents)}</strong>
          {row.paidCents > 0 && (
            <div className="sub" style={{ fontSize: '0.8125rem' }}>
              {formatCents(row.paidCents)} of {formatCents(row.totalCents)} paid
            </div>
          )}
        </td>
        <td>
          {row.daysOverdue === null ? (
            <Status tone="neutral">{row.bucketLabel}</Status>
          ) : (
            <Status tone="warn">
              {row.daysOverdue} {row.daysOverdue === 1 ? 'day' : 'days'}
            </Status>
          )}
        </td>
        <td>
          <button
            type="button"
            className="secondary small"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
          >
            {/*
              The count is in the label, so a row with nothing behind it says so before it is
              opened. "Payments (0)" is an answer; an empty panel is a wasted tap.
            */}
            {open ? 'Hide' : 'Payments'} ({row.payments.length})
          </button>
        </td>
      </tr>
      {open && (
        <tr id={panelId}>
          {/*
            One cell spanning the row. A nested table would give a screen reader a second set
            of column headers to hold in mind for three numbers.
          */}
          <td colSpan={6} className="invoice-payments">
            {row.payments.length === 0 ? (
              <p className="empty" style={{ margin: 0 }}>
                Nothing has been recorded against this invoice yet. A balance with no payments
                is the whole amount still owing, not a payment nobody entered.
              </p>
            ) : (
              <ul className="stack" style={{ gap: '0.35rem' }}>
                {row.payments.map((p) => (
                  <li key={p.id}>
                    <strong>{formatCents(p.amountCents)}</strong> · {p.paidOn}
                    {p.method ? ` · ${p.method}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
