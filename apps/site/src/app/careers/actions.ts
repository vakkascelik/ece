'use server';

import { applicationProblem } from '@ece/core';
import { submitApplication } from '@ece/api/recruitment';
import { CENTRES, CENTRE_FACTS, EITHER_CENTRE } from '@/lib/centres';
import { anonDb } from '@/lib/db';

export interface ApplyResult {
  ok: boolean;
  message: string;
}

/**
 * ONE success sentence, and that is the point rather than tidiness.
 *
 * The honeypot returned "Thank you — we have your application and will be in touch." while a real
 * submission returned "…has gone to both centres…" or "…has gone to Ōwairaka / Mt Albert…". So the
 * trap announced itself: anything comparing two responses could read straight off the wording which
 * field was the one not to fill in, which is the whole value of a honeypot gone.
 *
 * Naming the centre back to the applicant was worth something and not this much. It is dropped for
 * everybody rather than kept for the humans, because keeping it for the humans is exactly what
 * distinguishes them.
 */
const ACCEPTED = 'Thank you — we have your application and will be in touch.';

/**
 * Receive an application from the public careers form.
 *
 * WHAT REACHES POSTGRES, AND WHAT DOES NOT
 *
 * The form posts a centre *choice* — `mt-albert`, `mt-roskill` or `either` — and this maps it to
 * the platform slugs held in `lib/centres.ts`. Nothing the browser sends is used as an
 * identifier. `submit_job_application` resolves the slug itself and would refuse an unknown one,
 * so this is the second of two independent checks rather than the only one.
 *
 * "Either" files one application per centre, because a membership of the waitlist, a booking and
 * an application are all per-centre in this schema — there is no row that means "both". Two rows
 * is also what the two managers need: each site sees the people who would work there.
 */
export async function apply(_previous: ApplyResult | null, form: FormData): Promise<ApplyResult> {
  /*
   * The honeypot, first, and it reports success.
   *
   * A field no human sees, so anything in it came from something filling every input on the
   * page. Returning the same confirmation a real applicant gets means a bot has no signal to
   * adapt to — telling it "rejected as spam" is free feedback for whoever wrote it.
   *
   * WHAT IS NOT HERE, and the reason changed: there is no minimum-time-to-submit check. It used to
   * be impossible — the check needs a timestamp rendered into the form, this page was statically
   * generated, and every visitor would have received the build time. The CSP fix made every route on
   * this site render per request, so a real per-visitor timestamp is now available and that argument
   * is gone.
   *
   * Still not built, for a weaker reason stated rather than dressed up: an unsigned timestamp in a
   * hidden field is forgeable by anything sophisticated enough to be worth stopping, so it would need
   * an HMAC and a secret to mean anything. The limit that actually holds is the flood guard inside
   * `submit_job_application`, which is in the database, so it survives a restart and sees every
   * instance.
   */
  if ((form.get('website') as string | null)?.trim()) {
    return { ok: true, message: ACCEPTED };
  }

  const applicantName = String(form.get('applicantName') ?? '');
  const email = String(form.get('email') ?? '');
  const phone = String(form.get('phone') ?? '');
  const positionSought = String(form.get('positionSought') ?? '');
  const availableFrom = String(form.get('availableFrom') ?? '');
  const message = String(form.get('message') ?? '');
  const certificate = String(form.get('certificate') ?? '');
  const choice = String(form.get('centre') ?? '');

  // Shared with the database's own check constraints, and with nothing else — see
  // `applicationProblem` in @ece/core for why the email rule is loose rather than clever.
  const problem = applicationProblem({
    applicantName,
    email,
    phone,
    positionSought,
    availableFrom,
    message,
  });
  if (problem) return { ok: false, message: problem };

  const centres =
    choice === EITHER_CENTRE
      ? CENTRES
      : CENTRES.filter((c) => c.path === choice);
  if (centres.length === 0) {
    return { ok: false, message: 'Please choose which centre you would like to work at.' };
  }

  /*
   * Three states, not a checkbox.
   *
   * "Yes", "no" and "not answered" are different facts about an applicant, and a checkbox can
   * only carry two — an unticked box would record "does not hold a certificate" for somebody
   * who skipped the question. The column is nullable for the same reason, and this is the same
   * argument that kept consent three-state when the design pack asked for switches.
   */
  const holdsPractisingCertificate =
    certificate === 'yes' ? true : certificate === 'no' ? false : null;

  /*
   * "Either centre" is two independent inserts, and there is no transaction across them.
   *
   * The first version wrapped the loop in one try/catch, so if the first centre succeeded and the
   * second threw, the applicant was told "we could not save that — please email us" while their
   * application was **already in the database** for one of the two centres. They then email as
   * instructed, and staff hold one record and one email for the same person with no way to know
   * they are the same event.
   *
   * There is no compensation to write, either: a submitted application must not be rolled back
   * because a second insert failed, and `anon` has no DELETE on the table anyway. So the outcomes
   * are collected and the truth is reported. Any success means the centre has the application, and
   * that is what the applicant is told.
   */
  const db = anonDb();
  const failures: unknown[] = [];
  let landed = 0;

  for (const centre of centres) {
    try {
      await submitApplication(db, {
        centreSlug: centre.platformSlug,
        applicantName,
        email,
        phone,
        positionSought,
        holdsPractisingCertificate,
        availableFrom,
        message,
      });
      landed += 1;
    } catch (error) {
      failures.push(error);
      // Named, because a half-delivered application is the case somebody has to reconcile by hand.
      console.error(`careers application failed for ${centre.platformSlug}`, error);
    }
  }

  /*
   * Nothing landed. The applicant gets a way through and the server keeps the detail — a form that
   * says "something went wrong" and nothing else, on a page whose whole purpose is to receive an
   * application, loses the application. The careers mailbox is the fallback that already worked
   * before this form existed.
   */
  if (landed === 0) {
    return {
      ok: false,
      message:
        `Sorry — we could not save that. Please email ${CENTRE_FACTS.careersEmail} and we will ` +
        'pick it up from there.',
    };
  }

  if (failures.length > 0) {
    /*
     * One of two centres took it. Told plainly, and with the mailbox for the other, because "we
     * have your application" would be true and would also leave them thinking both sites had seen
     * it. The one that did have it is not named — see ACCEPTED — so this says "one of our centres".
     */
    return {
      ok: true,
      message:
        `${ACCEPTED} One of our centres could not be reached just now, so if you wanted both, ` +
        `please email ${CENTRE_FACTS.careersEmail} as well.`,
    };
  }

  return { ok: true, message: ACCEPTED };
}
