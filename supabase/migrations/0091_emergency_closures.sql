-- ---------------------------------------------------------------------------
-- 0091 — an approved emergency closure is FUNDABLE, and 0088 could not say which
--
-- Closes `unverified-claims` item 60, opened the same day 0088 shipped.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT §7-5 SAYS, READ 2026-09-04
--
-- education.govt.nz/education-professionals/early-learning/funding-and-financials/
--   chapter-7-special-circumstances/7-5-emergency-closure
--
-- *"An emergency closure occurs when circumstances beyond the control of individual services
-- cause temporary closures. Closures are normally for 1 or 2 days only."*
--
-- QUALIFYING: *"extreme weather conditions"*, *"interruptions to essential services"*,
-- *"non-controllable health and safety issues"*, *"civil defence emergencies"*.
--
-- NOT QUALIFYING: *"lack of staff (except when this is due to a non-controllable health and
-- safety issue)"*, *"person responsible is absent"*, *"funerals in the community"*,
-- *"A&P show"*.
--
-- AND THE PART THAT MAKES THIS A FUNDING TABLE RATHER THAN A CALENDAR: with approval,
-- *"Funding may be claimed for the hours that children have a permanent enrolment subject to
-- the funding maximums of the ECE Subsidy and 20 Hours ECE"*, using *"actual booked hours for
-- the day(s) of emergency closure"*.
--
-- So a closed day is not uniformly unclaimable. A term break and a snow day are both closed
-- days and only one of them is fundable, and 0088 shipped with no way to tell them apart: it
-- carries an unresolvable `LookupCode` and a free-text note, neither of which the funded-hours
-- path could branch on. That question has to be answerable before §6-6 or RS7 read the table.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- APPROVAL IS THREE-STATE, NOT A BOOLEAN, AND §7-5's OWN WORDING IS WHY
--
-- *"Contact ERO at the first available opportunity"* … *"ERO will provide a letter to confirm
-- approval/not approval"*.
--
-- **"Not approval" is an outcome the letter carries.** A boolean cannot hold three answers —
-- asked and approved, asked and declined, not asked yet — and the difference between the last
-- two is the difference between a service that followed the process and one that did not.
-- Collapsing "declined" into "false" would also make a declined closure indistinguishable
-- from an ordinary term break, which is the distinction this migration exists to draw.
--
-- The same three-state shape as every other not-stated field in this schema, for the same
-- reason: an absent answer is not a negative one.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- NO REASON CODE LIST, AGAIN, AND THE QUALIFYING CATEGORIES ARE NOT ONE
--
-- It is tempting to turn §7-5's four qualifying circumstances into an enum. Rejected:
--
--   - They are prose in a Handbook section, not a published code list. The ELI schema's
--     `ClosureReasonCode` is the code list, it is unenumerated, and `code_sets` reserves a
--     `closure_reason` domain that ships EMPTY. Inventing four values here would put a
--     locally-invented vocabulary on the same row as the field meant to hold the Ministry's,
--     which is the AGENTS.md §7 mistake with an extra trap: somebody would later serialise it.
--   - The list is not exhaustive in the way an enum implies. *"Non-controllable health and
--     safety issues"* is a category, not a value.
--
-- So the qualifying circumstance stays in `reason_note`, free text, and what this migration
-- adds is the FUNDING claim — which is what the arithmetic needs and what an auditor asks
-- about. The `0088` comment on `reason_code` still applies unchanged.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHY `claimed_as_emergency` IS SEPARATE FROM THE APPROVAL STATE
--
-- Two facts, not one. A service may record a closure as an emergency closure it intends to
-- claim before ERO has answered — §7-5 says to contact ERO *"at the first available
-- opportunity"*, which is after the doors are already shut. So the claim and the answer arrive
-- at different times, and a single column would force the service to either wait or guess.
--
-- The CHECK below is the one relationship between them that must hold: an approval state can
-- only exist on a closure actually being claimed as an emergency. An ERO letter about a term
-- break is not a thing.
--
-- WHAT THIS MIGRATION DOES NOT DO: it does not make those days claimable anywhere. Nothing
-- computes funded hours from closures yet — that is 2F. This makes the question answerable,
-- and item 60 closes on the schema while the arithmetic stays with the absence rules.
-- ---------------------------------------------------------------------------

