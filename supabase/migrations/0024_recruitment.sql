-- ---------------------------------------------------------------------------
-- 0024 — job applications, and the first thing an unauthenticated stranger may write
--
-- Little Pearls' careers page said "email your CV to career@littlepearls.org.nz", which
-- means every application lives in a shared mailbox: no status, no record of who was
-- replied to, nothing to show if somebody asks why they never heard back, and a deletion
-- request that can only be honoured by hunting through mail folders.
--
-- WHY THIS IS NOT `staff_records`
--
-- `staff_records` is licensing evidence — a sighted first aid certificate, a police
-- vetting result. It answers "can this person work here". An application is a stranger's
-- claim about themselves. Putting an applicant in `staff_records` would put somebody who
-- may never be employed into the table a reviewer reads as the centre's staffing position,
-- which is the same mistake `waitlist` exists to avoid for children.
--
-- The link between them is deliberately one-way and manual: when somebody is hired,
-- staff create the staff records from documents they have sighted. `holds_practising_
-- certificate` below is the applicant's own statement and is NOT evidence of anything.
--
-- ---------------------------------------------------------------------------
-- THE PART THAT NEEDED CARE: A PUBLIC WRITE PATH
-- ---------------------------------------------------------------------------
--
-- Nothing in this schema has ever been writable by an unauthenticated caller. `anon` holds
-- `usage on schema public` and not one table grant, and `scripts/security-review.ts`
-- check 8 fails the build at HIGH severity if that changes. A careers form on the public
-- website needs an anonymous stranger to create a row, so something had to give.
--
-- WHAT WAS TRIED FIRST AND DOES NOT WORK: an insert policy for `anon`. Every policy in
-- this schema is `TO public`, so it is also evaluated for `anon` — and the predicates call
-- `public.caller_has_role`, whose EXECUTE 0022 revoked from PUBLIC. An anonymous insert
-- therefore fails from *inside* the policy with a 42501 that reads like a missing table
-- grant and is not one. Granting `anon` execute on the boundary predicates to fix that
-- would trade a careers form for widening the tenant boundary. Refused.
--
-- WHAT WAS ALSO REJECTED: an HTTP endpoint on `apps/web` guarded by a shared secret, with
-- the site posting server-to-server. That was the original plan for the enquiry form. It
-- puts a new unauthenticated endpoint on the container that holds children's records, and
-- that endpoint holds the service role key — which bypasses RLS on every table in the
-- database. The blast radius of a bug in it is "whatever the handler was written to do",
-- and a later edit widens that silently.
--
-- WHAT THIS DOES: one SECURITY DEFINER function, `submit_job_application`, granted to
-- `anon`. It runs as the owner, so RLS and the predicate-EXECUTE problem both go away, and
-- the total capability conferred by holding the anon key is exactly this: insert one
-- application row, learn nothing. It returns void on purpose. AGENTS rule 1 says Postgres
-- is the security boundary rather than the application; this keeps it that way, where the
-- HTTP endpoint would have moved the boundary into TypeScript.
--
-- The rate limiting lives in here for the same reason. An in-process limiter in the
-- website container does not survive a restart and does not see a second instance. A count
-- against the table does both.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.application_status as enum (
    'new',
    'reviewing',
    'interview',
    'offered',
    'hired',
    'declined',
    'withdrawn'
  );
exception when duplicate_object then null; end $$;

comment on type public.application_status is
  'declined = the centre said no. withdrawn = the applicant did. Distinct because the second is not a decision the centre made and must not read like one.';

do $$ begin
  create type public.application_source as enum ('website', 'email', 'walk_in', 'referral', 'other');
exception when duplicate_object then null; end $$;

/**
 * Why `source` exists.
 *
 * The audit trigger records `actor_id`, which is `auth.uid()` — null for a submission from
 * the public website, because there is no session. Null actor already meant "a script, or
 * the system", so without this column staff could not tell a website application from one
 * an administrator typed in. And they need to: CVs will keep arriving by email until the
 * attachment path exists, and those get logged here by hand.
 */
