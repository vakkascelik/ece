# Breach response

A runbook, written before it is needed, because the first hour of a breach is not when
anybody should be deciding what a breach is.

> **On the legal specifics.** The substance below — a serious-harm test, notification to
> the Privacy Commissioner *and* to affected people, as soon as practicable, with an
> offence for failing to notify — is Part 6 of the Privacy Act 2020 and is not in doubt.
> The exact section numbers and the exact maximum fine have **not** been verified against
> the current Act by anybody on this project. Verify them before this document is relied
> on in an actual incident, and before any of it is repeated to a family. Item 11 on
> [unverified-claims](../llm-wiki/wiki/unverified-claims.md).

## What counts

A **privacy breach** is unauthorised or accidental access to, disclosure of, alteration
of, loss of, or destruction of personal information — or an action that prevents the
agency itself from accessing it.

It becomes **notifiable** when it is likely to cause **serious harm**. Nothing about the
volume of records makes that determination on its own: one child's custody arrangement
reaching the wrong parent is more serious than a thousand rows of sign-in times.

Factors that push towards serious harm here:

- **Health information.** Allergies, medication, anaphylaxis plans.
- **Custody arrangements and court order references.** The highest-risk field in the
  product, because disclosure can reach a person a court has restricted.
- **A child's identity plus their attendance pattern** — when and where a specific
  under-five predictably is.
- **Whether the recipient is known and trustworthy.** A photo sent to the wrong parent
  at the same centre is different from a database extract on the open internet.
- **Whether it can be contained.** A signed URL that expires in an hour is containable;
  an emailed spreadsheet is not.

## The first hour

**1. Contain, without destroying evidence.**

- Suspected credential compromise: revoke the session and rotate. Supabase → Settings →
  API → rotate the `service_role` key, and rotate the anon key if it was exposed with a
  policy gap.
- Suspected policy gap: do **not** start editing policies in the dashboard. Run
  `npm run test:rls` first — it takes under a minute and tells you whether the boundary
  is actually broken or whether the report is something else. Then fix it as a migration,
  so the fix is recorded and replayable.
- Wrong-recipient disclosure: ask for deletion in writing and record the reply. It is not
  containment, but it is evidence of what was done.
- **Do not delete anything**, including the offending rows. Attendance, consent, messages
  and audit events are append-only and cannot be deleted anyway — which in an incident is
  a feature, because it means nobody can tidy up the evidence under pressure.

**2. Establish the facts, and write them down as you go.**

- What information, about how many people, and *which* people.
- When it happened, and when it was noticed. Both dates; the gap matters.
- Who accessed it, and whether they still can.
- What the audit log shows: `select * from audit_events where centre_id = … order by at
  desc`. Field names and timestamps only — enough to establish what was touched, never
  enough to re-disclose it.

**3. Decide whether it is notifiable.** The serious-harm test, above. **If it is a close
call, notify.** Under-notifying a breach involving under-fives is the worse error, and
the Commissioner's office would rather see a notification that turns out not to have been
required.

## Notification

**To the Office of the Privacy Commissioner:** as soon as practicable after becoming
aware. Use the NotifyUs tool at privacy.org.nz. Failing to notify a notifiable breach is
an offence carrying a fine.

**To the people affected:** as soon as practicable, unless a listed exception applies.
Tell them plainly:

- what happened, and when;
- what information about them or their child was involved — specifically, not "some
  personal information";
- what has been done about it;
- what they can do;
- who to contact, and their right to complain to the Commissioner.

**Who sends it.** The **centre** is the agency and the centre notifies. Salix's job is to
tell the centre immediately, to establish the facts, and to help draft. A software
supplier notifying a centre's families directly would be both wrong and confusing —
see [privacy-statement](privacy-statement.md) for why the centre is the responsible
agency.

**Do not** send a notification that says "no evidence of misuse" as reassurance when
nobody has looked. And do not delay notification while working out how it happened: the
cause can follow, and the families' ability to protect themselves cannot.

## Afterwards

- Write the incident up: what happened, why it was possible, what changed.
- **If the cause was a policy or a grant, add an assertion to
  `supabase/tests/rls_isolation.sql`.** A fix without a test is a fix that comes back. The
  suite is at 176 assertions and every one of them exists because something could have
  gone wrong; several exist because something did.
- If the cause was that somebody could not tell what the product was claiming — a ratio
  that read "compliant" when nothing had been verified, a funding total that looked final
  — the fix is in the wording, and it belongs in the same commit.

## Who to call

| | |
|---|---|
| Centre privacy officer | *(a centre adopting this fills this in)* |
| Salix Limited (NZBN 9429053674067) | vakkas@pif.org.nz |
| Office of the Privacy Commissioner | privacy.org.nz · NotifyUs |
| Supabase support | via the project dashboard |

## Two things that are true today and worth knowing before an incident

- **There is no `service_role` key in either app bundle**, and there never has been. If a
  key is compromised it came from a developer machine, a CI secret, or `.env.local` — not
  from a phone. That narrows the investigation considerably.
- **The recovery point is up to 24 hours old.** Point-in-time recovery is not enabled. If
  a breach involves destruction rather than disclosure, up to a day of attendance,
  messages and consent decisions is unrecoverable. See
  [backup-and-restore](backup-and-restore.md).

---

*Last updated 2026-08-04. Never exercised — this runbook has not been walked through
against a simulated incident, which is the obvious next thing to do with it.*
