# Recruitment — and the first public write path in the schema

Job applications, from the careers page on the public website into the platform, with a screen the
centre's manager acts on. Migration `0024_recruitment.sql`.

The recruitment part is ordinary. The part worth reading is that this is **the only place where
somebody holding nothing but the anon key can write to this database**, and until 0024 the honest
one-line summary of `anon` was "reaches nothing at all". That sentence is now false, so what it can
do instead is written down here and pinned by assertions in `rls_isolation.sql`.

## Why it exists

Their careers page said "email your CV to career@littlepearls.org.nz" and nothing else. That means
every application lives in a shared mailbox: no status, no record of who was replied to, nothing to
answer with when somebody asks why they never heard back, and a deletion request that can only be
honoured by hunting through mail folders.

## The design, and the two that were rejected

**Rejected: an insert policy for `anon`.** Every policy in this schema is `TO public`, so it is
evaluated for `anon` too, and the predicates call `caller_has_role` — whose EXECUTE `0022` revoked
from `PUBLIC`. An anonymous insert therefore fails *inside the policy* with a 42501 that reads like a
missing table grant and is not one. Granting `anon` execute on the boundary predicates to fix that
would trade a careers form for widening the tenant boundary. This is the same trap
[[public-website]] recorded when the enquiry form was refused; it is not specific to that form.

**Rejected: an HTTP endpoint on `apps/web` behind a shared secret**, with the site posting
server-to-server. That was the original plan for the enquiry form. It puts a new unauthenticated
endpoint on the container that holds children's records, and that endpoint holds the service-role
key, which bypasses RLS on every table. The blast radius of a bug in it is "whatever the handler was
written to do", and a later edit widens it silently. It also moves the tenant boundary into
TypeScript, which is the opposite of [AGENTS](../../AGENTS.md) rule 1.

**Built: one `security definer` function, `submit_job_application`, granted to `anon`.** It runs as
the owner, so RLS and the predicate-EXECUTE problem both disappear, and the total capability
conferred by holding the anon key is exactly this: insert one application row, learn nothing.

```
browser ──POST──► apps/site server action ──anon key──► submit_job_application() ──► job_applications
                  honeypot, shared validation          resolves slug, rate limits,
                                                       dedupes, returns void
```

The browser never talks to Supabase. The anon key is read from **unprefixed** env vars —
`SUPABASE_URL`, `SUPABASE_ANON_KEY` — so Next cannot inline it into client JavaScript, which keeps
the site's `connect-src 'self'` literally true. Verified rather than assumed: `.next/static/` was
grepped for the key, the project URL and the string `supabase`, and contains none of them, while
`submit_job_application` appears only in the server chunk.

## Four properties of the function that are not obvious

**It returns void.** An anonymous caller learns nothing about what happened, including whether a row
was created.

**It takes a slug, never a centre id.** A client-supplied uuid on an unauthenticated form is an
invitation to write into another tenant, and this function bypasses RLS so nothing downstream would
stop it. The site holds the two slugs as constants; the worst a hand-made call achieves is filing an
application at the wrong one of this centre's own two sites.

**A repeat submission while an application is open is a quiet no-op, not an error.** Raising "you
have already applied" would answer the question *has this address applied to this centre* for anybody
who asked. That is the same oracle the password-recovery flow exists to avoid, and the honest-looking
error is the leak.

*Corrected 2026-08-07:* this used to end "a unique index would have been the obvious implementation
and would be wrong". Half right. A unique index on `(centre_id, lower(email))` outright would indeed be
wrong, because somebody declined last year is entitled to apply again — but a **partial** one, scoped
to the open statuses, says exactly what is meant and is what makes the check atomic rather than
advisory. `0027` adds it. The `if exists` check stays, because it is what keeps a repeat submission
*silent*: the index alone would raise a 23505 that tells the caller what the index knows.

**The flood guard is in SQL, not in the website process.** An in-process limiter does not survive a
restart and does not see a second instance. Ten submissions a minute at one small centre is
automation, not a busy afternoon. The threshold is deliberately loose: a real applicant refused
because a stranger was running a script has been failed by this.

There is **no minimum-time-to-submit check**, and the reason changed on 2026-08-07 — which is worth
recording, because the original reason was good and is now gone.

It used to be impossible: the check needs a timestamp rendered into the form, the careers page was
statically generated, so every visitor received the build time and the interval would always be days.
The CSP fix made every route on the site render per request, so a real per-visitor timestamp is now
available and that argument no longer applies.

It is still not built, for a weaker reason honestly stated: an unsigned timestamp in a hidden field is
forgeable by anything sophisticated enough to be worth stopping, so it would need an HMAC and a secret
to be worth anything — machinery for a filter that only catches bots which already fell for the
honeypot. The limit that actually holds is the flood guard inside `submit_job_application`, which is in
the database, so it survives a restart and sees every instance.

## What `anon` can and cannot do, as asserted