create table if not exists public.job_applications (
  id            uuid primary key default gen_random_uuid(),
  centre_id     uuid not null references public.centres(id) on delete cascade,

  applicant_name text not null,
  email          text not null,
  phone          text,

  /**
   * Free text, not an enum.
   *
   * The centre publishes no vacancy list, so any fixed vocabulary here would be a job
   * taxonomy this repo invented and then displayed as though it were theirs. The form
   * offers the wording their own careers page uses and accepts anything.
   */
  position_sought text,

  /**
   * The applicant's own statement, and nothing more.
   *
   * A current practising certificate is the single most useful routing fact for an early
   * childhood service, which is why it is asked. It is not evidence: evidence is a sighted
   * document in `staff_records`, and conflating the two is how a centre ends up believing
   * it has seen a certificate it has not. Null means not stated, which is different from
   * false.
   */
  holds_practising_certificate boolean,

  available_from date,
  /** What they wrote about themselves. There is no CV attachment yet — see below. */
  message        text,

  source         public.application_source not null default 'website',
  status         public.application_status not null default 'new',

  /**
   * Who last moved it, and when.
   *
   * Not `resolved_at`/`resolution` as on `waitlist`, because a hiring process has stages that
   * matter before the outcome — "we interviewed them and chose someone else" and "nobody ever
   * opened it" are both unresolved and are not the same thing.
   *
   * And not `decided_by`/`decided_at`, which is what these were called first. Moving an
   * application to "reviewing" is not a decision, so a column named `decided_by` holding
   * whoever last clicked would need a comment to explain that it does not mean what it says.
   * Renamed before anything read it.
   */
  status_note       text,
  status_changed_by uuid references auth.users(id) on delete set null,
  status_changed_at timestamptz,

  created_at     timestamptz not null default now(),

  -- Length caps on the table, not only in the function that inserts. The function raises a
  -- readable error; this is what actually stops an anonymous caller storing a megabyte.
  constraint job_applications_name_present  check (length(trim(applicant_name)) between 1 and 200),
  constraint job_applications_email_present check (length(trim(email)) between 3 and 320 and position('@' in email) > 1),
  constraint job_applications_phone_len     check (phone is null or length(phone) <= 40),
  constraint job_applications_position_len  check (position_sought is null or length(position_sought) <= 120),
  constraint job_applications_message_len   check (message is null or length(message) <= 4000),
  constraint job_applications_note_len      check (status_note is null or length(status_note) <= 1000),
  -- A status change has a person and a time, or it has neither. Half a record of who moved
  -- something is unreadable a year later, which is when somebody asks.
  constraint job_applications_status_change_complete
    check ((status_changed_at is null) = (status_changed_by is null))
);

-- The list staff actually open: this centre's live applications, newest first.
create index if not exists job_applications_centre_idx
  on public.job_applications (centre_id, created_at desc);

/**
 * Supports the duplicate check inside the submit function, which runs on every public
 * submission and must not table-scan a growing table.
 *
 * Not a unique index. A person who applied two years ago and was declined is entitled to
 * apply again, so uniqueness on (centre, email) would be wrong; the function scopes its
 * check to applications that are still open.
 */
create index if not exists job_applications_centre_email_idx
  on public.job_applications (centre_id, lower(email));

-- ---------------------------------------------------------------------------
-- Policies
-- ---------------------------------------------------------------------------

alter table public.job_applications enable row level security;

/**
 * Owner and manager only, and never an educator.
 *
 * Two reasons, and the second is the one that decided it. An application holds a stranger's
 * personal details, which is reason enough. But it also holds the hiring process: who was
 * declined, who is at interview, what the manager wrote in the note. In a service with
 * fifteen kaiako, some of the applicants are people the team already knows, and one of them
 * may be somebody's replacement. That is not a staffroom document.
 *
 * A single FOR ALL policy, like `waitlist` and for the same reason — the read predicate and
 * the write predicate are identical, so splitting them per 0022 would mean maintaining the
 * same expression twice. 0022's invariant (one permissive SELECT-capable policy per table)
 * still holds: this is the only policy on the table.
 */
drop policy if exists job_applications_all on public.job_applications;
create policy job_applications_all on public.job_applications
  for all
  using      (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]))
  with check (public.caller_has_role(centre_id, array['owner','manager']::public.member_role[]));

revoke all on public.job_applications from anon, authenticated, service_role;
grant select, insert, update, delete on public.job_applications to authenticated, service_role;

/**
 * DELETE is granted, which is the opposite of the decision taken for `waitlist` — and the
 * difference is deliberate rather than an oversight.
 *
 * A waitlist entry keeps no DELETE because "were we ever offered a place" is a question
 * families ask and a deleted enquiry cannot answer it. An unsuccessful applicant is the
 * mirror image: there is no compliance reason for a childcare service to hold the contact
 * details and employment history of somebody it did not employ, and that person has a
 * strong claim to have them removed. The Privacy Act principle at issue is retention, not
 * erasure — a correction recorded in llm-wiki: the Act gives no general right to erasure,
 * so this is the agency choosing not to keep what it no longer needs.
 *
 * A delete here really deletes. The audit trigger records `{action, entity, entity_id}` and
 * NOT the row — see 0021, which stores only the changed column names on update and no
 * payload at all otherwise. So "we removed your application" is a true statement, which it
 * would not be if the audit log kept a copy.
 */
comment on table public.job_applications is
  'Applications for employment. Owner and manager only. Deletable on request, and the audit log keeps no copy of the row.';

comment on column public.job_applications.holds_practising_certificate is
  'The applicant said so. Not evidence — evidence is a sighted document in staff_records.';

