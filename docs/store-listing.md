# Store submission

Everything a submission needs, written down before there is an account to submit with.
**Nothing here has been submitted.** As at 2026-08-12 an Android production AAB exists — the first
build ever produced from this repo — and it has been submitted nowhere and installed on nothing.

Two of these sections are declarations about children's personal information under oath,
more or less — Google's Data Safety form and Apple's privacy questionnaire. Both are easy
to fill in carelessly and both are enforceable. They are drafted here, from the schema,
rather than typed into a web form at midnight.

## What is blocked, and on what

| Blocked | On |
|---|---|
| ~~Any build at all~~ | Done 2026-08-12: project `@vakkascelik/ece`, production AAB built on EAS |
| iOS build | Apple Developer Program, US$99/year |
| Android build | Play Console, US$25 once |
| Airplane-mode drill | A development build on a device |
| Push delivery | A build (Expo push tokens only come from one) **and** a worker that reads the queue |
| Store listing | Icon, splash, screenshots, and a published privacy policy URL |

The privacy policy URL is the one people forget: **both stores require a publicly
reachable URL**, and [privacy-statement](privacy-statement.md) is a file in a repository.
It has to be hosted somewhere before either submission can be completed.

## The build configuration, and why it holds no comments

`eas.json` is plain JSON with no `"//"` keys, which is the opposite of every other config in this
repo. That is not a lapse: **EAS validates its schema strictly and rejects them.** The file carried
comment arrays in this repo's house style from the day it was written, and `eas init` refused before
doing anything —

```
eas.json is not valid.
- "build.production.//" is not allowed
- "//" is not allowed
```

Railway ignores unknown keys, which is where the habit came from and why nothing caught it: the file
had never been executed, so its invalidity was invisible. It was described in the wiki as
"configuration and not progress"; it was in fact configuration nothing could read. The reasoning it
used to carry lives here instead.

**The profiles.** `development` is a dev client for internal distribution — the one that unblocks the
airplane-mode drill. `preview` is internal distribution for the pilot centre, APK rather than AAB on
Android so a tablet can sideload without Play. `production` is store submission with
`autoIncrement`, because a rejected build number is the most tedious way to fail a submission.

