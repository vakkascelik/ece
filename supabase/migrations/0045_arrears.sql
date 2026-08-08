-- ---------------------------------------------------------------------------
-- 0045 — what is still owed
--
-- A view, not a table, and the precedent is `invoice_totals` (0019): a stored money
-- figure drifts from its own detail the first time a credit is added inside a
-- transaction that fails halfway, and a total that disagrees with its lines is worse
-- than a slow query. The same argument applies twice over here, because this figure
-- moves every time a payment arrives.
--
-- WHY IT TRUSTS THE PAYMENTS AND NOT THE STATUS
--
-- `invoices.status` may say `paid`. That is a label somebody set; the payments are the
-- fact. So `paid` invoices are **included** rather than filtered out, and if the
-- payments do not cover the total the balance shows up regardless of what the status
-- claims. An invoice marked paid that is not paid is exactly the row a centre needs to
-- see, and a view that filtered on the label could never show it.
--
-- `draft` and `void` are excluded: nothing has been issued, or it has been withdrawn.
--
-- WHAT IS DELIBERATELY NOT HERE
--
-- No ageing, no buckets, no "days overdue". Those need today's date in the centre's
-- timezone, and every date bug in this repo has come from computing a calendar day in
-- the wrong zone. The view returns two integers and a date; `summariseArrears` in
-- `@ece/core` does the arithmetic against a date the caller resolves with
-- `todayInZone(centre.timezone)`, where it is tested.
-- ---------------------------------------------------------------------------

create or replace view public.invoice_arrears
with (security_invoker = on) as
  select
    i.id           as invoice_id,
    i.centre_id,
    i.guardian_id,
    i.reference,
    i.status,
    i.due_on,
    t.total_cents,
    -- `coalesce` because an issued invoice with no payment at all is the ordinary case
    -- and must appear owing the full amount rather than vanish on the join.
    coalesce(p.paid_cents, 0)::bigint as paid_cents
  from public.invoices i
  join public.invoice_totals t on t.invoice_id = i.id
  left join (
    select pay.invoice_id, sum(pay.amount_cents)::bigint as paid_cents
      from public.payments pay
     group by pay.invoice_id
  ) p on p.invoice_id = i.id
  where i.status in ('issued', 'paid');

comment on view public.invoice_arrears is
  'Issued invoices with what they total and what has been paid. Trusts the payments rather than invoices.status, so an invoice mislabelled paid still shows its balance. Ageing happens in @ece/core, not here.';

/*
 * `security_invoker = on`, the house rule for every view in this schema.
 *
 * It matters more than usual here: it means a guardian reading this sees exactly the
 * invoices `invoices_select` already allows them — their own, and only once issued —
 * and staff see their centre's. Without it the view would run as its owner and hand
 * every centre's debts to anybody who could select from it.
 */

-- Revoked from `anon` as well as granted, which is the pair every table in this schema
-- uses and the one thing 0019 skipped when it granted `invoice_totals`. Not exploitable
-- there — `security_invoker` plus the underlying revokes cover it — but a view that
-- relies on two other objects for its own safety is a view somebody will eventually
-- read without them.
revoke all on public.invoice_arrears from anon, authenticated, service_role;
grant select on public.invoice_arrears to authenticated, service_role;

-- The index the view needs and 0019 did not create. Every read of this is "the invoices
-- for one centre", and without it that is a sequential scan over every invoice in the
-- database — which is fine today and is the shape that stops being fine at the point a
-- centre most wants this screen.
create index if not exists invoices_centre_due_idx
  on public.invoices (centre_id, due_on)
  where status in ('issued', 'paid');
