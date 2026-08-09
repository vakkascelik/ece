-- ---------------------------------------------------------------------------
-- 0055 — when a family last said their details are right
--
-- A reviewer asks "how do you know these emergency contacts are current", and until now
-- this product had no answer. It held the details and the date they were entered, which is
-- a different fact: a phone number typed in 2023 and never touched since is either correct
-- or three years stale, and nothing distinguished those.
--
-- One row per confirmation, by one guardian, for one child. The newest row answers the
-- question; the older ones answer "how often does this family actually check", which is the
-- follow-up.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY, AND THE REASON IS THE WHOLE POINT
--
-- UPDATE and DELETE are withheld from every role including `service_role`. A confirmation
-- that can be edited answers nothing — "last confirmed in March" is only worth saying if
-- nobody could have written it in April. Same treatment as `attendance_events`, `payments`
-- and `consent_events`, and the same reasoning: the row *is* the record.
--
-- No audit trigger, for the reason 0021 gives for every append-only table. Named in BOTH
-- exemption lists in the same commit — `rls_isolation.sql` and `scripts/security-review.ts`
-- — because on 2026-08-09 `ai_requests` went into one and not the other, and the second
-- list is the only reason anybody noticed.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS DELIBERATELY DOES NOT STORE, AND WHAT THAT COSTS
--
-- No snapshot of what was confirmed. The obvious richer design copies the guardian's phone
-- and address into the row, so the product can say "confirmed, and nothing has changed
-- since". That is a real question and this table cannot answer it — stated here rather
-- than discovered later.
--
-- It is refused for now because a snapshot is a second copy of a family's contact details
-- living under a different retention rule from the first, on an append-only table that
-- cannot be corrected or purged. `guardians` is already purgeable when a child leaves; a
-- frozen duplicate is not, and IPP 9 cuts against holding one.
--
-- The question is answerable without it: `guardians` carries the shared audit trigger, so
-- an update to a family's details is already recorded with a timestamp. "Has anything
-- changed since the last confirmation" is a comparison against `audit_events`, not a column
-- here. That comparison is office-only, because a guardian cannot read `audit_events` — and
-- that is the right asymmetry.
-- ---------------------------------------------------------------------------

create table if not exists public.detail_confirmations (
  id           uuid primary key default gen_random_uuid(),

  child_id     uuid not null references public.children(id)  on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,

  confirmed_at timestamptz not null default now(),

  /*
    No `centre_id`. The row reaches its tenant through the child, which is the arrangement
    `attendance_events` and `invoice_lines` already use — and it means there is no
    denormalised centre to drift from the child's, and no `.eq('centre_id', …)` for a
    reader to forget, because there is no such column.
  */
  constraint detail_confirmations_not_future check (confirmed_at <= now() + interval '1 minute')
);

comment on table public.detail_confirmations is
  'One row each time a guardian confirms their child''s details are current. Append-only: a confirmation that could be edited would answer nothing. Holds no snapshot of what was confirmed — see the header of 0055 for what that costs and why.';

-- The read this exists for: the newest confirmation per child.
create index if not exists detail_confirmations_child_idx
  on public.detail_confirmations (child_id, confirmed_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- A guardian confirms for their own ward and reads their own confirmations. Staff who can
-- see the child can read them, because "when did this family last check" is a question the
-- office and an educator planning a trip both have.
--
-- Nobody can write one for somebody else's child, and nobody can write one attributed to a
-- guardian they are not — a confirmation that could be filed on a family's behalf is a
-- record of somebody else's assurance.
-- ---------------------------------------------------------------------------

alter table public.detail_confirmations enable row level security;

drop policy if exists detail_confirmations_select on public.detail_confirmations;
create policy detail_confirmations_select on public.detail_confirmations
  for select using (public.caller_may_see_child(child_id));

drop policy if exists detail_confirmations_insert on public.detail_confirmations;
create policy detail_confirmations_insert on public.detail_confirmations
  for insert with check (
    -- Their own ward. `caller_ward_ids` is guardianship, not visibility — an educator can
    -- see the child and has nothing to confirm about them.
    child_id in (select public.caller_ward_ids())
    -- And attributed to themselves. `guardians.user_id` is the link, and it is checked
    -- here rather than trusted from the client.
    and exists (
      select 1 from public.guardians g
       where g.id = guardian_id
         and g.user_id = auth.uid()
    )
  );

-- No UPDATE and no DELETE policy, and the grants withhold the verbs as well, so append-only
-- is enforced twice — the arrangement 0009 uses for attendance.
revoke all on public.detail_confirmations from anon, authenticated, service_role;
grant select, insert on public.detail_confirmations to authenticated, service_role;
