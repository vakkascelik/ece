import type { Metadata } from 'next';
import Link from 'next/link';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { CENTRES, CENTRE_FACTS } from '@/lib/centres';
import { EnquiryForm } from './EnquiryForm';

export const metadata: Metadata = {
  title: 'Enrolment and fees',
  description:
    'How to enquire about a place at Little Pearls Educare Centre in Mt Albert or Mt Roskill, ' +
    'and how to ask about fees.',
};

/**
 * Enrolment.
 *
 * THE FORM, AND THE TWO THINGS IT STILL WILL NOT ASK
 *
 * **Updated 2026-08-09: there is a form now.** What follows was written when there was not,
 * and it is kept rather than deleted because it is the specification the form was built to —
 * and because it is what caught migration 0052, which had shipped a required `child_name`
 * against it. The page was right and the schema changed (0054).
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
 * That last sentence is now implemented rather than promised. `EnquiryForm` asks for the
 * guardian's name, email, optional phone, which centre, a **coarse age band**
 * (`expecting | under-2 | 2-and-over`), an optional start date and optional days. It asks
 * nothing about the child beyond the band, and the database cannot be told one through this
 * path: `submit_enrolment_application` takes no such argument, and the RLS suite asserts that
 * against the catalogue so a behavioural test cannot quietly reintroduce it.
 *
 * The phone numbers stay above the form, and deliberately. A family who would rather ring
 * should not have to fill anything in, and for some of the whānau this centre serves a phone
 * call is the accessible option and a web form is not.
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
      <PageBand eyebrow="Come and see us" title="Enrolment">
        We would love to meet you. Get in touch with the centre you are interested in and we will
        tell you what is available, show you around, and answer anything about fees.
      </PageBand>

      <div className="page">
      <section>
        <Eyebrow>Talk to us</Eyebrow>
        <h2 className="section-title">Enquire about a place</h2>
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
              <p style={{ marginBottom: 0 }}>
                {centre.street}, {centre.suburb}
              </p>
            </div>
          ))}
        </div>
      </section>

      <hr className="rule" aria-hidden="true" />

      {/*
        FROM THE MANAGER'S OWN ENROLMENT REPLY (2026-08-17, relayed by the owner, the family's
        details redacted). This is the letter the centre sends to every interested family, so the
        page now says what the letter says — the visit windows and their reason, the unhurried
        first visit, and what actually happens next. The voice the manager asked for is the rule
        here: plain and warm, no promises about when a place opens.

        "The days you ask for can be the ones that are full" is deliberate expectation-setting the
        email models ("we currently only have availability on Wednesdays and Fridays…") without
        repeating a specific availability that will be stale in a month.
      */}
      <section className="prose">
        <Eyebrow>Come and visit</Eyebrow>
        <h2 className="section-title">See it before you decide anything</h2>
        <p>
          Visits are {CENTRE_FACTS.visitWindows}, {CENTRE_FACTS.visitNote}. We keep a first visit
          unhurried — a proper walk around, and time for your questions.
        </p>
        <p>
          If you are happy after your visit, we add your child&rsquo;s name to the waiting list —
          that is the enrolment form and the enrolment fee. Availability moves during the year as
          families&rsquo; days change, so the days you ask for can be the ones that are full; we
          will tell you what is open, and when we expect that to change.
        </p>
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="prose">
        <Eyebrow>Or write to us</Eyebrow>
        <h2 className="section-title">Send us an enquiry</h2>
        <p>
          It helps if you can say roughly how old your child is, when you are hoping to start, and
          which days you would like. You do not need to send us anything about your child before we
          have spoken — we will take the details we need when a place is available.
        </p>
        <EnquiryForm />
      </section>

      <hr className="rule" aria-hidden="true" />

      <section className="prose">
      <Eyebrow>Fees</Eyebrow>
      <h2 className="section-title">What it costs</h2>
      {/*
        LEADS WITH THE OFFER, not the absence. Same block, same honesty, opposite first sentence.

        It opened "Our fees are not published on this page yet" in bold, inside a red-bordered
        tinted panel — so the first thing a parent met on the page they came to for a number was
        the site reporting a fault in itself. The information is unchanged and the reason is still
        stated; what moved is which half of it arrives first.
      */}
      <div className="gap">
        <strong>Ask us and we will send you the current fee schedule</strong> — including what is
        covered and any funding you may be entitled to. We do not publish fees on this page, because
        we would rather tell you an accurate figure than leave one here that is out of date.
      </div>

      <h3>Hours and ages</h3>
      <dl className="facts">
        <dt>Open</dt>
        <dd>{CENTRE_FACTS.hours}</dd>
        <dt>Ages</dt>
        <dd>{CENTRE_FACTS.ages}</dd>
      </dl>

      {/*
        THE "ALREADY WITH US?" CALLOUT IS GONE. The site does not refer to the app anywhere — see
        the note in the masthead in `layout.tsx` for the three steps that led here.

        Worth recording what the removal costs, because it is not nothing. This callout was the one
        place a family already at the centre was told two things: that there is somewhere to sign
        in, and that access arrives by invitation rather than by signing up. The second sentence
        existed to stop somebody hunting the site for a registration form. Neither question arises
        now, because the page no longer suggests there is an app — but if the link comes back, both
        sentences come back with it, not just the first.
      */}
      <p>
        <Link href="/contact">Other ways to contact us</Link>
      </p>
      </section>
      </div>
    </>
  );
}
