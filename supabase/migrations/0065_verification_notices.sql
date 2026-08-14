-- ---------------------------------------------------------------------------
-- 0065 — the chase has a memory: which families were asked, and how many times
--
-- 0061–0064 built the record, the door, and the screens. What §6-3 actually runs on is a
-- rhythm — the record is released weekly, the unanswered are reminded, and after three
-- asks the office offers paper. The approved SMS in this market sends "weekly email
-- reminders, once a week for 3 weeks", and a chase that cannot remember what it sent
-- either nags a family daily or goes silent after a restart — both are how the rhythm
-- dies.
--
-- The obvious place to remember is the notifications table the notices land in, and it is
-- the wrong place: "how many CHASE notices for THIS week reached THIS guardian" would have
-- to be recovered by pattern-matching titles and routes, and the first reworded title
-- silently resets every count. A record the logic depends on gets its own table.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WRITTEN BY THE SCHEDULER ONLY, AND WHAT THAT MEANS HERE
--
-- The writer is `scripts/run-scheduled.ts` holding the service key. `service_role`
-- bypasses RLS, so for this table the policies are not the write boundary — the grants
-- are: INSERT is granted to `service_role` and to nobody else, and there is deliberately
-- NO insert policy, so an `authenticated` caller fails the grant before any policy is
-- consulted. Staff can read (the office asking "what have we already sent this family"
-- is a real question); families cannot — a ledger of how many times the centre nudged
-- you is the centre's operational record, not part of your child's file.
--
-- `sent_on` is a date in the CENTRE's calendar, supplied by the job — never defaulted,
-- because a default would be `current_date`, which is the UTC session's day, which is the
-- bug this repo has now shipped five times and tests against by name.
--
-- Append-only including service_role, same as every table whose row is its own record: a
-- chase count that could be edited answers nothing, and the one-per-week rule reads this
-- table to decide whether to send — an editable input to a send decision is how a family
-- gets three notices in a morning.
-- ---------------------------------------------------------------------------

create table if not exists public.verification_notices (
  id           bigserial primary key,

  /* No centre_id — the tenant is reached through the child, as attendance_verifications,
     detail_confirmations and attendance_events all do. */
  child_id     uuid not null references public.children(id)  on delete cascade,
  guardian_id  uuid not null references public.guardians(id) on delete cascade,

  period_start date not null,
  period_end   date not null,

  /* The centre-calendar day the job ran. The one-notice-per-week rule compares against
     this, so it must be the centre's day: a job running at 11:50pm UTC Sunday is already
     Monday afternoon in Auckland, and the wrong calendar would let Monday's release and
     "the same week's" reminder land minutes apart. */
  sent_on      date not null,

  created_at   timestamptz not null default now(),

  constraint vn_period_ordered check (period_end >= period_start)
);

comment on table public.verification_notices is
  'One row per §6-3 chase notice sent to a signatory about a week awaiting their '
  'confirmation. The scheduler''s memory: read to enforce at-most-one-per-week and '
  'at-most-three-per-period. Append-only for everybody including service_role — an '
  'editable input to a send decision is how a family gets three notices in a morning.';

create index if not exists verification_notices_child_period_idx
  on public.verification_notices (child_id, period_start, guardian_id);

alter table public.verification_notices enable row level security;

-- Staff read: "what have we already sent this family" is office work, and an educator
-- fielding a parent at the door benefits from the same answer. Families deliberately
-- read nothing — the ledger of nudges is the centre's, not part of the child's file.
drop policy if exists verification_notices_select on public.verification_notices;
create policy verification_notices_select on public.verification_notices
  for select using (public.caller_is_staff_for_child(child_id));

-- No insert policy on purpose: the only writer holds the service key and bypasses RLS,
-- so a policy here would be dead text implying a write path that must not exist.
revoke all on public.verification_notices from anon, authenticated, service_role;
grant select on public.verification_notices to authenticated;
grant select, insert on public.verification_notices to service_role;
grant usage on sequence public.verification_notices_id_seq to service_role;