-- Consequential state, not append-only, so it carries the audit trigger in the migration
-- that creates it. This is the convention 0021 restated after it was missed three phases
-- running, and the RLS suite derives the requirement rather than reading a list, so
-- omitting it here would fail `test:rls` rather than going unnoticed.
drop trigger if exists job_applications_audit on public.job_applications;
create trigger job_applications_audit
  after insert or update or delete on public.job_applications
  for each row execute function public.audit_trigger();

-- ---------------------------------------------------------------------------
-- The public submission path
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
  /*
   * Validation before anything else, and the same rules the form applies. Duplicated on
   * purpose: the form's copy produces a good error message next to the field, and this copy
   * is the one that holds when the caller is not the form.
   */
  if p_applicant_name is null or length(trim(p_applicant_name)) = 0 then
    raise exception 'A name is required.';
  end if;

  if p_email is null or position('@' in p_email) < 2 or length(trim(p_email)) > 320 then
    raise exception 'A valid email address is required.';
  end if;

  if length(coalesce(p_message, '')) > 4000 then
    raise exception 'Please keep the message under 4000 characters.';
  end if;

  /*
   * The caller sends a slug, never a centre id.
   *
   * A client-supplied uuid on an unauthenticated form is an invitation to write into another
   * tenant, and this function bypasses RLS, so nothing downstream would stop it. Resolving a
   * slug the site holds as a constant means the set of writable centres is the set that
   * exists, and the worst a forged call achieves is filing an application at the wrong one of
   * this centre's two sites.
   */
  select c.id into v_centre from public.centres c where c.slug = p_centre_slug;
  if v_centre is null then
    raise exception 'Unknown centre.';
  end if;

  /*
   * Flood guard. Per centre rather than per email or per IP: an email address is chosen by
   * the sender and this function cannot see an IP.
   *
   * Ten a minute at one small childcare centre is not a recruitment drive, it is a script.
   * The threshold is deliberately loose — a genuine applicant who is refused because a
   * stranger was spamming has been failed by this, so the guard is set to catch automation
   * and not a busy afternoon.
   */
  select count(*) into v_recent
    from public.job_applications
   where centre_id = v_centre
     and created_at > now() - interval '1 minute';

  if v_recent >= 10 then
    raise exception 'Too many applications have been received just now. Please try again in a few minutes.';
  end if;

  /*
   * Idempotent while an application is still open, and it returns quietly rather than
   * raising.
   *
   * Two reasons. A double-clicked submit button must not create two rows for one person, and
   * an error saying "you have already applied" is an oracle: it tells anybody who asks
   * whether a given email address has applied to this centre. Same reasoning as the uniform
   * response on password recovery — the honest-looking error is the leak.
   *
   * Scoped to open applications, so somebody declined last year can apply again.
   */
  if exists (
    select 1 from public.job_applications
     where centre_id = v_centre
       and lower(email) = lower(trim(p_email))
       and status in ('new', 'reviewing', 'interview', 'offered')
  ) then
    return;
  end if;

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
end $$;

comment on function public.submit_job_application(text, text, text, text, text, boolean, date, text) is
  'The only write an unauthenticated caller may perform anywhere in this schema. Returns void '
  'so it discloses nothing, resolves the centre from a slug so a forged call cannot choose a '
  'tenant, and is idempotent while an application is open so it cannot be used to test whether '
  'an address has applied.';

/*
 * Granted to `anon`, which no other function in this schema is.
 *
 * `scripts/security-review.ts` reports any anon-executable definer function, and its message
 * used to read "each returns nothing without a JWT, so this is defence in depth rather than a
 * hole". That sentence is false about this function — it is designed to work without a JWT. The
 * check now carries an allowlist naming this one, so the message stays true and a *new*
 * accidental grant still surfaces. A check whose explanation has quietly stopped applying is
 * worse than no check.
 *
 * `authenticated` too: a parent at the centre applying for a job is an ordinary thing, and
 * they would be holding a session when they do it.
 */
revoke execute on function public.submit_job_application(text, text, text, text, text, boolean, date, text) from public;
grant  execute on function public.submit_job_application(text, text, text, text, text, boolean, date, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- WHAT IS NOT HERE: the CV
--
-- No attachment column, no bucket. A CV is the densest personal-information document in a
-- recruitment process — address, employment history, and referees' names and phone numbers,
-- which are third parties who never agreed to anything. Storing one needs a private bucket,
-- storage policies for an unauthenticated uploader, a retention rule and a line in the
-- privacy statement, and the storage grants are the surface that got the enquiry form's
-- browser-to-database path refused in the first place.
--
-- So CVs keep arriving at career@littlepearls.org.nz for now, and `source = 'email'` exists
-- so those can be logged here by hand and not lost. Recorded as a gap rather than described
-- as done.
-- ---------------------------------------------------------------------------
