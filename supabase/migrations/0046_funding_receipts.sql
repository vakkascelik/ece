-- ---------------------------------------------------------------------------
-- A NOTE THAT BELONGS TO 0045 AND IS WRITTEN HERE INSTEAD
--
-- 0045's comment says `security_invoker = on` keeps `invoice_arrears` inside the
-- invoice boundary. True, and the isolation suite could not see it: turning the setting
-- off and running the whole suite changed nothing, because that view joins
-- `invoice_totals`, which is itself an invoker view and went on enforcing the boundary
-- by itself. The per-view assertions were passing for a reason other than the one their
-- labels claimed.
--
-- The suite now carries a class-level check reading `pg_class.reloptions`: every view in
-- `public` must declare `security_invoker = on`. It names the offender when it fails and
-- covers every view added after it.
--
-- This paragraph is here rather than in 0045 because 0045 has been applied, and the
-- runner records a checksum per file: editing an applied migration — even only its
-- comments — makes the repo and the database disagree about the schema, and the runner
-- correctly refuses to guess which is right. An applied migration is a record of what
-- ran. New understanding goes in the next one, or in the wiki.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 0046 — what the Ministry actually paid
--
-- `npm run reconcile:funding` already exists and reconciles the **calculation** against
-- arithmetic worked out by hand in its own comments. It has never compared a claim to
-- money. This is the other half, and the reason it is worth building is one sentence: a
-- centre that finds an under-claim renews without a conversation.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY BOTH FIGURES ARE ENTERED, AND NEITHER IS COMPUTED
--
-- The obvious design computes the claim from `readFundingPeriod` — funded hours times a
-- rate — and compares that to what arrived. **This product has no rates.** None are in
-- the repo, deliberately, and `unverified-claims` says so: publishing a rate nobody has
-- checked would make every variance on this screen a fiction with a dollar sign on it.
--
-- So the centre enters what it claimed, from the figure it keyed into ELI Web, and what
-- it received, from its bank. The product does the subtraction and nothing else. That is
-- a smaller feature than it first appears and it is the only version that is true.
--
-- The funded HOURS this product does compute stay where they are, on `/funding`, next to
-- their own disclaimer. Nothing here multiplies them by anything.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ONE ROW PER PERIOD, AND WHAT THAT COSTS
--
-- ECE funding is paid in instalments with a wash-up, so a period can be paid more than
-- once. This table holds one row per period and `received_cents` is the running total,
-- updated when a wash-up lands; `received_on` is the date of the most recent payment.
--
-- The cost is real and is stated rather than hidden: **the individual payments are not
-- itemised here.** What survives is the audit trail — the row carries the audit trigger,
-- so every change to a figure is recorded with who made it and when. If itemising turns
-- out to matter, that is a child table, not a rewrite.
-- ---------------------------------------------------------------------------

create table if not exists public.funding_receipts (
  id             uuid primary key default gen_random_uuid(),
  centre_id      uuid not null references public.centres(id) on delete cascade,

  -- The Ministry's own name for the period, typed as it appears on the statement, so a
  -- manager can match this against the paperwork without translating anything. Not an
  -- enum: funding period naming is not something this repo has verified.
  period_label   text not null,
  period_from    date not null,
  period_to      date not null,

  /*
    Nullable, and that is the useful state rather than an unfinished one. A centre
    often knows what arrived before it can find what it claimed, and a report that
    demanded both would simply not get filled in. A null claim means "not stated" and
    the variance says so instead of showing a number.
  */
  claimed_cents  bigint,
  received_cents bigint not null default 0,
  received_on    date,

  reference      text,
  note           text,

  recorded_by    uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint funding_receipts_period_ordered check (period_to >= period_from),
  constraint funding_receipts_label_present check (length(trim(period_label)) > 0),
  -- Money is non-negative here. A repayment to the Ministry is a real thing and is not
  -- this table: recording it as a negative receipt would make the running total mean
  -- two things at once.
  constraint funding_receipts_claimed_sane check (claimed_cents is null or claimed_cents >= 0),
  constraint funding_receipts_received_sane check (received_cents >= 0),
  -- A date without money is a row nobody can read; money without a date is a payment
  -- nobody can reconcile against a statement.
  constraint funding_receipts_received_dated check (
    (received_cents = 0 and received_on is null) or (received_cents > 0 and received_on is not null)
  ),
  -- One row per period per centre. The wash-up updates it; see the header.
  constraint funding_receipts_one_per_period unique (centre_id, period_label)
);

comment on table public.funding_receipts is
  'What a centre claimed and what the Ministry paid, both entered by the centre. Nothing here is computed from a rate — this product holds none. One row per period; a wash-up updates the running total and the audit log keeps the history.';
comment on column public.funding_receipts.claimed_cents is
  'Null means not stated, which is a normal state. The variance reports "not stated" rather than assuming zero.';

create index if not exists funding_receipts_centre_idx
  on public.funding_receipts (centre_id, period_from desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Owner and manager only, read and write. This is the centre's money against the
-- Crown's: an educator has no reason to see it and a parent still less. Unlike
-- `invoices` there is no guardian branch at all, which is why one policy covers SELECT
-- and the writes — the same shape as `fee_schedules`.
-- ---------------------------------------------------------------------------

alter table public.funding_receipts enable row level security;

drop policy if exists funding_receipts_all on public.funding_receipts;
create policy funding_receipts_all on public.funding_receipts
  for all using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
      with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

revoke all on public.funding_receipts from anon, authenticated, service_role;
grant select, insert, update, delete on public.funding_receipts to authenticated, service_role;

/*
 * DELETE is granted, unlike most tables here, and the reason is that this is a
 * reconciliation note rather than a record of an event. Nothing downstream depends on
 * it, no claim rests on it, and a centre that typed the wrong period should be able to
 * remove the row rather than leave a wrong figure on a screen for ever. The audit
 * trigger records the deletion.
 *
 * `0025`'s class invariant requires a `_write_delete` USING to match its
 * `_write_insert` WITH CHECK; this table has a single `FOR ALL` policy, like
 * `fee_schedules`, so both sides are the same expression by construction.
 */

drop trigger if exists funding_receipts_audit on public.funding_receipts;
create trigger funding_receipts_audit
  after insert or update or delete on public.funding_receipts
  for each row execute function public.audit_trigger();