**Every profile carries `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and their
absence is a crash rather than a degraded app.** `lib/supabase.ts` calls `required()` at module load
and throws on a missing value, so a build without them ships an app that dies on launch, for every
user, before a screen renders. EAS builds on Expo's servers and never sees the gitignored
`.env.local`, so the original `production` profile — which had no `env` block at all — was exactly
that build.

They are committed rather than held as EAS secrets, and only because of what these two values are:
Expo inlines every `EXPO_PUBLIC_*` into the binary, so both are readable by anyone who downloads the
app and unzips it, and both are already in the web client bundle served to every browser. A secret
store would imply a secrecy neither has. The service-role key is a different thing and must never
appear in that file.

**Still declared and still inert:** both profiles name an update `channel` while `expo-updates` is
not installed, so EAS warns on every build. Either install it and run `eas update:configure`, or
drop the channels. Leaving it is choosing a warning on every build forever.

## The signing key now exists, and it is not on this machine

The first Android build generated an **upload keystore in the cloud**, because no `keytool` was
available locally. Expo holds it. That key is the identity Google Play uses to accept an update to
this app: lose it without Play App Signing enrolled and the listing cannot be updated, only replaced
under a new package name.

Back it up before the first submission — `eas credentials` exports it — and store it somewhere that
is not the same account as the thing it protects.

## Listing copy

**Name:** ECE — the working title. Not final, and a two-letter-plus-abbreviation name is
hard to find in a store search.

**Subtitle (iOS, 30 characters):** `Sign-in, ratios, whānau`

**Short description (Android, 80 characters):**

> Roll, live ratios and whānau updates for New Zealand early learning services.

**Full description:**

> Built for New Zealand early childhood services.
>
> **Sign children in and out, even with no signal.** Sign-ins are saved on the device and
> sent when the connection comes back. Nothing is lost and nothing is entered twice.
>
> **See the ratio as it changes.** The adult-to-child ratio is on screen the whole time,
> not buried in a report — and it warns you as you approach the limit rather than after
> you have passed it.
>
> **Allergies where you will see them.** A child with an anaphylaxis plan is flagged on
> their card, on the roll, and at sign-in.
>
> **Share the day with whānau.** Pānui, learning moments and photos — and a photo of a
> child without consent cannot be posted, because the system refuses it rather than
> relying on somebody remembering.
>
> One app for every service you work at. Records at one centre are never visible from
> another.
>
> ECE does not submit funding returns. It prepares the figures for you to enter, because
> submitting requires an integration the Ministry does not currently offer.

That last paragraph goes in the store listing deliberately. A manager who buys expecting
RS7 submission and discovers otherwise is a refund and a bad review, and it is far better
to lose the install than to mislead the sale.

**Category:** Education. **Not** Kids — the Kids category brings the strictest rules on
both stores and this app is used by *adults* to record information about children.

**Keywords (iOS):** `childcare, ratios, attendance, ECE, kindergarten, roll, whānau,
early learning, New Zealand`

## Play Data Safety declaration

Google requires this per data type: collected, shared, whether processing is optional,
whether it is encrypted in transit, and whether users can request deletion.

| Data type | Collected | Shared | Purpose |
|---|---|---|---|
| Name | Yes | No | App functionality — the person and the children they care for |
| Email address | Yes | No | Account management |
| Phone number | Yes | No | App functionality — whānau contact details |
| Address | Yes | No | App functionality — whānau contact details |
| Health information | **Yes** | No | App functionality — allergies, conditions, medication authorities |
| Photos and videos | Yes | No | App functionality — the learning journal, consent-gated |
| Messages | Yes | No | App functionality — kaiako ↔ whānau threads |
| Other personal info | Yes | No | Date of birth, ethnicity, iwi, first language, NSN — required for Ministry funding |
| Device identifiers | Yes | No | A push token, only if notifications are turned on |
| Crash logs | Yes | **Yes** | Diagnostics, to Sentry — scrubbed of personal information before it leaves |
| Location | **No** | — | Not collected. Sign-in records a time, not a place |
| Financial info | **No** | — | No payment processing |
| Contacts | **No** | — | No access to the device's contacts |
| App activity / analytics | **No** | — | No analytics of any kind, first or third party |

**Encrypted in transit:** yes, everything, HTTPS only.

**Can users request deletion?** This one deserves care rather than a tick. Answer: **yes,
data can be deleted, on request to the centre.** Not through the app, and not by the user
themselves. The honest form of the answer is that the centre is the agency that holds the
information (see [privacy-statement](privacy-statement.md)) and deletion follows the
[retention](retention.md) schedule. Google also wants a **deletion request URL** — this
needs to exist and point somewhere a person can actually reach.

**Crash logs are the only "shared" row, and it is the one to think hardest about.** A
crash report is a copy of whatever state the app was in when it broke, and Postgres quotes
the offending value back inside a constraint violation. The scrubbing in
`apps/web/src/lib/observability.ts` removes emails, phone numbers, dates of birth and
quoted row values, and it has its own tests — because a bug there does not produce a wrong
screen, it sends a child's medical information to a third party. If that scrubbing is ever
removed, this row becomes a false declaration.

## Apple privacy questionnaire

Same substance, Apple's shape. Every type below is linked to the user's identity and
**none** of it is used for tracking.

| Apple category | Collected | Linked to identity | Used for tracking |
|---|---|---|---|
| Contact Info (name, email, phone, address) | Yes | Yes | No |
| Health & Fitness → Health | Yes | Yes | No |
| User Content (photos, messages) | Yes | Yes | No |
| Identifiers (push token) | Yes | Yes | No |
| Diagnostics (crash data) | Yes | **No** — scrubbed | No |
| Usage Data | No | — | — |
| Location | No | — | — |
| Purchases, Financial Info | No | — | — |

**App Tracking Transparency:** no prompt, because there is no tracking. Do not add the
prompt "just in case" — asking for permission you do not use is its own review problem.

**Age rating:** 4+. There is no user-generated content visible to strangers, no chat with
anyone outside a centre, no purchasing, and no advertising. Messaging is between named
kaiako and named whānau within one service, which is not open communication.

## Screenshots

Required: 6.7" and 5.5" iPhone plus 12.9" iPad for Apple; phone, 7" and 10" tablet for
Play.

**Use the demo tenant, never a real centre.** `npm run seed:demo` produces invented
children with invented allergies. A screenshot of the real roll would put a real child's
name and anaphylaxis plan in a store listing, permanently, in a place neither store lets
you fully retract.

The shot to lead with is the ratio bar, in its **at-limit** state — that is the moment the
product is worth something, and a screenshot of a calm green roll shows nothing a paper
sheet does not do.

## Review notes for Apple

Reviewers cannot get past a login without an account, and this app has no self-service
sign-up by design — access comes from a centre inviting somebody.

> This app is used by staff and families at licensed early childhood services in New
> Zealand. Accounts are created by the service, so there is no public sign-up. A demo
> account with sample (fictional) data is provided below.
>
> The app has no advertising, no analytics and no in-app purchases. It cannot be used to
> contact anybody outside the service that invited the user.

Provide a demo owner account on the demo centre, with a password rotated after review.
**Do not give a reviewer access to a real centre's tenant** — the RLS boundary would hold,
and it would still mean handing a stranger a live account at a childcare centre.

## One thing that will fail the first submission

Both stores reject a listing whose screenshots show an obviously unfinished app, and both
reject a privacy policy URL that 404s. The URL is the more likely of the two, because it
is the only item on this page that depends on hosting rather than on writing.

---

*Last updated 2026-08-04. Nothing here has been submitted; no build exists; no account
exists.*
