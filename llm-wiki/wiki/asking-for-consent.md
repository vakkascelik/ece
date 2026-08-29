# Asking for consent

The mechanism to record a decision existed from the first week. Nothing ever asked, and
"never asked" and "asked, and waiting" were the same fact.

## Overview

Photographs are fine when a family has agreed to them — that was never in doubt, and
[[consent-gated-media]] enforces it. What was missing was the collection: a parent could
record their own consent since 0004, and no screen in the product ever put the question to
them. Migration **0073** adds `consent_requests` and `request_consent`, plus a prompt on the
parent's own landing page.

The two halves are deliberately independent. The parent is asked **every time they open the
app**, computed on read, whether or not anybody at the centre pressed anything. The button is
the active nudge and the record that the centre did its part.

## Key Points

- **Nothing about the consent mechanism changed.** `recordConsent` already listed `parent`;
  `consent_insert` already allowed `given_by in (select caller_guardian_ids())`; the grant was
  already there; `ConsentPanel` already had a parent branch. 0073 adds only the asking.
- **The third state.** `consentFor` distinguishes answered from never-asked and its comment is
  emphatic about why. That stops one level too early: *asked and unanswered* is a different
  fact again, and a reviewer asking "have you sought photo consent" got identical silence from
  a centre that had asked three times and one that had never opened the page.
- **The ask is recorded per (child, guardian, kind)**, because `consent_insert` scopes a
  parent to their own decision. Per child, "have we asked?" would read as yes when only one of
  two guardians had been.
- **Append-only, no UPDATE or DELETE grant for anybody** including `service_role`. "We asked on
  the 4th" is only worth saying if nobody could have written it on the 20th.
- **A kind that already has an answer is never asked for.** Re-asking a granted consent is
  noise; re-asking a refused one is pressure, and a product should not automate that.
- **One notification per guardian, never one per kind.**
- **A guardian with no login still gets a request row**, and no notification.
- **The parent prompt is computed, never materialised.** No scheduler, the [[checklists]]
  argument.

## Details

### The decision this did not reverse

The child record's header carries `showConsentGap={!isParent}`, and the comment beside it is
the thing to read before changing any of this:

> Not shown to a parent. An unanswered consent is a job for the office to chase; a family
> reading "2 consent unanswered" about their own child **on a screen with no control to answer
> it** has been told off by a database.

The condition is the last clause. The rule is not "keep this from parents", it is "do not
report a problem to somebody who cannot act on it", and it is **satisfied** here rather than
overturned: the home page names the actual questions in the family's own words and links to
the control that answers them. The staff shorthand — a count of gaps against an enrolment
checklist — stays where it was and stays away from parents, because it is a note about the
centre's paperwork rather than a question for the family.

### Two lists that look like one

`missingConsents` counts every required kind with no answer. `unaskedConsents` counts those
nobody has even been asked for. The first is "is this enrolment finished"; the second is "what
can the office fix without waiting on anybody", and the roll now shows both — *3 consent
unanswered · asked* is a centre waiting, *· not asked* is a centre that has not started, and
before 0073 those rendered identically.

A third helper was written and deleted. `awaitingAnswer(consents, requests)` returns exactly
`missingConsents(consents)`, because a kind is unanswered whether or not anybody was asked. A
second name for one list is how two screens end up disagreeing about a number.

### Whose answer counts, when there are two guardians

`current_consents` is `distinct on (child_id, kind) order by at desc` — **the latest event
wins regardless of which guardian recorded it**. So one parent's decision is the child's
decision, and the other is not asked again for it.

That is worth knowing rather than defending; it is a real property with a real edge (two
guardians who disagree resolve to whoever answered last) and it predates this work. Asking per
guardian instead would put both parents through every question twice and contradict what the
centre's own screens report, so the prompt follows the view.

### `SECURITY DEFINER`, and the check that is load-bearing because of it

`notifications` is `grant select` only for `authenticated` — writing into somebody else's
inbox is not something a session may do directly. So `request_consent` is a definer function,
which means it bypasses the policy that would otherwise decide who may call it, which means
its internal `caller_is_staff_for_child` check is **the only thing** between `authenticated`
and an arbitrary notification to another family. The RLS suite asserts a parent is refused,
and that assertion is the one to keep if any are dropped.

Same shape as `notify_absence` (0063) and `broadcast_emergency` (0057). EXECUTE revoked from
PUBLIC explicitly, the omission 0031 and 0072 both made.

### The bug the transaction found

The first version identified the rows it had just written with
`requested_at >= now() - interval '1 second'`. `now()` is the **transaction** timestamp, so
inside one transaction every row that child had ever been asked for matches the window. In
production each call is its own transaction and it would have behaved; the RLS suite runs the
whole file in one, and a second ask would have re-notified the first ask's rows.

Replaced with a data-modifying CTE whose `returning` clause carries the guardians out —
exact, and with no window to be wrong about. *Find the rows I just wrote by timestamp* is a
tempting shape that is almost never right.

### Two assertions that failed for reasons worth keeping

**The cross product read 2 instead of 4.** Ana's `photo_internal` is granted and then withdrawn
earlier in the suite, and a withdrawal is an answer — so the function correctly skipped it. The
premise of the assertion was wrong, not the code. The kinds are now chosen deliberately and the
reason is written beside them.

**The notification count read 0.** It was asserted as the *owner*, and `notifications_own`
scopes an inbox to its owner, so it counted nothing and read as "never sent". Now asserted as
the recipient, which also proves the part that matters: it reached somebody who can open it.

### Mobile was ahead, then behind, for half a day

Worth recording because it is the ordinary cost of a change that lands on one surface.

`TamarikiScreen` has shown consent gaps **to parents** since it was built — *"here a gap is exactly
what the parent can act on"* — while the web child record deliberately hid them. So on the question
of telling families, mobile was already right and web was the one that changed.

But `ChildScreen` printed **"Not asked yet"** for anything unanswered, and the moment 0073 let the
centre record an ask, that became a sentence the product could not stand behind: a family reading it
about their own child might have been asked three times. Fixed the same day by having both apps read
`consentProgress` from core, which is the point of the helper living there — two renderings of the
same three states cannot drift into disagreeing about whether anybody was asked.

[[mobile-app]] calls a parent tapping "yes" on their phone the most obviously useful thing the app
does, so this is the screen the wording is actually read on.

## Rejected

- **A scheduler or chase ledger.** 0065 built one for attendance verification because a
  statutory deadline made the send decision automatic. A consent decision has no deadline, and
  a family that has not answered is a conversation rather than a queue.
- **Asking selectively, kind by kind.** The function drops answered kinds anyway, so a
  parameter for it would look like it did something and would not.
- **Importing consent decisions from another system.** See
  [`docs/importing-infocare.md`](../../docs/importing-infocare.md) §2 — an imported consent row
  asserts a named parent agreed to something, with `given_by` pointing at a guardian row the
  same import created ninety seconds earlier. That is manufacturing evidence, not migrating it.

## See Also

- [[consent-gated-media]] — what a recorded decision then enforces, and the restrictive policy
- [[parent-self-service]] — the other writes a family may make, and why each is safe
- [[tenancy-and-rls]] — `caller_may_see_child`, the predicate the read policy uses
- [[checklists]] — the "computed, not materialised" argument this reuses

*Last updated: 2026-08-29*