alter table public.service_closures
  add column if not exists claimed_as_emergency boolean not null default false;

alter table public.service_closures
  add column if not exists ero_approval text;

-- The date on ERO's letter, not the date it was requested: §7-5's dated artefact is the reply.
alter table public.service_closures
  add column if not exists ero_letter_dated_on date;

alter table public.service_closures
  drop constraint if exists service_closures_ero_approval_known;
alter table public.service_closures
  add constraint service_closures_ero_approval_known
  check (ero_approval is null or ero_approval in ('requested', 'approved', 'declined'));

-- An ERO letter about a term break is not a thing.
alter table public.service_closures
  drop constraint if exists service_closures_approval_needs_a_claim;
alter table public.service_closures
  add constraint service_closures_approval_needs_a_claim
  check (claimed_as_emergency or (ero_approval is null and ero_letter_dated_on is null));

/*
  A letter date only where a letter arrived.

  `requested` means ERO has been contacted and nothing has come back, so there is no letter to
  date. `approved` and `declined` are both letters — the section says ERO confirms
  *"approval/not approval"* — so both may carry one. Not REQUIRED to, because a service
  recording the outcome of a phone call before the letter lands is telling the truth about what
  it knows, and refusing that would push somebody into inventing a date.
*/
alter table public.service_closures
  drop constraint if exists service_closures_letter_date_needs_a_letter;
alter table public.service_closures
  add constraint service_closures_letter_date_needs_a_letter
  check (ero_letter_dated_on is null or ero_approval in ('approved', 'declined'));

comment on column public.service_closures.claimed_as_emergency is
  'Whether the service is claiming this closure as an emergency closure under Funding Handbook 7-5. Separate from the approval state because the two arrive at different times: 7-5 says to contact ERO at the first available opportunity, which is after the doors are already shut. Default false, so every closure recorded before 0091 is an ordinary closure - which is the safe direction, because it under-claims rather than over-claims.';

comment on column public.service_closures.ero_approval is
  'requested, approved or declined - and NULL means nobody has contacted ERO. Three-state rather than a boolean because 7-5 says ERO provides a letter confirming "approval/not approval": declined is a real outcome, and collapsing it into false would make a declined emergency closure indistinguishable from a term break. Only permitted on a closure claimed as an emergency.';

comment on column public.service_closures.ero_letter_dated_on is
  'The date on EROs letter. Only where the answer is approved or declined, since a request has no letter yet - and not required even then, because a service recording the outcome of a phone call before the letter arrives is telling the truth about what it knows.';

/*
  NO NEW GRANT AND NO NEW POLICY, CHECKED RATHER THAN ASSUMED.

  `service_closures` was granted table-wide to `authenticated` and `service_role` by 0088, and
  it is not column-scoped — only `centres` is in this schema (0047/0048, 0083). So new columns
  are readable and writable the moment they exist, and the four verb-split policies from 0088
  already cover them: select by centre membership, write by owner-or-manager.

  Worth stating because the reflex after 0047/0048 and 0066/0082 is to add a grant line, and a
  grant line here would be misleading — it would imply this table is column-scoped and send the
  next reader looking for the rest of a list that does not exist. 0084 and 0086 both recorded
  the same check for the same reason.

  The audit trigger from 0088 covers the new columns too: `audit_trigger()` records which
  column names changed, whatever they are, and `service_closures` carries `centre_id` so
  attribution needs no branch — unlike 0089, which needed 0090.
*/
