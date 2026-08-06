# Backup and restore

## What exists

| | |
|---|---|
| **Daily logical backup** | Taken by Supabase, retained per the project's plan |
| **Point-in-time recovery** | **Not enabled.** A paid feature |
| **Verified restore** | `npm run drill:restore` — runs, passes, and has been mutation-tested |
| **Migrations as schema recovery** | `npm run migrate` replays 0001→0020 with checksum guards |

## The recovery point is up to 24 hours old, and that is a decision

With a daily backup and no PITR, the worst case is losing a full day. For a centre that
is up to a day of sign-ins, messages, consent decisions and incident notes.

The sign-ins are the sharp end: attendance is the evidence behind a funding claim and
behind a ratio history, and it cannot be reconstructed from memory two weeks later. A
centre that lost a Tuesday would have to exclude Tuesday from its funding claim — which
the funding calculation would do correctly and visibly, because a day it cannot resolve
is named rather than estimated, but the centre is still out the money.

**PITR costs money and this decision has not been taken.** It is the right thing to buy
before a second centre is onboarded; with one pilot centre and no revenue, going without
is defensible. What is not defensible is not knowing — hence this paragraph.

## The drill

```bash
npm run drill:restore              # extract, reload into a shadow schema, compare
npm run drill:restore -- --keep    # leave the extract behind for inspection
```

It enumerates every table from the catalogue (so a table added by a future migration is
covered without anyone remembering), extracts every row as JSON to a file on disk, sends
it back, reloads it into `restore_drill.*` tables built with `like … including all`, and
compares row counts and a content fingerprint per table.

As at 2026-08-06, re-run after `0024_recruitment.sql` added a table: **35 tables, 2864 rows,
4/4 checks, every table identical.** (The previous run, 2026-08-04, was 34 tables and 485 rows —
the row count grew with end-to-end runs and demo data, not with the new table.)

### It has been mutation-tested, which matters more than it passing

A drill that passes is worthless unless you know it can fail. Two mutations were run
against a copy of the script:

| Mutation | Result |
|---|---|
| Append a character to a **timestamptz** value | Rejected at load: `22007 invalid input syntax for type timestamp with time zone`. Caught, but by the *type system*, not by the comparison |
| Append a character to a **free-text** column (`attendance_events.note`) | Loaded successfully, then **failed the comparison**, naming `attendance_events` — one character, in one column, of one row, out of 485 |

The second is the one that mattered. Without it, the comparison could have been
comparing something with itself and nobody would have known.

### What it does not prove

- **Not Supabase's backup files.** It extracts through the same interface the app uses.
  If their backup process were silently broken, this drill would pass anyway. Verifying
  that means downloading one of their dumps, restoring it with `pg_restore` into a second
  database, and comparing — a morning's work, and not something CI can do. **It has never
  been done.**
- **Not `auth.users`.** 8 accounts as at the last run (it read 27 before a sweep removed 56 leaked test accounts). A restore that brings back
  children and not the accounts permitted to read them is a restore into a locked
  building. Supabase's own backup covers `auth`; this drill does not, and the two facts
  should not be conflated.
- **Not Storage.** Every photo and video is an object outside the database. There is no
  drill for those at all.
- **Not policies, grants, triggers or functions.** `like … including all` copies columns,
  defaults, checks and indexes — not the security. Those come back from the migrations,
  which are replayable and checksum-guarded, and that is a *stronger* guarantee than a
  dump: a restored dump gives you the policies that were in place, while the migrations
  give you the policies that are supposed to be in place, with the drift refused loudly.

## Where an extract may live

**Rule, not advice: never in the repository, and never in a cloud-synced folder.**

An extract of this database is every child's name, date of birth, allergies and
medication in one file. The drill therefore writes to a system temp directory and deletes
it at the end. `--keep` and `--out` both print a warning naming the directory.

This rule exists because it was nearly broken once. `.backups/zelva-pre-wipe-2026-08-04.json`
— 2.4 MB, 34 tables, six user accounts and their posts, from the unrelated application this
database used to host — sat in the repository working tree for two weeks. It was gitignored,
so it never reached git, and this repository lives at `C:\dev\ece` rather than inside a
synced folder, so it never reached a cloud either. **Deleted 2026-08-04.**

An earlier version of this paragraph claimed the file was inside OneDrive and had therefore
been copied to Microsoft. That was wrong — the *other* repository on this machine is the one
in OneDrive. The claim is corrected rather than removed, because "we thought data had left
the machine and it had not" is exactly the kind of thing a runbook should record it got
wrong.

## Restoring, for real

There is no rehearsed procedure for a real restore, and this is the honest description of
what one would involve rather than a claim that it is ready.

1. **Stop writing.** Take the web app down. Sign-ins from a tablet queue in the outbox
   and flush later, so the roll is not lost while this happens — that is what the outbox
   was for, and it is the one part of this list that is genuinely designed for.
2. **Restore Supabase's backup** into a *new* project from the dashboard. Not over the
   top of the existing one: the broken database is the evidence, and if the restore is
   also broken there is nothing left to compare against.
3. **Check the schema version.** `npm run migrate -- --status` against the restored
   project. If it is behind, apply the remainder. If the checksums disagree, stop — a
   drifted schema restored under a matching version number is worse than a missing one.
4. **Run `npm run test:rls`.** 176 assertions. A restore that comes back with the data
   and without the policies is a restore that publishes every centre's records to every
   other centre, and it would look completely normal on screen.
5. **Reconcile.** `npm run reconcile:funding` for arithmetic, and count children,
   enrolments and attendance events against whatever the last known figures were.
6. **Repoint the apps** — `NEXT_PUBLIC_SUPABASE_URL`, the anon key, the service-role key,
   and the mobile `EXPO_PUBLIC_*` values, which need a new build to change.
7. **Write down what was lost.** The gap between the backup and the failure, named by
   date, so a funding claim is not made over a period whose records are incomplete.

Step 4 is the one that will be skipped under pressure and the one that must not be.

---

*Last updated 2026-08-04. Steps 1–7 have never been executed. `drill:restore` has, and it
covers step 3's data half and nothing else on this list.*
