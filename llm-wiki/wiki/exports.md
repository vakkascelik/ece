# Exports — CSV and PDF

Getting data out, for a Ministry return, an accountant, an evacuation, or a centre that wants to
leave.

## Overview

Until 2026-08-09 there was exactly one way to get anything out of this product: a print stylesheet
on `/compliance/binder` and `/funding`, with a sentence telling the reader to choose *Save as PDF*.
No CSV, no download route, no `Content-Disposition` anywhere in the repo. The only route handler
was `api/health`.

That was a deliberate choice for PDF and an omission for everything else. The PDF reasoning still
holds — see below — and the CSV layer is new.

## Key Points

- **A UTF-8 BOM is not optional here.** Without it Excel renders `Tāne` as `TÄne`.
- **A cell beginning `=` is executed by Excel.** Everything in this product is typed by somebody.
- **Numbers are never escaped**, only strings — the first implementation turned every credit into
  text and the test caught it.
- **An export route is a new read path** and re-checks the capability itself. Two exports are
  deliberately *stricter* than the page they sit on.
- **PDF is still the browser's print dialogue**, and now has a button rather than a sentence.

## Details

### The BOM, and why it is a product decision rather than a detail

Excel on Windows reads a CSV with no byte-order mark in the system codepage, not UTF-8. Every
macron becomes mojibake: `Tāne` → `TÄne`, `whānau` → `whÄnau`.

This is a New Zealand early-childhood product whose stated values include a commitment to te reo
Māori, and the first thing a centre does with an export is open it in Excel and send it to
somebody. Three bytes are the difference between a child's name being spelled correctly and not.
Asserted in the e2e against the fixture child, who is called Tāne.

The **filename** strips macrons, and that is the one place in the product they are deliberately
removed: a filename crosses shells, email clients and Windows Explorer, and `Ngā-Tamariki.csv`
survives none of them reliably. The contents keep everything.

### Formula injection, which is real and not theoretical

A cell beginning `=`, `+`, `-`, `@`, a tab or a carriage return is executed as a formula by Excel
and Google Sheets. A child's name, an incident note, a payment reference — all typed by somebody,
and any of them can begin with `=`.

The mitigation is an apostrophe prefix, which **deliberately alters the value**. That is the right
trade against a spreadsheet running whatever a parent typed into an enrolment form, and it is
written down because a reader finding a stray apostrophe will otherwise file it as a bug. The
apostrophe goes *inside* the quotes when the field also needs quoting — outside, the field begins
with a bare apostrophe followed by a quote and the reader loses the row.

**Numbers are exempt, and the first version was not.** `-4500` stringifies to a `-` prefix, so
every credit and every negative variance was being escaped to `'-4500` — text in Excel, in a
column an accountant is about to sum. A value that arrives as a number was computed by the product
rather than typed by a person, so there is nothing to inject. Caught by a test written before the
bug was suspected.

### An export is a read path, not a formatting concern

A route handler is **not** inside the `(app)` layout, so nothing checks a capability for it.
`/billing` refusing an educator while `/billing/export.csv` hands them every family's debts would
be a real hole, and nothing about the CSV layer would hint at it.

Every route calls `requireCapability` itself, and **two are stricter than their own page**:

| Export | Page allows | Export allows | Why |
|---|---|---|---|
| `/children/export.csv` | educator, parent | owner, manager | A parent reads `/children` and sees one child. A *file* leaves the product and sits in a downloads folder |
| `/staff/export.csv` | educator | owner, manager | Everyone rostered may read the roster; a spreadsheet of everybody's hours is a payroll document |

`exports.spec.ts` covers every route against every role, plus signed-out. It uses `page.request`
rather than `page.goto`, because **a download never navigates** — the response carries
`Content-Disposition: attachment`, so `goto` aborts and the URL stays where it was. A download
added to the roles matrix would pass while testing nothing. Mutation-tested by widening the
children export to `viewOwnChildren`; both the educator and parent rows failed.

### What the files deliberately do not contain

No health conditions, no allergies, no custody notes. A spreadsheet of children's medical
information is the most damaging file this product could produce, and *"it would be convenient"* is
not a reason to produce it. The emergency list that genuinely needs allergies is a printed page,
not a CSV.

The staff export's hours column is headed `First in`, `Last out` and `Span (not hours worked)`,
with no total row. It does not subtract breaks, resolve a missing sign-out, or know about a shift
crossing midnight. A column called `Hours` that a payroll clerk pastes into a pay run is the most
expensive wrong number available here.

The funding export carries its disclaimer **in the rows**: an `Unresolved days` column naming the
dates. A CSV emailed to an accountant loses every banner it came with, so a file with gaps cannot
be read as a complete claim without noticing.

### PDF is still the print dialogue

Unchanged, and the reasoning from Phase 3 still holds: every browser prints to PDF, it costs no
dependency and no headless Chrome in the deployment, and `puppeteer` would add ~300 MB to a
container to re-render HTML the browser already has. What it gives up is server-side generation —
nobody can email this on a schedule.

What changed is the affordance. *"Use your browser's print dialogue"* is an instruction, and an
instruction only helps somebody who already knows they want it. `PageActions` calls
`window.print()`, and the sentence stays underneath because the dialogue still has a destination to
choose.

The CSV beside it is an ordinary `<a>`, not a fetch-and-blob: it middle-clicks, bookmarks, and
works on the connection where JavaScript has not arrived. `download` is deliberately absent so the
attribute cannot override the server's filename and drop the centre's name from it.

## See Also

- [[funding-and-billing]] — the figures the money exports carry
- [[compliance-and-evidence]] — the binder, and what a print stylesheet gives up
- [[tenancy-and-rls]] — the boundary underneath every one of these routes

*Last updated: 2026-08-09*
