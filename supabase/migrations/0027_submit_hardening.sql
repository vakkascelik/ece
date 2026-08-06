-- ---------------------------------------------------------------------------
-- 0027 — the public submission function, made to hold what it claims to hold
--
-- `submit_job_application` is the only write an unauthenticated caller may perform anywhere in
-- this schema, and 0024 says of it: "the function raises a readable error; this is what
-- actually stops an anonymous caller storing a megabyte". Two things about that were untrue.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. It validated three fields and the table constrained six
--
-- The function checked the name is present, the email has an `@`, and the message is under
-- 4000 characters. The table also caps the name at 200, the email at 320, the phone at 40 and
-- the position at 120 — and the function checked none of those, so a direct RPC call with a
-- 500-character phone number got:
--
--   new row for relation "job_applications" violates check constraint
--   "job_applications_phone_len"
--
-- The table held, which is the important half: nothing could be stored. But the function
-- advertises itself as the layer that produces a sentence instead of a constraint violation,
-- and for three of six fields it produced the constraint violation. The browser never sees
-- this because the form carries `maxLength`, so the only caller who hits it is one not using
-- the form — which is precisely the caller this function exists to be safe against.
--
-- The limits are restated here rather than read from the constraints because there is no way
-- to read a CHECK expression as a number. They are pinned on the TypeScript side by
-- `APPLICATION_LIMITS` and its test; a third copy is the price of a readable error.
-- ---------------------------------------------------------------------------

create or replace function public.submit_job_application(
  p_centre_slug                text,
  p_applicant_name             text,
  p_email                      text,
  p_phone                      text default null,
  p_position_sought            text default null,
  p_holds_practising_certificate boolean default null,
  p_available_from             date default null,
  p_message                    text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_centre uuid;
  v_recent int;
begin
  if p_applicant_name is null or length(trim(p_applicant_name)) = 0 then
    raise exception 'A name is required.';
  end if;

  -- The three that were missing. Trimmed lengths, because the insert trims before storing and
  -- refusing 201 characters of which one is a trailing space would be wrong.
  if length(trim(p_applicant_name)) > 200 then
    raise exception 'Please keep your name under 200 characters.';
  end if;

  if p_email is null or position('@' in p_email) < 2 or length(trim(p_email)) > 320 then
    raise exception 'A valid email address is required.';
  end if;

  if length(trim(coalesce(p_phone, ''))) > 40 then
    raise exception 'Please keep the phone number under 40 characters.';
  end if;

  if length(trim(coalesce(p_position_sought, ''))) > 120 then
    raise exception 'Please keep the role to a few words.';
  end if;

  if length(coalesce(p_message, '')) > 4000 then
    raise exception 'Please keep the message under 4000 characters.';
  end if;

  /*
   * The caller sends a slug, never a centre id. A client-supplied uuid on an unauthenticated form
   * is an invitation to write into another tenant, and this function bypasses RLS, so nothing
   * downstream would stop it.
   */
  select c.id into v_centre from public.centres c where c.slug = p_centre_slug;
  if v_centre is null then
    raise exception 'Unknown centre.';
  end if;

  -- Flood guard. Per centre rather than per email or per IP: an email address is chosen by the
  -- sender and this function cannot see an IP. Deliberately loose — a genuine applicant refused
  -- because a stranger was running a script has been failed by this.
  select count(*) into v_recent
    from public.job_applications
   where centre_id = v_centre
     and created_at > now() - interval '1 minute';

  if v_recent >= 10 then
    raise exception 'Too many applications have been received just now. Please try again in a few minutes.';
  end if;

  /*
   * Idempotent while an application is open, and quiet rather than raising: an error saying "you
   * have already applied" would tell anybody who asked whether a given address had applied here.
   *
   * The unique index added below is what makes this actually atomic. This check stays because it
   * is what makes a repeat submission a SILENT no-op — without it the insert would raise 23505 and
   * the caller would learn exactly what the index knows.
   */
  if exists (
    select 1 from public.job_applications
     where centre_id = v_centre
       and lower(email) = lower(trim(p_email))
       and status in ('new', 'reviewing', 'interview', 'offered')
  ) then
    return;
  end if;

  begin
    insert into public.job_applications (
      centre_id, applicant_name, email, phone, position_sought,
      holds_practising_certificate, available_from, message, source
    ) values (
      v_centre,
      trim(p_applicant_name),
      trim(p_email),
      nullif(trim(coalesce(p_phone, '')), ''),
      nullif(trim(coalesce(p_position_sought, '')), ''),
      p_holds_practising_certificate,
      p_available_from,
      nullif(trim(coalesce(p_message, '')), ''),
      'website'
    );
  exception when unique_violation then
    /*
     * Lost the race for the unique index below: another request for the same mailbox and centre
     * committed between the check above and this insert. That is the double-click this function
     * exists to absorb, so it is success, and it stays silent for the same reason the check does.
     */
    return;
  end;
end $$;


-- ---------------------------------------------------------------------------
-- 2. The duplicate check was a read-then-write, so the double-click it exists
--    to absorb could still produce two rows
--
-- `if exists (...) then return; end if;` followed by an insert is two statements. Two requests
-- arriving together — a double-tapped submit button on a slow connection is the ordinary case —
-- both run the check before either inserts, both find nothing, and both insert. The comment in
-- 0024 says the quiet return exists so "a double-clicked submit button must not create two rows
-- for one person"; nothing enforced it.
--
-- A partial unique index makes it atomic, and partial is the whole trick: uniqueness on
-- (centre, email) outright would be wrong, because somebody declined last year is entitled to
-- apply again. Scoping it to the open statuses says exactly what is meant — one LIVE
-- application per mailbox per centre — and leaves the closed ones alone.
--
-- `lower(email)` matches the check it is replacing, so 'A@b.nz' and 'a@b.nz' are one person.
-- ---------------------------------------------------------------------------

create unique index if not exists job_applications_one_open_per_email
  on public.job_applications (centre_id, lower(email))
  where status in ('new', 'reviewing', 'interview', 'offered');

comment on index public.job_applications_one_open_per_email is
  'One OPEN application per mailbox per centre. Partial on purpose: somebody declined last year '
  'may apply again, so the closed rows are not constrained. Makes the duplicate check in '
  'submit_job_application atomic rather than advisory — see 0027.';

/*
 * The index makes the earlier index redundant as a lookup for that check, but it is kept: it has
 * no status predicate, so it still serves the "has this person ever applied here" reads a staff
 * screen would do, and dropping an index to save nothing is not a trade.
 */
