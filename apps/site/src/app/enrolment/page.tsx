import type { Metadata } from 'next';
import Link from 'next/link';
import { CENTRES, CENTRE_FACTS } from '@/lib/centres';
import { appUrl } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Enrolment and fees',
  description:
    'How to enquire about a place at Little Pearls Educare Centre in Mt Albert or Mt Roskill, ' +
    'and how to ask about fees.',
};

/**
 * Enrolment.
 *
 * WHY THERE IS NO FORM ON THIS PAGE YET
 *
 * Their current page has one, and it posts to an Adobe Muse PHP mailer (`scripts/form-u832.php`)
 * that has not been touched since 2018 and whose delivery could not be verified. Carrying that
 * forward is not an option; building its replacement is a separate, larger decision than a
 * website, for two reasons written down rather than assumed:
 *
 *  1. **Their form collects a child's full name and exact date of birth from a public page.**
 *     `docs/tenant-little-pearls.md` records that this tenant holds "zero personal information"
 *     and that no child record goes in until professional indemnity insurance is in place. A
 *     public endpoint writing an identifiable under-five into that database crosses the line the
 *     doc exists to hold — and it does so with the weakest lawful basis in the product, since
 *     nobody has signed anything and no consent conversation has happened.
 *  2. The centre does not need a child's legal name to phone a guardian back.
 *
 * So this page does the thing their current form actually achieves — it gets a family talking to
 * the centre — using contact details that are already public on their own site. When an enquiry
 * form is built it will collect the guardian's details and a coarse age band, and it will not ask
 * for a child's name or date of birth.
 *
 * WHY THERE IS NO FEE ON A PAGE ABOUT FEES
 *
 * Because they publish none. Their page is titled "Enrolment & Fees" and contains no amount; the
 * only route to one is an Issuu-hosted PDF over plain HTTP whose existence could not be confirmed.
 * `fee_schedules` in the platform ships with no amounts anywhere for the same reason: an invented
 * rate is a rate a family gets billed.
 */
export default function EnrolmentPage() {
  return (
    <>
      <h1>Enrolment</h1>
      <p className="lede">
        We would love to meet you. Get in touch with the centre you are interested in and we will
        tell you what is available, show you around, and answer anything about fees.
      </p>

      <h2>Enquire about a place</h2>
      <div className="grid">
        {CENTRES.map((centre) => (
          <div className="card" key={centre.path}>
            <h3 style={{ marginTop: 0 }}>{centre.name}</h3>
            <p>
              <a className="btn" href={`tel:${centre.phoneHref}`}>
                Call {centre.phone}
              </a>
            </p>
            <p>
              <a href={`mailto:${centre.email}?subject=Enquiry about a place`}>{centre.email}</a>
            </p>
            <p>
              {centre.street}, {centre.suburb}
            </p>
          </div>
        ))}
      </div>

      <h2>What to tell us</h2>
      <p>
        It helps if you can say roughly how old your child is, when you are hoping to start, and
        which days you would like. You do not need to send us anything about your child before we
        have spoken — we will take the details we need when a place is available.
      </p>

      <h2>Fees</h2>
      <div className="gap">
        <strong>Our fees are not published on this page yet.</strong> Please ask us and we will send
        you the current schedule, including what is included and any funding you may be entitled to.
        We would rather tell you an accurate figure than publish one that is out of date.
      </div>

      <h2>Hours and ages</h2>
      <dl className="facts">
        <dt>Open</dt>
        <dd>{CENTRE_FACTS.hours}</dd>
        <dt>Ages</dt>
        <dd>{CENTRE_FACTS.ages}</dd>
      </dl>

      <div className="callout">
        <p style={{ margin: 0 }}>
          Already with us? Families and kaiako can{' '}
          <a href={appUrl()}>
            sign in to the centre app
          </a>
          . Access comes from the centre inviting you — there is no sign-up.
        </p>
      </div>

      <p>
        <Link href="/contact">Other ways to contact us</Link>
      </p>
    </>
  );
}
