-- 0003 — audit log
--
-- Early childhood education is a regulated setting, and after an incident the
-- question is always "who knew what, and when". A licensing review asks the same
-- thing about records. So mutations to anything consequential are recorded, and
-- the record cannot be edited by the people it is about.
--
-- Deliberately append-only: no UPDATE policy, no DELETE policy, for anybody
-- including owners. An audit log an owner can quietly edit is not evidence, and
-- being able to say "this cannot be altered" is most of its value.

create table if not exists public.audit_events (
  id          bigserial primary key,
  centre_id   uuid        not null references public.centres(id) on delete cascade,
  actor_id    uuid        references auth.users(id) on delete set null,
  action      text        not null,
  entity      text        not null,
  entity_id   text,
  -- What changed, not the whole row. Storing the full before/after of a child
  -- record would duplicate health and custody data into a table nobody thinks of
  -- as holding it — and audit rows outlive the records they describe.
  detail      jsonb       not null default '{}'::jsonb,
  at          timestamptz not null default now()
);

comment on table public.audit_events is
  'Append-only record of consequential changes. No update or delete policy exists, by design.';
comment on column public.audit_events.detail is
  'Changed fields only. Never store health, custody or contact detail here — audit rows outlive the record they describe.';

create index if not exists audit_events_centre_at_idx on public.audit_events (centre_id, at desc);
create index if not exists audit_events_entity_idx    on public.audit_events (centre_id, entity, entity_id);

alter table public.audit_events enable row level security;

-- Read: anyone who administers the centre. An educator does not need the audit
-- log, and a parent certainly does not.
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events
  for select using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

-- Write: any member of the centre may append, because the app records the
-- actions of educators as well as managers. WITH CHECK pins the row to a centre
-- the caller belongs to and the actor to the caller — without the actor clause,
-- a member could write an entry blaming somebody else, which is worse than
-- having no log at all.
drop policy if exists audit_insert on public.audit_events;
create policy audit_insert on public.audit_events
  for insert with check (
    centre_id in (select public.caller_centre_ids())
    and (actor_id is null or actor_id = auth.uid())
  );

-- No UPDATE or DELETE policy. RLS denies by default, so omitting them is the
-- enforcement, not an oversight. Correcting a mistaken entry means appending a
-- correcting entry.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
--
-- Postgres checks the table privilege before it applies any policy, so these are
-- required for the policies above to be reachable at all — see the note in 0001.
--
-- Here the grant list does more than enable the policies: withholding UPDATE and
-- DELETE makes append-only true at the privilege layer as well as the policy
-- layer. Two independent mechanisms, which matters because the value of this
-- table is entirely in the claim that nobody can quietly edit it — and because
-- somebody will eventually add a policy to this file without reading the comment
-- explaining why there isn't one.
revoke all on public.audit_events from anon, authenticated, service_role;
grant select, insert on public.audit_events to authenticated;

-- service_role bypasses RLS but not grants, so it is listed explicitly — and
-- deliberately gets the same two verbs as everybody else.
--
-- This is a real choice, not an oversight. The service key is otherwise the thing
-- that defeats every protection in this schema: it can read every centre's
-- children in one query. It does not have to be able to rewrite the record of
-- what it did. Withholding UPDATE and DELETE here means the only credential that
-- can alter this table is the database owner, which is not in any application's
-- environment. That is the difference between a log and evidence.
--
-- If a future scheduled job needs to prune old audit rows for retention, it needs
-- a migration granting DELETE with a stated retention window — a deliberate,
-- reviewable act rather than a capability that was always quietly there.
grant select, insert on public.audit_events to service_role;

-- bigserial: INSERT also needs the sequence, and the failure without it reads as
-- "permission denied for sequence audit_events_id_seq", which does not obviously
-- point back to this line.
grant usage on sequence public.audit_events_id_seq to authenticated, service_role;

/**
 * Helper so application code records an event in one line and cannot forget the
 * actor or the centre.
 */
create or replace function public.record_audit(
  p_centre_id uuid,
  p_action    text,
  p_entity    text,
  p_entity_id text default null,
  p_detail    jsonb default '{}'::jsonb
) returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.audit_events (centre_id, actor_id, action, entity, entity_id, detail)
  values (p_centre_id, auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb));
$$;

-- security invoker, not definer: the insert must be subject to the same policy
-- as a direct write, so a caller cannot use this function to log against a
-- centre they do not belong to.
