'use server';

import { enquiryProblem, isPastDate } from '@ece/core';
import { submitEnquiry, AGE_BANDS, type AgeBand } from '@ece/api/enquiries';
import { CENTRES, CENTRE_FACTS, EITHER_CENTRE } from '@/lib/centres';
import { anonDb } from '@/lib/db';

export interface EnquiryResult {
  ok: boolean;
  message: string;
}

/**
 * ONE success sentence, for the reason the careers action records.
 *
 * The honeypot must return exactly what a real submission returns. Naming the centre back
 * to the family would be a nicety, and it would also let anything comparing two responses
 * read off which field was the trap — which is the whole value of a honeypot gone.
 */
const ACCEPTED = 'Thank you — we have your enquiry and will be in touch.';

/**
 * Receive an enrolment enquiry from the public form.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS DELIBERATELY DOES NOT COLLECT
 *
 * **No child's name and no date of birth.** The page above this form has carried that
 * decision since the site was built, and `docs/tenant-little-pearls.md` holds this
 * deployment to zero personal information until professional indemnity insurance is in
 * place. A public endpoint writing an identifiable under-five into the platform crosses
 * that line on the weakest lawful basis available — nobody has signed anything and no
 * consent conversation has happened.
 *
 * A coarse age band goes instead. It answers "which room, roughly when", which is the only
 * thing the centre needs before it rings back. Migration 0054 records the correction: an
 * earlier version of the schema required a child's name, and the page was right.
 */
export async function enquire(
  _previous: EnquiryResult | null,
  form: FormData,
): Promise<EnquiryResult> {
  // The honeypot, first, reporting success — a bot given "rejected as spam" is a bot given
  // free feedback for whoever wrote it.
  if ((form.get('website') as string | null)?.trim()) {
    return { ok: true, message: ACCEPTED };
  }

  const contactName = String(form.get('contactName') ?? '');
  const email = String(form.get('email') ?? '');
  const phone = String(form.get('phone') ?? '');
  const message = String(form.get('message') ?? '');
  const wantedFrom = String(form.get('wantedFrom') ?? '');
  const bandRaw = String(form.get('ageBand') ?? '');
  const choice = String(form.get('centre') ?? '');

  const problem = enquiryProblem({ contactName, email, phone, message, wantedFrom });
  if (problem) return { ok: false, message: problem };

  /*
    "Today" comes from the centre's timezone, not the server's.

    Every centre on this site is in Pacific/Auckland, so this could have been a constant —
    and it is written as a resolved value rather than `new Date()` because a server in UTC
    calls a New Zealand morning "yesterday", which would tell a family that a start date of
    today is in the past.
  */
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: CENTRE_FACTS.timezone }).format(
    new Date(),
  );
  if (wantedFrom && isPastDate(wantedFrom, today)) {
    return { ok: false, message: 'That start date has already been. Please choose a later one.' };
  }

  // Validated against the vocabulary rather than trusted. An unknown value is refused
  // rather than coerced to null: a family who chose an option and had it silently dropped
  // gets a call about the wrong room.
  const ageBand: AgeBand | null = (AGE_BANDS as readonly string[]).includes(bandRaw)
    ? (bandRaw as AgeBand)
    : null;
  if (bandRaw && !ageBand) {
    return { ok: false, message: 'Please choose one of the age options.' };
  }

  const wantedDays = form
    .getAll('wantedDays')
    .map((d) => Number(String(d)))
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);

  const centres = choice === EITHER_CENTRE ? CENTRES : CENTRES.filter((c) => c.path === choice);
  if (centres.length === 0) {
    return { ok: false, message: 'Please choose which centre you are asking about.' };
  }

  /*
    "Either centre" is two independent writes with no transaction across them, and the
    careers action records why the obvious `try` around the loop is wrong: if the first
    lands and the second throws, the family is told "we could not save that — please
    phone" while their enquiry is ALREADY in the database for one centre. They phone as
    instructed, and staff hold one record and one call for the same event with no way to
    know they are the same.

    There is no compensation to write either: `anon` has no DELETE on the table. So the
    outcomes are collected and the truth is reported.
  */
  const db = anonDb();
  let landed = 0;
  let failed = 0;

  for (const centre of centres) {
    try {
      await submitEnquiry(db, {
        centreSlug: centre.platformSlug,
        contactName,
        email,
        childAgeBand: ageBand,
        phone,
        wantedFrom,
        wantedDays,
        message,
      });
      landed += 1;
    } catch (error) {
      failed += 1;
      // Named, because a half-delivered enquiry is the case somebody reconciles by hand.
      console.error(`enrolment enquiry failed for ${centre.platformSlug}`, error);
    }
  }

  if (landed === 0) {
    return {
      ok: false,
      message:
        'Sorry — we could not save that just now. Please phone the centre and we will pick it ' +
        'up from there.',
    };
  }

  if (failed > 0) {
    return {
      ok: true,
      message:
        `${ACCEPTED} One of our centres could not be reached just now, so if you wanted both, ` +
        'please phone us as well.',
    };
  }

  return { ok: true, message: ACCEPTED };
}
