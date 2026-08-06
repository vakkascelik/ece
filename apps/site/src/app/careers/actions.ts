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
   * WHAT IS NOT HERE, and this is worth stating rather than implying: there is no
   * minimum-time-to-submit check. It would need a timestamp rendered into the form, and this
   * page is statically generated — every visitor would receive the build time, so the elapsed
   * interval would always be days and the check would pass everything. A timestamp set by
   * client JavaScript instead is both forgeable and would break the form for anybody without
   * JS. The real limit on volume is the flood guard inside `submit_job_application`, which is
   * in the database, so it survives a restart and sees every instance.
   */
  if ((form.get('website') as string | null)?.trim()) {
    return { ok: true, message: 'Thank you — we have your application and will be in touch.' };
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

  try {
    const db = anonDb();
    for (const centre of centres) {
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
    }
  } catch (error) {
    /*
     * The applicant gets a way through, and the server keeps the detail.
     *
     * A form that says "something went wrong" and nothing else, on a page whose whole purpose is
     * to receive an application, loses the application. The careers mailbox is the fallback that
     * already worked before this form existed.
     */
    console.error('careers application failed', error);
    return {
      ok: false,
      message:
        `Sorry — we could not save that. Please email ${CENTRE_FACTS.careersEmail} and we will ` +
        'pick it up from there.',
    };
  }

  return {
    ok: true,
    message:
      centres.length > 1
        ? 'Thank you — your application has gone to both centres and we will be in touch.'
        : `Thank you — your application has gone to ${centres[0].name} and we will be in touch.`,
  };
}
