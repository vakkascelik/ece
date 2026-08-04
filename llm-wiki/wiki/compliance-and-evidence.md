# Compliance and evidence

Staff records with expiry, criteria that ship empty, and a binder that never claims
compliance.

## Overview

Phase 3's value to a manager is a single dated document to hand a reviewer. Most of what goes
in it is paperwork the centre already had; the machinery here is about knowing what covers
what, and what has lapsed.

The one piece of evidence this product *generates* is ratio history — Phase 2's attendance
and adult counts replay into a record, so "we maintained ratios" becomes answerable from data
a centre produced by signing children in. That is the whole argument for having built
attendance before compliance.

The most consequential decision in the phase was what **not** to build.

## Key Points

- **No licensing criteria are seeded, deliberately.** They run to several dozen numbered
  items, were renumbered in 2026, and are not in this repo.
- **The empty state says so loudly.** A gap list with no rows reads as a clean bill of health.
- **No validity periods live in the schema.** Each record carries the expiry printed on the
  document.
- **Warning lead times differ by kind because *renewal* takes different amounts of time**, not
  because certificates last different amounts of time.
- **Sighting is a separate axis from expiry.** "We have a certificate number" and "somebody
  looked at the original" are different claims.
- **An educator can read their own vetting result and nobody else's** — IPP 6.
- The binder is a **print stylesheet**, and it never says "compliant".

## Details

### Why criteria ship empty

Inventing plausible criterion numbers would let a centre assemble an evidence binder against
a list that looks official and is not — a worse outcome than an empty feature, because the
binder would be used.

So `0012_compliance.sql` builds the machinery and seeds nothing.
`npm run import:criteria -- criteria.json --make-current` loads a set from a file that must
carry a `source`; the importer refuses without one, since a set with no provenance cannot be
relied on in a binder.

Each entry can carry `supersedesCode` — the old-to-new mapping. The product plan called that
mapping the actual moat and it is: a centre with three years of evidence filed under the
previous numbering needs it to stay findable. `evidence.criterion_id` is
`on delete set null` for the same reason — evidence outlives a criteria set being replaced,
and losing a document because the numbering changed would be the opposite of the point.

Sets are versioned with one current per service type, enforced by a partial unique index
rather than a boolean nobody maintains.

This is the same reasoning as `RATIO_TABLES_VERIFIED`, applied more strictly, because there
is no defensible approximation of a criterion number. See [[unverified-claims]].

### Staff records: expiry and sighting are two axes

No `first_aid lasts 2 years` anywhere. Validity depends on the issuer, the course and the
year, and hard-coding a duration would silently overwrite what the certificate says. The
centre types what is on the paper.

What *is* configured is `WARNING_DAYS` — 120 for police vetting and safety checks, 90 for
practising certificates, 45 for first aid. Police vetting goes to NZ Police and takes weeks,
so a 30-day warning arrives too late to act on; a first aid course can be booked in a
fortnight. These are judgements, not sources.

**Sighted-by is not decoration.** A centre is expected to have seen the actual certificate
rather than a claim that one exists. A current-but-unsighted record shows two flags and sorts
with the problems. `sighted_by` and `sighted_at` are a pair or neither — a timestamp with
nobody attached is not evidence — and sighting cannot be attributed to somebody else.

`person_name` is required and `user_id` is optional, which is the opposite of the rest of the
schema. Relievers exist: a centre holds a vetting result for somebody who covers two days a
term and has no app account.

### Sorted by exposure, not by date

An expired police vetting outranks a first aid certificate lapsing next week, even though the
date is further away. Unsighted records rank with the expired ones.

"Due soon" is a to-do list, not a gap, so `summarise().clean` ignores it — a dashboard that
is never green is a dashboard nobody reads.

### An educator reads their own record

Not a convenience. A police vetting result is personal information about the person it
concerns, and the Privacy Act gives them a right of access to it (IPP 6). A policy that hid it
from them would put the product in the way of a statutory right. They cannot edit it, which
is a different question. Asserted in the suite.

Evidence, by contrast, is owner/manager only — an educator does not assemble the binder, and
some of what goes in it is not theirs to read.

### Rejected: a PDF library

The plan said "one dated PDF". Every browser prints to PDF, so a print stylesheet produces
exactly that at the cost of no dependency, no headless Chrome in the deployment, no font
bundling and no second rendering path that drifts from the screen. `puppeteer` would add a
few hundred megabytes to re-render HTML the browser already has.

What it gives up is server-side generation — nobody can email this on a schedule. When that
is wanted, this page is the thing to render, and the layout will already be right.

### The binder does not say "compliant"

It opens by stating what it is derived from and what it cannot show:

- ratio history comes from sign-in events, so a child who was present but never signed in
  does not appear — "no breach recorded" is not a guarantee ratios were kept;
- adult counts are figures entered by staff, not derived from individual staff sign-in;
- where a certificate is listed as sighted, a named person recorded that they saw it.

A binder is read by somebody deciding whether to believe the centre. A document that
overstates its own evidence is worse than one honest about the gaps, because the gaps are
what a reviewer finds anyway.

### Rejected: file uploads for evidence

`evidence.location` is a *place* — a filing cabinet, a shared drive, a URL. A centre's
evidence mostly already exists, and the useful first step is knowing what covers which
criterion rather than re-uploading three years of paper. Attaching real files needs the
consent-gated media pipeline that does not exist until Phase 4.

### No DELETE on staff records or evidence

A lapsed certificate quietly removed is indistinguishable from one that never existed, and
"we held a current first aid certificate in March" is what a review asks. Archived, not
deleted.

## See Also

- [[attendance-and-ratios]] — where ratio history comes from
- [[unverified-claims]] — the criteria gap and the retention period
- [[privacy-and-retention]]
- [[tenancy-and-rls]]

*Last updated: 2026-08-04*
