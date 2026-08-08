-- ---------------------------------------------------------------------------
-- 0049 — what was asked of the model, and what it cost
--
-- One row per call to an external model provider. It exists for two questions a centre
-- is entitled to ask — *how often does this happen* and *what is it costing me* — and
-- for one this product needs to answer itself: has this centre spent enough this month
-- that the next call should be refused.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- IT RECORDS THE SHAPE OF THE CALL, NEVER ITS CONTENT
--
-- No prompt, no response, no figures. Storing what was sent would re-create the
-- disclosure inside our own database and hand it a second lifetime under a different
-- retention rule — and the thing worth auditing is that a call happened, by whom, for
-- which feature, at what cost. `feature` is a developer-authored constant, not a label
-- anybody types.
--
-- The consequence is stated rather than hidden: **this table cannot answer "what did we
-- send".** The answer to that is structural instead — `redactForModel` in `@ece/core`
-- cannot express a name, and refuses rather than sanitising. An audit log of payloads
-- would be a weaker guarantee wearing a stronger one's clothes.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPEND-ONLY, INCLUDING AGAINST `service_role`
--
-- Same treatment as `payments` and `attendance_events`: UPDATE and DELETE are withheld
-- from every role. A usage record somebody can edit cannot answer "what did this cost",
-- and a spend cap computed over an editable table is not a cap.
--
-- No audit trigger, for the reason 0021 records for every append-only table: the row is
-- its own record, and an audit row describing an insert that can never be followed by an
-- edit is noise. Named in the suite's exemption list rather than left to be noticed.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- `cents_estimate`, AND WHY THE NAME MATTERS
--
-- It is this product's arithmetic over token counts and a price list held in code — not
-- a figure from an invoice. It will drift from what Anthropic actually bills the day a
-- price changes, and calling it `cost_cents` would invite somebody to reconcile it
-- against a statement and believe the difference means something. The name says it is an
-- estimate; `unverified-claims` says so too.
-- ---------------------------------------------------------------------------

create table if not exists public.ai_requests (
  id             uuid primary key default gen_random_uuid(),
  centre_id      uuid not null references public.centres(id) on delete cascade,

  -- A developer-authored constant naming which surface asked. Never free text.
  feature        text not null,
  -- The model string as sent, so a later reader can tell which one produced what.
  model          text not null,

  requested_by   uuid references auth.users(id) on delete set null,

  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cents_estimate integer not null default 0,

  /*
    How it ended. `refused` is the model declining (a `refusal` stop reason), which is a
    normal outcome rather than an error — a childcare incident narrative is exactly the
    kind of text a safety classifier may decline, and a product that logged that as a
    failure would have somebody chasing an outage that is not one.

    `blocked` is *this* product refusing before anything left: the centre's flag is off,
    the month's cap is spent, or the redactor rejected the payload.
  */
  outcome        text not null,

  created_at     timestamptz not null default now(),

  constraint ai_requests_feature_present check (length(trim(feature)) > 0),
  constraint ai_requests_outcome_known check (
    outcome in ('ok', 'refused', 'blocked', 'error')
  ),
  constraint ai_requests_counts_sane check (
    input_tokens >= 0 and output_tokens >= 0 and cents_estimate >= 0
  )
);

comment on table public.ai_requests is
  'One row per call to an external model provider: which feature, which model, what it cost. Never the prompt or the response — storing those would re-create the disclosure inside this database. Append-only, including against service_role.';
comment on column public.ai_requests.cents_estimate is
  'This product''s arithmetic over token counts and a price list in code, not a figure from an invoice. Named an estimate because it will drift the day a price changes.';

-- The index the spend cap needs: "this centre, this month".
create index if not exists ai_requests_centre_month_idx
  on public.ai_requests (centre_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Policies
--
-- Owner and manager: it is the centre's spend and the centre's disclosure record.
-- An educator has no reason to read it and a parent still less — the family-facing
-- answer to "what do you send" is the privacy statement, not a usage log.
-- ---------------------------------------------------------------------------

alter table public.ai_requests enable row level security;

drop policy if exists ai_requests_select on public.ai_requests;
create policy ai_requests_select on public.ai_requests
  for select using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

drop policy if exists ai_requests_insert on public.ai_requests;
create policy ai_requests_insert on public.ai_requests
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
    -- Attributed to whoever asked, on the same terms as attendance: a usage record that
    -- cannot say who made the call is not much of a record.
    and (requested_by is null or requested_by = auth.uid())
  );

-- No UPDATE and no DELETE policy, and the grants below withhold the verbs as well, so
-- append-only is enforced twice — the arrangement 0009 uses for attendance.
revoke all on public.ai_requests from anon, authenticated, service_role;
grant select, insert on public.ai_requests to authenticated, service_role;
