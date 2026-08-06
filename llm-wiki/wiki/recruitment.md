# Recruitment — and the first public write path in the schema

Job applications, from the careers page on the public website into the platform, with a screen the
centre's manager acts on. Migration `0024_recruitment.sql`.

The recruitment part is ordinary. The part worth reading is that this is **the only place where
somebody holding nothing but the anon key can write to this database**, and until 0024 the honest
one-line summary of `anon` was "reaches nothing at all". That sentence is now false, so what it can
do instead is written down here and pinned by twenty-two assertions in `rls_isolation.sql`.

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
error is the leak. Scoped to open statuses, so somebody declined last year can apply again — which is
asserted, because a unique index would have been the obvious implementation and would be wrong.

**The flood guard is in SQL, not in the website process.** An in-process limiter does not survive a
restart and does not see a second instance. Ten submissions a minute at one small centre is
automation, not a busy afternoon. The threshold is deliberately loose: a real applicant refused
because a stranger was running a script has been failed by this.

There is **no minimum-time-to-submit check**, and that is a decision rather than an omission. It
needs a timestamp rendered into the form, and the careers page is statically generated — every
visitor would receive the build time, so the interval would always be days and the check would pass
everything. A timestamp set by client JavaScript is both forgeable and breaks the form without JS.

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
