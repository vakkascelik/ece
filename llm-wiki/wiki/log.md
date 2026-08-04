# Change log

*Append-only record of all wiki changes. Correcting an earlier entry means a new entry that
says so.*

---

2026-08-04 — Wiki initialised, following the pattern in `salix/llm-wiki`. Eight pages written
from the four sessions that built Phases 0–3, rather than from a fresh read of the source:
[[tenancy-and-rls]], [[attendance-and-ratios]], [[offline-outbox]],
[[compliance-and-evidence]], [[invitations]], [[privacy-and-retention]], [[conventions]] and
[[unverified-claims]]. Deliberately **not** a second copy of the root `README.md` — that holds
how to run it and the decisions a contributor needs before touching code; these pages hold why
decisions were made, what was tried and rejected, and what is asserted without a source. Two
additions to the salix page template, both earned by this domain: rejected alternatives are
part of a page rather than a footnote, since most of the expensive knowledge here is "the
obvious thing was tried and here is how it failed"; and any claim about a regulation, duration
or threshold carries its source inline or does not go on a topic page at all.

2026-08-04 — No `wiki.py` copied, and the reason recorded in the README. The salix script's
pages are edited by hand rather than produced by `ingest`, so shipping the CLI here would imply
the pages are generated and can be regenerated. It also needs pip, a requirements file and an
API key to do a job an agent with file access already does directly. Noted where to copy it
from if a scripted ingest is ever wanted, including that its `wiki/*.md` glob is non-recursive
and cannot see subfolders.

2026-08-04 — [[unverified-claims]] created as the entry point of the whole wiki, and linked
first from the index. Seven items: the ratio bands (highest priority — `RATIO_TABLES_VERIFIED`
is false and both the web banner and the mobile bar say so); the absent licensing criteria;
the seven-year retention default; the missing device drill; the per-kind warning lead times;
the regulatory timing claims inherited from the salix product plan and never re-checked here;
and the fact that Phase 1 built enrolment on one customer's word after the plan's Stage 0 —
ten conversations, zero code — was skipped. The pattern to keep: if a claim cannot be sourced,
make the *product* say so in a machine-readable flag, and put it on that page. Two of the
seven already work that way.

2026-08-04 — Recorded in [[privacy-and-retention]] a correction to a claim this repo made
earlier: the Privacy Act 2020 does **not** give a right to request deletion. It gives access
(IPP 6) and correction (IPP 7); there is no general right to erasure in New Zealand law, which
is GDPR Article 17. What it imposes is IPP 9, a retention limit on the agency — an obligation
discharged by following a schedule, not an endpoint an individual triggers. The design follows
from that: a scheduled sweep is the mechanism and ad-hoc purging is the restricted exception.
Also noted that IPP 6 is the reason an educator can read their own police vetting result, which
reads like a convenience and is a statutory right.

2026-08-04 — [[conventions]] collects the traps that have already cost time: `current_date`
under a UTC session being yesterday for the whole New Zealand morning (which rejected a baby
born that morning as born in the future); PostgREST bulk inserts sending explicit `NULL`
instead of taking column defaults; the 1000-row cap on an unbounded select; `upsert` without
`ignoreDuplicates` needing `UPDATE` privilege and therefore failing `42501` before any `CHECK`
runs, which made one test pass for the wrong reason; and `create or replace view` refusing to
change a column list, which made the migrations un-replayable until both offending views were
switched to drop-then-create.

2026-08-04 — Added [[consent-gated-media]] for Phase 4. The page exists mostly to record one bug
and one rule. The bug: the consent check was written inside the permissive `media_select` policy
while `media_write` was declared `FOR ALL` — and `FOR ALL` covers SELECT, and permissive policies
are OR-ed, so staff matched the write policy and the consent condition never had to be satisfied. It
hid correctly from whānau and not at all from educators, which is why it survived a first review: the
retroactive half looked like it worked for the caller most likely to be tested. The rule that came
out of it: a condition that must hold for *every* reader belongs in a **restrictive** policy, which
is AND-ed with all of them and cannot be routed around by adding another; a condition about *which*
readers belongs in a permissive one. Every other `FOR ALL` policy in the schema was re-read
afterwards and all are narrower than their matching select policy, so `media` was the only case with
the dangerous shape.

2026-08-04 — Recorded in [[unverified-claims]] that push notification delivery has never run once.
The model, the preferences and the quiet-hours arithmetic are built and tested — including a window
that wraps midnight, evaluated in the centre timezone across both sides of the daylight-saving switch
— but no notification has ever reached a device, and there is no worker reading the queue. Listed
alongside the airplane-mode drill for the same reason: a thing that looks finished and has never
executed is worth naming rather than discovering.

*Log last updated: 2026-08-04*
