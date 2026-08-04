-- 0019 — fees, invoices and credits
--
-- WHAT THIS DOES NOT DO: TAKE PAYMENT
--
-- The plan said "invoicing with Stripe". This builds the invoice and deliberately stops short of
-- collecting on it, for three reasons worth stating rather than discovering later:
--
--   1. **Nobody pays yet.** The Little Pearls pilot is free. Building payment collection before
--      there is a payment is speculative work against an unknown flow — and the flow is the part
--      that turns out to be wrong.
--   2. **Most centres already collect.** Fees usually go through the accounting system the centre
--      has, or direct debit through their bank. An invoice this product can produce and they can
--      reconcile is worth more than a second payment rail nobody asked to run.
--   3. **Stripe is a large surface** — keys, webhooks, disputes, refunds, PCI questions, a live
--      account in the centre's name. Each is a real decision, and none of them are decidable while
--      the price is NZ$0.
--
-- So `payments` records money that arrived, entered by whoever reconciled it. Wiring Stripe later
-- means adding a source to that table and a webhook, not restructuring anything here.
--
-- WHAT AN INVOICE IS COMPUTED FROM
--
-- Bookings and fees, **not** attendance. A family is charged for the days they held, because a
-- centre cannot resell a Tuesday somebody did not turn up for. Funding is the opposite — claimed
-- from `attendance_events`, because the Crown pays for hours actually delivered.
--
-- Those two facts pulling in opposite directions is the whole reason bookings and attendance are
-- separate tables.

-- ---------------------------------------------------------------------------
-- Fees
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.fee_unit as enum ('per_day', 'per_hour', 'per_week', 'one_off');
exception when duplicate_object then null; end $$;

/**
 * What a centre charges.
 *
 * Entered by the centre, never seeded. There are no default amounts anywhere in this migration —
 * a fee this product invented would be a number a centre might invoice against.
 */
create table if not exists public.fee_schedules (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,

  name        text not null,
  unit        public.fee_unit not null,
  /** Cents, so nothing here is a float. Rounding money in binary fractions is how ledgers drift. */
  amount_cents integer not null,

  /**
   * Whether GST is included in `amount_cents`.
   *
   * Not a default, and not derived. Most early learning fees are GST-exempt as an educational
   * service, but a centre's holiday programme or excursion charge may not be — and guessing turns
   * an invoice into a tax question the centre did not ask.
   */
  gst_inclusive boolean not null,

  /** Which age band it applies to, if the centre prices them differently. Null means any. */
  applies_under_two boolean,

  active_from date not null default current_date,
  active_to   date,
  created_at  timestamptz not null default now(),

  constraint fee_schedules_name_present check (length(trim(name)) > 0),
  constraint fee_schedules_amount_sane check (amount_cents between 0 and 100000000),
  constraint fee_schedules_dates_ordered check (active_to is null or active_to >= active_from)
);

create index if not exists fee_schedules_centre_idx on public.fee_schedules (centre_id, active_from desc);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.invoice_status as enum ('draft', 'issued', 'paid', 'void');
exception when duplicate_object then null; end $$;

create table if not exists public.invoices (
  id          uuid primary key default gen_random_uuid(),
  centre_id   uuid not null references public.centres(id) on delete cascade,
  /** Who owes it. A guardian, not a child — children do not have accounts. */
  guardian_id uuid not null references public.guardians(id) on delete restrict,

  /**
   * Human reference, unique within the centre.
   *
   * Assigned by the application rather than a sequence, because a global sequence would leak how
   * many invoices every other centre on this deployment has issued.
   */
  reference   text not null,
  status      public.invoice_status not null default 'draft',

  period_from date not null,
  period_to   date not null,

  issued_at   timestamptz,
  due_on      date,
  /** Kept when voided, so a reference is never silently reused for different money. */
  voided_at   timestamptz,
  void_reason text,

  note        text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint invoices_reference_unique unique (centre_id, reference),
  constraint invoices_period_ordered check (period_to >= period_from),
  constraint invoices_issued_when_not_draft check (status = 'draft' or issued_at is not null),
  constraint invoices_void_has_reason check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and length(trim(coalesce(void_reason, ''))) >= 3)
  )
);

create index if not exists invoices_centre_idx   on public.invoices (centre_id, created_at desc);
create index if not exists invoices_guardian_idx on public.invoices (guardian_id, created_at desc);

