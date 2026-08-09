-- ---------------------------------------------------------------------------
-- 0057 — an emergency broadcast, and the record that one was sent
--
-- Phase 12's "Emergency broadcast" item, scoped down from what the roadmap sketched.
-- The roadmap said "build on push and email first" — this project has neither: push has
-- never been executed once (unverified-claims item 5, EAS/device work nobody here can do),
-- and there is no email-sending integration of any kind, only Supabase Auth's own templates
-- for password resets. Building a real email vendor integration now would be its own
-- multi-day undertaking with its own privacy-statement change, and SMS is explicitly out —
-- "a vendor, a cost, a phone-number column that is a new PII surface". So this ships the one
-- channel that is actually real today: a queue row every member can read through the
-- existing `notifications_own` policy, surfaced on a page a family can open. That is a real,
-- working delivery path — just a narrower one than "broadcast" usually implies, and the wiki
-- says so rather than letting the word oversell it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A SEPARATE `emergency_broadcasts` TABLE, WHEN `notifications` ALREADY EXISTS
--
-- `notifications` is a per-person delivery queue — one row per recipient, and its own RLS
-- means nobody but that person can read their row, by design (0017: "not even staff at the
-- centre... the events that caused it are all readable through their own tables anyway").
-- An emergency broadcast is the one case where that reasoning does not hold: an owner needs
-- to see WHAT was sent, WHO sent it and to HOW MANY people, as a single fact, not as forty
-- individual delivery rows they have no policy to read. `emergency_broadcasts` is that fact.
-- Append-only, the same reasoning `detail_confirmations` and `ai_requests` already carry
-- here: a sent broadcast is a record of what a centre told its families, and an editable
-- version of that record answers nothing a reviewer could trust.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY A SECURITY DEFINER FUNCTION RATHER THAN AN INSERT POLICY
--
-- Sending one means writing into every member's row in `notifications` — a fan-out across
-- the whole centre, which 0017's own comment already named as "a service-role action, like
-- onboarding" when it declined to grant `authenticated` any INSERT at all. `broadcast_emergency`
-- is that action: it checks the caller is an owner or manager of the centre explicitly,
-- because bypassing RLS means authorisation has to be checked in the function body or it is
-- not checked at all — the same shape `purge_child` uses.
-- ---------------------------------------------------------------------------

create table if not exists public.emergency_broadcasts (
  id               uuid primary key default gen_random_uuid(),
  centre_id        uuid not null references public.centres(id) on delete cascade,
  sent_by          uuid not null references auth.users(id),
  title            text not null,
  body             text not null,
  /** How many `notifications` rows this broadcast fanned out to. A count, not a join to
      `notifications` — those rows are per-recipient and this table is staff-visible. */
  recipient_count  integer not null,
  created_at       timestamptz not null default now(),

  constraint emergency_broadcasts_title_present check (length(trim(title)) between 1 and 200),
  constraint emergency_broadcasts_body_present  check (length(trim(body)) between 1 and 2000)
);

create index if not exists emergency_broadcasts_centre_idx
  on public.emergency_broadcasts (centre_id, created_at desc);

comment on table public.emergency_broadcasts is
  'What was sent, by whom, to how many — append-only. Not the per-recipient queue; see notifications for that.';

alter table public.emergency_broadcasts enable row level security;

-- Owner and manager only, the same pair `manageCentre` already gates in the app — an
-- educator has no reason to browse the centre's emergency history and a parent still less.
drop policy if exists emergency_broadcasts_select on public.emergency_broadcasts;
create policy emergency_broadcasts_select on public.emergency_broadcasts
  for select using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

-- No INSERT policy for `authenticated` at all — the only write path is the function below,
-- which bypasses RLS as service-role code always does here, and checks the same two roles
-- explicitly. No UPDATE or DELETE policy either: append-only, and the grants below say so
-- to `service_role` too, not just to `authenticated`.
revoke all on public.emergency_broadcasts from anon, authenticated, service_role;
grant select on public.emergency_broadcasts to authenticated;
grant all    on public.emergency_broadcasts to service_role;
-- Append-only for real: even the grant above is narrowed back down, because "all" on a
-- table with RLS enabled still needs INSERT to land a row, and the function runs as the
-- table owner (SECURITY DEFINER), not as service_role — service_role's grant here is for
-- reading and administering the table, not for writing rows day to day.
revoke update, delete on public.emergency_broadcasts from service_role;

-- ---------------------------------------------------------------------------
-- The function
-- ---------------------------------------------------------------------------

create or replace function public.broadcast_emergency(
  p_centre_id uuid,
  p_title     text,
  p_body      text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipients integer;
begin
  if not public.caller_has_role(p_centre_id, array['owner', 'manager']::public.member_role[]) then
    raise exception 'Only an owner or manager may send an emergency broadcast.';
  end if;

  if p_title is null or length(trim(p_title)) not between 1 and 200 then
    raise exception 'A title is required, up to 200 characters.';
  end if;
  if p_body is null or length(trim(p_body)) not between 1 and 2000 then
    raise exception 'A message is required, up to 2000 characters.';
  end if;

  /*
    Every active human membership at the centre — owner, manager, educator, parent alike.
    `role != 'kiosk'` excludes the door tablet: it is a device with no inbox, not a person
    who could open /notifications and read this. Nobody is excluded by notification
    preference or quiet hours; `send_after = now()` is the whole point of "emergency".
  */
  insert into public.notifications (centre_id, user_id, kind, title, body, send_after)
  select p_centre_id, m.user_id, 'emergency', trim(p_title), trim(p_body), now()
    from public.memberships m
   where m.centre_id = p_centre_id
     and m.revoked_at is null
     and m.role != 'kiosk';

  get diagnostics v_recipients = row_count;

  insert into public.emergency_broadcasts (centre_id, sent_by, title, body, recipient_count)
  values (p_centre_id, auth.uid(), trim(p_title), trim(p_body), v_recipients);

  return v_recipients;
end $$;

comment on function public.broadcast_emergency(uuid, text, text) is
  'Fans out an emergency notification to every active member of a centre, bypassing quiet hours and preference, and records what was sent in emergency_broadcasts. Owner/manager only, checked here because SECURITY DEFINER bypasses RLS.';

-- Not granted to anon — this is not a public write path like the enquiry and careers forms.
-- authenticated only, and the function's own check narrows it to owner/manager from there.
revoke execute on function public.broadcast_emergency(uuid, text, text) from public;
grant  execute on function public.broadcast_emergency(uuid, text, text) to authenticated, service_role;
