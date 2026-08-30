-- ---------------------------------------------------------------------------
-- 0079 — the 14-day refusal must say its own name, because the outbox reads it
--
-- 0078 moved six `_not_ancient` rules from CHECK constraints to triggers and changed the
-- text of the refusal without noticing that something downstream parses it.
--
-- `classifyWriteFailure` in `@ece/core` decides what the offline outbox does with a
-- refused write, and it matches on the constraint NAME rather than the error code —
-- deliberately, and its comment says why: "the code says only 'a CHECK refused this' and
-- the whole distinction is which check". Two of the six matter to it and they behave in
-- opposite directions:
--
--   attendance_not_future   → retry-later. A drifted device clock. Real time advances and
--                             the row becomes valid on its own, so it must NOT be buried,
--                             and must NOT stop the flush either or one future-dated event
--                             blocks every sign-in queued behind it.
--   attendance_not_ancient  → permanent. An event that aged past the window in a drawer.
--                             Time makes this worse, never better. Needs a person.
--
-- 0078's message was 'row is older than the 14 day window (at on public.attendance_events)'
-- and contains neither name. THE CLASSIFICATION WOULD STILL HAVE BEEN RIGHT, by luck: the
-- trigger raises errcode `check_violation`, the generic `\b23514\b` rule catches it, and
-- `permanent` is the correct answer. So nothing would have broken today.
--
-- What would have broken is later. The named rule becomes dead code matching a string the
-- database can no longer produce, its unit test goes on passing because it feeds a
-- synthetic message rather than a real one, and the comment above it — "named explicitly
-- so the two clock-related constraints cannot be confused by a future reader" — describes
-- a protection that is no longer there. The next person to add a `_not_ancient` rule to a
-- seventh table would rely on it. That is the shape of decay this repo has already paid
-- for once, when `offline-outbox.md` spent a day documenting the opposite of the fix that
-- had just been made.
--
-- So the message carries `tg_name`, which 0078 deliberately kept equal to the old
-- constraint name for exactly this kind of continuity — an operator reading a failure sees
-- the identifier the product has raised since 0009, and now so does the outbox.
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT TO 0078
--
-- 0078 is applied and its checksum is bound. Same rule, same reason, and the third time in
-- this repo's history that a follow-up migration is cheaper than defeating the checksum:
-- 0070 after 0068, 0077 after 0076, this after 0078.
-- ---------------------------------------------------------------------------

create or replace function public.reject_ancient_row()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  -- Yield to a restore. A data-quality guard, not a boundary — see 0078's header.
  if coalesce(current_setting('app.restoring', true), '') = 'on' then
    return new;
  end if;

  -- tg_argv[0] is the timestamp column: `at` on five of the six, `given_at` on
  -- medication_administrations. Read through jsonb so one function serves all six.
  -- A wrong name here yields NULL and turns the guard into decoration, which is why
  -- rls_isolation.sql asserts the wiring from pg_trigger rather than trusting it.
  v_at := (to_jsonb(new) ->> tg_argv[0])::timestamptz;

  -- A null timestamp is not this trigger's business: every one of these columns is
  -- NOT NULL and that is the right place to say so.
  if v_at is not null and v_at <= now() - interval '14 days' then
    -- tg_name leads, and it is the old constraint name. classifyWriteFailure() matches
    -- on it to tell this apart from attendance_not_future, which retries rather than
    -- being buried. Changing this text without reading that function is how a drifted
    -- tablet loses a day.
    raise exception
      '% : row is older than the 14 day window (% on %.%)',
      tg_name, tg_argv[0], tg_table_schema, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.reject_ancient_row() from public, anon, authenticated;

comment on function public.reject_ancient_row() is
  'Trigger only. Refuses an INSERT whose timestamp column (tg_argv[0]) is more than 14 days old, and names itself in the message because @ece/core classifyWriteFailure() reads that name to tell an aged event (permanent) from a drifted clock (retry-later). Replaces six time-relative CHECK constraints that made the operational core unrestorable. Yields when app.restoring is ''on'' — a data-quality guard, not a security control: the tenant boundary is RLS.';

do $$
declare
  msg text := '';
begin
  -- The whole point of this migration, asserted rather than assumed. A message that does
  -- not carry the name would leave classifyWriteFailure's named rule matching nothing.
  begin
    insert into public.staff_count_events (centre_id, adults, at, client_uuid)
    select id, 3, now() - interval '90 days', gen_random_uuid()
      from public.centres limit 1;
    msg := 'accepted';
  exception when others then msg := sqlerrm;
  end;
  if msg not like '%staff_count_not_ancient%' then
    raise exception '0079: the refusal does not name its trigger, got: %', msg;
  end if;
end $$;
