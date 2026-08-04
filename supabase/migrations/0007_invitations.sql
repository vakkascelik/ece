-- 0007 — invitations
--
-- Until now, adding a person to a centre meant running `scripts/onboard.ts` with
-- the service-role key. That is correct for creating a tenant and wrong for adding
-- the fifth educator, which a manager should be able to do on a Tuesday without
-- anybody's laptop.
--
-- WHY THIS IS NOT JUST AN INSERT INTO `memberships`
--
-- There is deliberately no INSERT grant on `memberships` (0001), because the
-- self-serve version of "add a person" is how a stranger joins a centre and reads
-- children's records. So an invitation is a two-step handshake: a manager states an
-- intention, and the person named proves they control that mailbox. The membership
-- is created by the server at the end, not by either party.
--
-- THE TOKEN IS STORED HASHED
--
-- Only the SHA-256 of the token is kept. A database read — a leaked backup, an
-- errant service-role query, a support person with dashboard access — then yields
-- nothing usable, because the tokens themselves exist only in the emails they were
-- sent in. This is the same reasoning as never storing a password.
--
-- It also means an invitation link cannot be recovered. Losing it means issuing a
-- new one, which is the correct trade.

create table if not exists public.invitations (
  id           uuid primary key default gen_random_uuid(),
  centre_id    uuid not null references public.centres(id) on delete cascade,

  -- Lowercased on the way in, because mailbox comparison here has to be
  -- case-insensitive and a `citext` column would mean an extension for one field.
  email        text not null,
  role         public.member_role not null,

  -- SHA-256 hex of the token. Unique so a collision is a constraint violation
  -- rather than two invitations answering to one link.
  token_hash   text not null unique,

  invited_by   uuid references auth.users(id) on delete set null,
  -- Seven days. Long enough for someone on leave, short enough that a link found in
  -- an old inbox is no longer a way in.
  expires_at   timestamptz not null default now() + interval '7 days',

  accepted_at  timestamptz,
  accepted_by  uuid references auth.users(id) on delete set null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),

  constraint invitations_email_lowercased check (email = lower(email)),
  constraint invitations_email_shaped check (email like '%_@_%'),
  -- Accepted means we know who accepted it. A row claiming acceptance with no
  -- acceptor is not evidence of anything.
  constraint invitations_accepted_has_actor check (
    (accepted_at is null) = (accepted_by is null)
  )
);

comment on table public.invitations is
  'Pending invitations to join a centre. Only the SHA-256 of each token is stored; the token itself exists only in the email it was sent in.';
comment on column public.invitations.token_hash is
  'SHA-256 hex. Never granted to authenticated — see the column-level grant below.';

-- One live invitation per mailbox per centre. Re-inviting somebody who already has
-- a pending invitation should replace it, not add a second link that also works.
create unique index if not exists invitations_one_live_per_email
  on public.invitations (centre_id, email)
  where accepted_at is null and revoked_at is null;

create index if not exists invitations_centre_idx on public.invitations (centre_id);

alter table public.invitations enable row level security;

-- Only the people who can change the roster can see or issue invitations.
drop policy if exists invitations_select on public.invitations;
create policy invitations_select on public.invitations
  for select using (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
  );

drop policy if exists invitations_insert on public.invitations;
create policy invitations_insert on public.invitations
  for insert with check (
    public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[])
    -- Attributed to whoever issued it. An invitation is a grant of access to
    -- children's records, so "who let them in" must be answerable.
    and (invited_by is null or invited_by = auth.uid())
  );

-- Revoking is an UPDATE of `revoked_at`; the column grant is what confines it.
drop policy if exists invitations_revoke on public.invitations;
create policy invitations_revoke on public.invitations
  for update
  using (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner', 'manager']::public.member_role[]));

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke all on public.invitations from anon, authenticated;

-- Note what is missing: `token_hash`. A manager may list the invitations they
-- issued, and must not be able to read the hashes back out — there is no reason for
-- a browser to hold them, and a column grant is the only thing that can say so.
grant select (
  id, centre_id, email, role, invited_by, expires_at, accepted_at, accepted_by,
  revoked_at, created_at
) on public.invitations to authenticated;

grant insert (centre_id, email, role, token_hash, invited_by, expires_at)
  on public.invitations to authenticated;

grant update (revoked_at) on public.invitations to authenticated;

-- Acceptance runs as the service role: it has to look an invitation up by hash
-- before the caller has any membership at the centre, and then insert into
-- `memberships`, which nobody else may do.
grant all on public.invitations to service_role;
