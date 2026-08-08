# The kiosk, and guardian PINs

A shared tablet in the entrance, where families sign their own children in and out.

## Overview

Centres do this on paper or on a tablet, and the alternative the app offered until now was
every parent logging into their own account on a communal screen — which nobody does, so it
was not a design but a refusal to have the feature.

It is the riskiest surface in the repo. It adds **an authentication factor** and it writes into
`attendance_events`, which underpins a funding claim on the Crown. It shipped as three
migrations in order, and the order is the argument: 0042 makes the role, 0043 shuts the doors
that role would otherwise walk through, 0044 builds the capability. **The doors are shut before
there is a key.**

## Key Points

- **A kiosk is a device, not a person.** It holds no capability in `@ece/core` and reads no
  table directly. Everything it can do is a `SECURITY DEFINER` function.
- **`caller_centre_ids()` would have leaked to it** — see [[tenancy-and-rls]]. Four policies
  were narrowed in 0043 before the role could safely exist.
- **PINs are bcrypt, not SHA-256**, and the difference is the input, not the fashion.
- **The verify function returns a status and never raises**, because raising would roll back the
  failed-attempt counter it had just incremented.
- **`can_collect` is enforced for the first time.** A door has no human gatekeeper.
- **`attendance_insert` was not widened.** The kiosk writes through a function; staff writes are
  governed by exactly the rule they were governed by yesterday.

## Details

### Why not SHA-256, despite `invitations` doing exactly that

The roadmap said "hash only, the [[invitations]] precedent". Right about *hash only* and wrong
about the algorithm, and the difference is what is being hashed.

An invitation token is 256 bits of randomness. SHA-256 of it is safe because there is nothing to
guess: somebody holding the whole table has 2^256 candidates and no shortcut.

A PIN is four digits. SHA-256 of a four-digit PIN is **ten thousand hashes** — a table somebody
builds in a second — and unsalted, every PIN in a leak falls to the same table at once.

So: bcrypt via pgcrypto, per-row salt, work factor 10, verified against the live database before
being relied on. The comparison happens *inside* Postgres, so the hash never crosses the wire and
the application never holds it even briefly.

`guardian_pins` has RLS enabled and **not one policy** — deliberately the opposite of the
convention in [[conventions]], which is why it is written down. Every other table here is
reachable by somebody; this one is reachable by nothing. The suite asserts an *owner* cannot read
a hash, because "no policy" looks identical to "policy forgotten".

### The status return, which is not a style preference

`kiosk_sign_child` returns `recorded`, `duplicate`, `wrong_pin`, `locked`, `no_pin` or
`not_permitted`. It never raises for a failed attempt.

A `raise exception` would roll back the failed-attempt counter incremented immediately before
it, and the lockout would never engage — a brute-force limiter that counts to one forever. That
is the *obvious* implementation, which is what makes it worth a paragraph.

Demonstrated rather than argued: a probe function that increments a counter and then raises,
called inside an exception handler, leaves the counter reading **0**.

Five attempts then fifteen minutes. Those numbers are a judgement and are recorded as one in
[[unverified-claims]] — a parent mistyping at a door needs room, and 10,000 candidates at five
per fifteen minutes is over a week of uninterrupted tapping in a staffed entrance.

### `can_collect` stops being a note and becomes a control

`child_guardians.can_collect` has existed since 0003 and, until 0044, **was never enforced
anywhere**. It was data staff read off a screen and applied with judgement.

A door tablet has no judgement. So sign-**out** requires it and sign-**in** does not: bringing a
child in is not taking one away. The suite asserts both halves against Ana's two guardians — her
mother, who may collect, and her grandmother, who is on the record and not on the collection
list.

**What the kiosk cannot enforce, stated so nobody assumes otherwise.**
`custody_arrangements` is free text written for a person to read — *"collection by the father is
not permitted without written agreement"*. There is no machine-readable form of it, so the
tablet cannot enforce a parenting order. The consequence is that a centre which has left
`can_collect` at its default for a guardian who must not collect has a kiosk that will let them.
Recorded in [[unverified-claims]].

### What a kiosk may know about a child

Three columns: id, the name to show, present or not. A function, not a policy, because the
requirement is column-shaped:

- a **policy** cannot restrict columns;
- a **column grant** can, but grants attach to Postgres roles and every signed-in caller shares
  the single `authenticated` role, so a grant cannot vary by membership role;
- a **definer function** can, and is the most auditable of the three — what a kiosk can learn is
  the `returns table` clause, in full, on one line.

`kiosk_guardians` is the same shape: name, `can_collect`, whether a PIN exists. No contact
details, no address, no relationship notes. The flag is returned so the screen can grey a row out
and **enforced** in `kiosk_sign_child` regardless, because the screen is a convenience and the
function is the rule.

### The audit trigger that would have recorded nothing

`audit_trigger` attributes a row to a tenant through `centre_id`, `child_id` or `invoice_id`, and
**gives up silently** when it finds none — returning without writing, because failing the
operation would be worse.

`guardian_pins` carries none of the three. So the trigger would have been created, the
class-level assertion in the suite would have gone on passing — *it checks the trigger exists* —
and not one audit row would ever have been written.

0044 adds a `guardian_id` branch. Safe against every existing table by inspection of the
catalogue: only `child_guardians` and `invoices` carry `guardian_id`, and both match an earlier
branch, so neither changes behaviour.

A second, quieter version of the same bug: `guardian_pins` is keyed on the guardian and has no
`id`, so `entity_id` would have been null — a permitted value, so nothing would have failed, and
the audit would have said *"a PIN changed at this centre"* without saying whose. Worse than an
error, because it looks like a record. The trigger now falls back to `guardian_id`, and the suite
asserts the audit row's **content** rather than its existence.

What is recorded is the column *name* that changed, never its value, so a rotated PIN appears as
`{"changed": ["pin_hash", "set_at"]}`. The DELETE matters most: clearing a PIN otherwise leaves
no trace at all, because the evidence goes with the row.

## See Also

- [[tenancy-and-rls]] — `caller_centre_ids()` and the four narrowed policies
- [[attendance-and-ratios]] — the table this writes into, and its idempotency contract
- [[unverified-claims]] — the lockout numbers, and what custody arrangements cannot do
- [[conventions]] — the table convention this one deliberately breaks

*Last updated: 2026-08-08*