`anon` still has **no table grant anywhere in `public`** — `review:security` check 8 fails the build
at high severity if that changes, and the isolation suite asserts that a select on
`job_applications` is refused with 42501, before RLS is consulted.

The check that reports anon-executable definer functions used to explain itself with "each returns
nothing without a JWT, so this is defence in depth rather than a hole". **That sentence is false of
this function**, which is designed to work without a JWT. Leaving it would have been worse than
having no check: a reader would be told the one genuinely public function returns nothing. It now
carries an allowlist naming `submit_job_application` with its reason, plus a second finding that
fires if an allowlisted name stops being reachable — because a stale allowlist is how a list stops
being a decision and becomes a comment. Both branches were mutation-tested.

## Who can see an application

Owner and manager. **Not an educator, even at the same centre**, and the second reason is the one
that decided it: an application holds a stranger's personal details, but it also holds the hiring
process — who was declined, who is at interview, what the manager wrote. In a team of fifteen some
applicants are people the team knows, and one may be somebody's replacement. That is not a staffroom
document. `manageRecruitment` is a separate capability from `manageMembers` despite having the same
two roles, because "who has access to this centre" and "who applied for a job here" are not the same
question.

## DELETE is granted here, and is not granted on `waitlist`

Deliberate, and the mirror image of that decision. A waitlist entry keeps no DELETE because "were we
ever offered a place" is a question families ask and a deleted enquiry cannot answer it. An
unsuccessful applicant is the opposite: there is no compliance reason for a childcare service to hold
the contact details and employment history of somebody it did not employ, and that person has a
strong claim to have them removed.

**A delete here really deletes**, and that rests on the audit trigger: `0021` stores the changed
column *names* on update and no payload at all otherwise, so the audit log keeps no copy of the row.
Asserted both ways in `rls_isolation.sql` — that the deletion is recorded, and that no audit row for
it contains the applicant's name or email. Without both halves, "we removed your application" would
be a comforting sentence rather than a true one.

Note what this is **not**: the Privacy Act gives no general right to erasure — a correction already
recorded in this wiki. This is the retention principle, and the centre choosing not to keep what it
no longer needs.

## The self-declared certificate

`holds_practising_certificate` is nullable, and null means *not answered* rather than *no*. Three
states, because a checkbox can carry two and an unticked box would record "does not hold one" for
somebody who skipped the question — the same argument that kept consent three-state when the design
pack asked for switches.

It is the applicant's own statement and **not evidence**. The screen says so in words where it is
displayed, not only in a schema comment: "They say they hold a current one — not yet sighted".
Evidence is a sighted document in `staff_records`, and conflating the two is how a centre ends up
believing it has seen a certificate it has not.

Nothing belonging to a **safety check** is collected: no date of birth, no address, no
criminal-record question. A safety check is required before a children's worker starts; answering any
of it into an unauthenticated public form would be a disclosure made before anybody had decided to
read the application.

## What is not built

**No CV attachment.** A CV holds an address, an employment history and referees' names and phone
numbers — third parties who agreed to nothing. Storing one needs a private bucket, storage policies
admitting an unauthenticated uploader, a retention rule and a line in the privacy statement, and
storage grants for an anonymous uploader are the surface that got the enquiry form's
browser-to-database path refused. CVs keep arriving at the careers mailbox, and `source = 'email'`
exists so those can be logged by hand rather than lost. Gap 12 in `apps/site/CONTENT-GAPS.md`, and
the thing that closes it is a decision from the centre about retention, not code.

**No vacancy list.** Nothing here models a vacancy; the page invites open applications. Gap 13.

**No notification when an application arrives.** The manager finds out by opening the screen. Worth
knowing before somebody assumes an email goes out.

## Two defects this turned up, both only visible against a real database

**PostgREST turns an array insert into one multi-row INSERT over the union of the keys present**, so
a key missing from one object becomes an explicit NULL rather than falling back to the column
default. The e2e fixture omitted `status` on one of two seeded rows and got `null value in column
"status" violates not-null constraint` — which reads like a schema defect and is a client behaviour.

**A concatenated select list silently breaks row typing.** `supabase-js` parses the select string at
the type level; two literals joined with `+` are typed as plain `string`, the parser gives up, and
the call comes back as `GenericStringError[]`. The error surfaces as a cast failure and says nothing
about the cause. Every other module in `packages/api` uses one long line, and now this one knows why.

## Also corrected while doing this

`decided_by` / `decided_at` were renamed to `status_changed_by` / `status_changed_at` before anything
read them. Moving an application to "reviewing" is not a decision, so a column called `decided_by`
holding whoever last clicked would have needed a comment explaining that it does not mean what it
says — which is the smell itself. The migration was dropped and re-applied rather than shipping a
0025 rename, after confirming the table held no rows and nothing depended on it.

The counts in [[security-review]] and the README moved from 17 `SECURITY DEFINER` functions to 18.


## Six defects in this feature, found the day after it shipped

