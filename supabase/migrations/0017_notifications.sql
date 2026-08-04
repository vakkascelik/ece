-- 0017 — push tokens, preferences, and quiet hours
--
-- WHAT IS AND IS NOT VERIFIED HERE
--
-- The data model and the quiet-hours logic are built and tested. **Delivery is not**, and cannot
-- be from here: Expo push needs a token from a real build on a real device, and this project has
-- never been through EAS. The queue below is written so that when a build exists, sending is a
-- worker reading rows rather than a redesign.
--
-- Recorded in llm-wiki/wiki/unverified-claims.md alongside the airplane-mode drill, for the same
-- reason: a thing that looks finished and has never run once is worth naming.
--
-- WHY A QUEUE RATHER THAN SENDING INLINE
--
-- Publishing a pānui to forty families should not make an educator wait on Expo's API, and it
-- must not half-succeed. So publishing writes rows; a worker sends them and records the outcome.
-- That also makes quiet hours implementable at all — a notification held until 7am has to exist
-- somewhere in the meantime.

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------

create table if not exists public.push_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  /** Expo push token. Device-scoped, not user-scoped: one person, several devices. */
  token       text not null unique,
  platform    text,
  /** Cleared when Expo reports the token dead, so a worker stops retrying it. */
  disabled_at timestamptz,
  last_seen   timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  constraint push_tokens_token_present check (length(trim(token)) > 0)
);

create index if not exists push_tokens_user_idx on public.push_tokens (user_id) where disabled_at is null;

comment on table public.push_tokens is
  'Not centre-scoped. A device belongs to a person, and a person may be at two centres — so the token is theirs and the notification decides the audience.';

-- ---------------------------------------------------------------------------
-- Preferences
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.notification_kind as enum ('post', 'message', 'attendance', 'reminder');
exception when duplicate_object then null; end $$;

create table if not exists public.notification_preferences (
  user_id      uuid primary key references auth.users(id) on delete cascade,

  posts        boolean not null default true,
  messages     boolean not null default true,
  attendance   boolean not null default false,
  reminders    boolean not null default true,

  /**
   * Quiet hours, as local wall-clock times.
   *
   * Stored as `time` and not as an offset from UTC, because a family means "not before 7am" in
   * their own morning and that is a different instant in April than in October. The zone comes
   * from the centre.
   *
   * Defaults cover the evening and the night. A notification about a child's day does not need
   * to arrive at 11pm, and one that does teaches people to turn the app's notifications off
   * entirely — which costs the messages that did matter.
   */
  quiet_from   time not null default '20:00',
  quiet_until  time not null default '07:00',
  /** Off means send at any hour. Deliberately opt-out rather than opt-in. */
  quiet_hours  boolean not null default true,

  updated_at   timestamptz not null default now()
);

comment on column public.notification_preferences.quiet_from is
  'Local wall clock in the centre timezone. A window that wraps midnight is normal and is handled in @ece/core.';

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id           bigserial primary key,
  centre_id    uuid not null references public.centres(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,

  kind         public.notification_kind not null,
  title        text not null,
  body         text not null,
  /** Where tapping it should land. A route, never a URL with a token in it. */
  route        text,

  created_at   timestamptz not null default now(),
  /**
   * The earliest it may be sent. Set to the end of quiet hours at write time, so the queue
   * carries the decision rather than a worker having to re-derive it — and so a preference
   * changed at midnight does not retroactively release everything held that evening.
   */
  send_after   timestamptz not null default now(),

  sent_at      timestamptz,
  /** Set when it will never be sent, with the reason. Not deleted: a notification that was
   *  suppressed is a fact about what a family was and was not told. */
  failed_at    timestamptz,
  failure      text,

  constraint notifications_title_present check (length(trim(title)) > 0)
);

-- The worker's query: unsent, due, oldest first.
create index if not exists notifications_pending_idx
  on public.notifications (send_after)
  where sent_at is null and failed_at is null;

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.push_tokens              enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications            enable row level security;

-- A device token is the caller's own business and nobody else's — not a manager's.
drop policy if exists push_tokens_own on public.push_tokens;
create policy push_tokens_own on public.push_tokens
  for all
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists notification_preferences_own on public.notification_preferences;
create policy notification_preferences_own on public.notification_preferences
  for all
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

/**
 * A person reads their own notifications and nothing else.
 *
 * Not even staff at the centre. The queue records what a specific family was told and when,
 * which is not a thing an educator needs to browse — and the events that caused it are all
 * readable through their own tables anyway.
 */
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select using (user_id = auth.uid());

-- No INSERT policy for `authenticated`. Queueing a notification means deciding who receives it,
-- which is a fan-out across a centre's families — a service-role action, like onboarding.
-- Nothing here lets one user put a message in another user's queue.

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.push_tokens              from anon, authenticated, service_role;
revoke all on public.notification_preferences from anon, authenticated, service_role;
revoke all on public.notifications            from anon, authenticated, service_role;

grant select, insert, update, delete on public.push_tokens to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select on public.notifications to authenticated;

grant all on public.push_tokens              to service_role;
grant all on public.notification_preferences to service_role;
grant all on public.notifications            to service_role;
grant usage on sequence public.notifications_id_seq to authenticated, service_role;
