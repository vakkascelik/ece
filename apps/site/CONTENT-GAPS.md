# Content gaps — Little Pearls website

Everything this website would like to say and cannot yet, in one place, in the shape of
[`llm-wiki/wiki/unverified-claims.md`](../../llm-wiki/wiki/unverified-claims.md).

## Why this file exists

Every fact on the site traces to Little Pearls' own website, their philosophy PDF, or
[`docs/tenant-little-pearls.md`](../../docs/tenant-little-pearls.md). Nothing was taken from a
third-party directory, and nothing was written to fill a space.

That discipline is not squeamishness. This is a real service that real families choose between, and
a plausible-looking fee, capacity or ratio is worse than a blank — a parent acts on it. The same
rule already governs the platform: `fee_schedules` ships with no amounts anywhere, and
`RATIO_TABLES_VERIFIED` is `false` so every ratio screen carries a notice saying nobody has checked
the bands against the regulations.

Several of these gaps are **visible on the site**, in a marked block, rather than only tracked
here. A placeholder that lives only in a tracking file is a placeholder that ships.

## Open

### 1. Fees are not published anywhere

Their existing page is titled "Enrolment & Fees" and contains **no fee amount**. The only route to
one is an Issuu-hosted PDF, linked over plain HTTP, whose existence could not be confirmed —
issuu.com did not resolve during research.

Fees are the single most-searched thing on a childcare site, so this is the most valuable gap to
close. **To close it:** the centre supplies the current schedule and confirms it may be published.
Until then `/enrolment` says fees are available on request, in a marked block.

### 2. 20 Hours ECE, WINZ and Best Start

Third-party listings state that both centres offer 20 Hours ECE. **Their own site never says so**,
and neither does anything else we hold. Not stated on the site.

**To close it:** the centre confirms which funding applies at each site.

### 3. Licensed capacity

Directory summaries suggest 65 FTE at Mt Albert including up to 18 under two, and 53 FTE at Mt
Roskill including up to 14 under two. Those were read from **search-result summaries**, because
both Education Counts and ERO returned HTTP 403 to a direct fetch.

Not published. A capacity figure tells a parent whether there is likely to be room, and a wrong one
sends them away or wastes their visit.

### 4. Ministry service numbers

46365 (Mt Albert) and 47407 (Mt Roskill). Two independent government directories agree, and
`docs/tenant-little-pearls.md` already records that both were **read from URL parameters, not from a
rendered Ministry page**. Good enough to seed a database row that nothing depends on; not good
enough to print on a public page.

**To close it:** confirm each against a licence certificate or Ministry correspondence the centre
holds.

### 5. Staff names, roles and photographs

Their "Our Staff" page names nobody, lists no roles and shows no photographs. It is the weakest
page they have — parents choosing who will care for a three-month-old want to see the centre
manager and head teachers.

**To close it:** the centre decides who may be named, and each person agrees. A photograph needs
that person's agreement in writing.

### 6. Two ratio claims that are about a regulatory minimum

Their careers page says the centres run "higher than required ratios" and "more than the minimum
number of staff required by the Ministry of Education". Both are claims **relative to a regulation
this repo has not sourced** — the platform's own ratio bands are unverified for exactly that
reason — so neither is repeated on the site.

The centre's *own* published ratios (1:3–4 infant, 1:6–7 toddler, 1:7–8 preschool) **are** on
`/rooms`, attributed to the centre rather than stated as compliance.

### 7. Mt Roskill's opening time

Their site says 7.30am for both centres. A third-party directory says Mt Roskill opens at 7.00am.
Their own site wins, and the disagreement is recorded rather than averaged.

### 8. Is the on-site chef at both centres?

Their homepage says "**our centre** has a full time on-site chef" — singular, written when there
was one site. The site repeats the food offering without claiming which centres it covers.

### 9. Social accounts, and three plain-HTTP links

Their footer links to Facebook (over `http://`), Twitter (`twitter.com/littlepearls_nz`, predating
X), Instagram and Flickr. **None could be confirmed as active** — Facebook returned only a title
and issuu.com did not resolve.

Not carried over. A footer of dead links is worse than no footer.

### 10. Photographs

Their three homepage photos are hosted on Flickr and show children. **None are used**, and the site
ships with no child photographs at all.

The platform models why: `photo_public` is a **separate consent** from `photo_internal`, because
families who agree to a photo in the private journal routinely refuse one on a public website. A
photograph on this site needs current written consent for public use, per child.

**To close it:** photographs of the building, playground and resources need none of that and would
improve every page. Staff photographs need each person's agreement.

### 11. Whether the old enrolment form still reaches anyone

Their form posts to `scripts/form-u832.php`, an Adobe Muse mailer last modified in 2018. It was not
tested — submitting it would have contacted the centre. If it has been silently failing, there may
be enquiries nobody ever received.

**To close it:** ask the centre when they last received an enquiry through the website.

### 12. The careers form cannot take a CV

Added 2026-08-06 with the form itself, so it is a known gap rather than a discovery.

The form collects contact details, the role wanted, an earliest start date, a self-declared
practising certificate and a free-text message. It does **not** accept an attachment, so the page
asks applicants to email their CV to `career@littlepearls.org.nz` as well — which means one
application arrives in two places and staff reconcile them by hand.

The reason is not effort. A CV holds an address, an employment history and referees' names and phone
numbers, and those referees agreed to nothing. Storing one needs a private bucket, storage policies
that admit an unauthenticated uploader, a retention rule and a line in the privacy statement. The
schema records the shortfall rather than hiding it: `job_applications.source` distinguishes an
application that came through the website from one staff typed in off an email.

**To close it:** decide how long the centre wants to keep an unsuccessful applicant's CV. That
answer is the retention rule, and the rest follows from it.

### 13. There is no vacancy list

The page says "current vacancies are not listed here yet" and invites an application anyway, which
is what their old page did in different words. Nothing in the platform models a vacancy.

**To close it:** ask the centre whether they want to advertise specific roles, or would rather keep
receiving open applications. If it is the former, that is a table this schema does not have.

## Resolved by rebuilding

- **No `<meta name="viewport">` and no responsive layout.** Fixed: the site is fluid and asserted
  at 390px.
- **Four addressable hosts.** Fixed: one canonical host, enforced with a 308.
- **No page description, no Open Graph, homepage `<title>` of "About".** Fixed.
- **No robots.txt; a sitemap with 2018 dates and `http://` URLs.** Fixed, and the sitemap is
  generated from the route list so a page cannot be forgotten.
- **Every `<img alt="">`, including the logo; headings faked with styled `<p>`.** Fixed: real
  heading elements throughout, and no decorative image carries meaning.
- **Philosophy only as a PDF.** Now a page, with macrons restored and its typos fixed.
- **"Our Centres" described rooms, not centres.** Split into `/centres/*` and `/rooms`.
- **Careers was a mailto link, so every application lived in a shared mailbox** with no record of
  who had been replied to. Now a form that creates a record the centre's manager can act on. The CV
  still arrives by email — gap 12.

*Last updated 2026-08-06. Nothing on the site is unsourced; everything above is a question for the
centre.*