Every gate passed when this was committed, and a flow trace found six things wrong with it. Recorded
here rather than quietly patched, because five of the six are the same shape: **a comment describing a
protection the code did not have.**

**The function validated three fields and the table constrained six.** `submit_job_application`
checked the name is present, the email has an `@`, and the message is under 4000 characters. The table
also caps the name at 200, the email at 320, the phone at 40 and the position at 120 — and the
function checked none of those, so a direct call with a 500-character phone number got a raw
`job_applications_phone_len` violation. The table held, which is the important half. But the function
advertises itself as the layer that turns a constraint into a sentence, and for three of six fields it
produced the constraint. The only caller who hits it is one not using the form — which is exactly the
caller it exists to be safe against. Fixed in `0027`.

**The duplicate check was advisory, not atomic.** `if exists (...) then return; end if;` followed by an
insert is two statements: a double-tapped submit on a slow connection runs both checks before either
inserts, and both insert. The comment said the quiet return exists so "a double-clicked submit button
must not create two rows for one person", and nothing enforced it. `0027` adds a **partial** unique
index on `(centre_id, lower(email))` where the status is open — partial because somebody declined last
year is entitled to apply again, so uniqueness outright would be wrong. The `if exists` check stays: it
is what makes a repeat submission *silent*, where the index alone would raise a 23505 the caller could
read. Verified with ten concurrent submissions for one mailbox: one row, no errors.

**The honeypot announced itself.** The trap returned "Thank you — we have your application and will be
in touch." while a real submission named the centre. Anything comparing two responses could read
straight off the wording which field not to fill in. One success sentence now, for everybody; naming
the centre back was worth something and not this much.

**"Either centre" was two transactions with no compensation.** The loop was wrapped in one try/catch,
so if the first centre succeeded and the second threw, the applicant was told "we could not save that,
please email us" while their application was **already in the database**. They then email as
instructed, and staff hold one record and one email for the same person with no way to know they are
the same event. There is no rollback to write either — a submitted application must not be withdrawn
because a second insert failed. So the outcomes are collected per centre and the truth is reported.

**The two-press delete did not exist until hydration.** The guard lived entirely in a React `onSubmit`,
so with JavaScript off the first press deleted somebody's application outright. The armed state is now
a form field the server checks, so the same two presses happen either way — which is the standard this
app holds itself to elsewhere.

**A note-only save re-attributed the decision.** `changeStatus` stamped `status_changed_by` and
`status_changed_at` on every call, and the stage select posts its unchanged value alongside the note. So
Alice declines an applicant on the 1st, Bob fixes a typo on the 5th, and the row says Bob declined them
on the 5th — with the old values unrecoverable, because the audit trigger keeps column names and no
payload. Exactly the question `0024`'s constraint was written to keep answerable. The actor is now
passed only when the stage actually moved, and **"Last moved" is displayed on the row**: these columns
were written and rendered nowhere, which is how they came to be wrong without anybody noticing.

### And one place the constraint itself was wrong

`job_applications_status_change_complete` required `status_changed_at` and `status_changed_by` to be
both null or both set. `status_changed_by` is `on delete set null` against `auth.users` — the
referential action is an UPDATE, CHECK constraints are enforced on it, so **deleting a staff account
failed** with a 23514 naming a recruitment constraint, which is the last place anybody offboarding
somebody would look. Measured against the live database.

It was also wrong about the domain. `(at set, by null)` is not half a record; it is the honest
description of a move made by somebody whose account has since been removed. The useless state is the
reverse. `0026` makes the invariant one-directional: if we know who, we know when.

## CORRECTION 2026-08-27 — the public careers form was removed

On the owner's instruction: *"sending email is enough"*. `apps/site` no longer renders a form, no
longer imports `@ece/api/recruitment`, and the careers page now points at
`career@littlepearls.org.nz` and nothing else.

**This page's opening claim is now wrong and is left standing above, corrected here rather than
edited away.** It says job applications go "from the careers page on the public website into the
platform". They do not any more. The migration, the policy, the definer function, the manager's
screen and the `rls_isolation.sql` assertions all remain — the write path exists and is still the
only way somebody holding nothing but the anon key can write to this database. What changed is that
**nothing on the public internet uses it today**.

The *Why it exists* section above is worth re-reading as the cost of the decision, not as an
argument against it. Every application is back in a shared mailbox: no status, no record of who was
replied to, nothing to answer with when somebody asks why they never heard back, and a deletion
request that can only be honoured by hunting through mail folders. That was true in 2018, it was the
reason for the form, and it is true again.

Two things follow. If the form ever comes back, the schema is still here and it is a page component,
not a migration. And **the enrolment enquiry form is now the only public write path in use** — if
that also moves to email, `anon` returns to reaching nothing at all, and the honest one-line summary
this page opens with becomes true again.

*Last updated: 2026-08-27 — date taken from this file's last commit, because the page was written without the footer `llm-wiki/schema.md` requires and no other record of it exists.*