/**
 * A line on an invoice.
 *
 * `child_id` is nullable and `on delete set null`: a line must survive a child's record being
 * purged, because the invoice is a financial document with its own retention. Losing a line would
 * change what a family was charged, retroactively.
 */
create table if not exists public.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  child_id     uuid references public.children(id) on delete set null,

  description  text not null,
  quantity     numeric(8, 2) not null default 1,
  unit_cents   integer not null,
  /**
   * Signed. A credit is a negative line, not a separate table.
   *
   * One table means the total is a sum and cannot disagree with itself — two tables means an
   * invoice total and a credit total that a reader has to reconcile, which they will do wrongly.
   */
  constraint invoice_lines_description_present check (length(trim(description)) > 0),
  constraint invoice_lines_quantity_sane check (quantity between -10000 and 10000)
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id);

/**
 * The invoice total, derived.
 *
 * Not a stored column. A cached total drifts from its lines the first time somebody adds a credit
 * inside a transaction that fails halfway, and a money figure that disagrees with its own detail is
 * worse than a slow query.
 */
create or replace view public.invoice_totals
with (security_invoker = on) as
  select
    i.id as invoice_id,
    i.centre_id,
    coalesce(sum(round(l.quantity * l.unit_cents))::bigint, 0) as total_cents,
    count(l.id) as line_count
  from public.invoices i
  left join public.invoice_lines l on l.invoice_id = i.id
  group by i.id, i.centre_id;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete restrict,

  amount_cents integer not null,
  paid_on      date not null default current_date,
  /** How it arrived. Free text now; the slot a Stripe reference goes into later. */
  method       text,
  reference    text,

  recorded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),

  constraint payments_amount_positive check (amount_cents > 0)
);

create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.fee_schedules enable row level security;
alter table public.invoices      enable row level security;
alter table public.invoice_lines enable row level security;
alter table public.payments      enable row level security;

-- Fees are the centre's own pricing. Whānau see amounts on their invoice, not the schedule.
drop policy if exists fee_schedules_all on public.fee_schedules;
create policy fee_schedules_all on public.fee_schedules
  for all
  using      (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]));

/**
 * A guardian sees their own invoices, once issued.
 *
 * Drafts are excluded: an invoice a manager is midway through building is not a bill, and a family
 * seeing a half-finished figure will either pay the wrong amount or ring about it.
 */
drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select using (
    public.caller_has_role(centre_id, array['owner','manager']::public.member_role[])
    or (status <> 'draft' and guardian_id in (select public.caller_guardian_ids()))
  );

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for all
  using      (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]));

/**
 * Lines follow their invoice.
 *
 * A guardian who can read the invoice can read what it is made of — a bill with a total and no
 * breakdown is one nobody can check, and checking it is the point.
 */
drop policy if exists invoice_lines_select on public.invoice_lines;
create policy invoice_lines_select on public.invoice_lines
  for select using (
    exists (select 1 from public.invoices i where i.id = invoice_id)
  );

drop policy if exists invoice_lines_write on public.invoice_lines;
create policy invoice_lines_write on public.invoice_lines
  for all
  using (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_id
         and public.caller_has_role(i.centre_id, array['owner','manager']::public.member_role[])
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_id
         and public.caller_has_role(i.centre_id, array['owner','manager']::public.member_role[])
         -- Lines cannot be added to an issued invoice. Changing what a family was billed after they
         -- were billed it is not an edit, it is a different invoice.
         and i.status = 'draft'
    )
  );

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select using (
    exists (select 1 from public.invoices i where i.id = invoice_id)
  );

drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert with check (
    exists (
      select 1 from public.invoices i
       where i.id = invoice_id
         and public.caller_has_role(i.centre_id, array['owner','manager']::public.member_role[])
    )
    and (recorded_by is null or recorded_by = auth.uid())
  );

-- No UPDATE and no DELETE on payments. A recorded receipt is a statement that money arrived;
-- correcting one means recording the reversal, exactly as with attendance and consent.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.fee_schedules from anon, authenticated, service_role;
revoke all on public.invoices      from anon, authenticated, service_role;
revoke all on public.invoice_lines from anon, authenticated, service_role;
revoke all on public.payments      from anon, authenticated, service_role;

grant select, insert, update, delete on public.fee_schedules to authenticated, service_role;
grant select, insert, update on public.invoices to authenticated, service_role;
grant select, insert, update, delete on public.invoice_lines to authenticated, service_role;
grant select, insert on public.payments to authenticated, service_role;
grant select on public.invoice_totals to authenticated, service_role;
