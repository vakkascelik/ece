import type { Metadata } from 'next';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { CENTRE_FACTS } from '@/lib/centres';

export const metadata: Metadata = {
  title: 'Careers',
  description:
    'Work at Little Pearls Educare Centre in Mt Albert or Mt Roskill. Send your CV to ' +
    'career@littlepearls.org.nz.',
};

/**
 * Careers.
 *
 * Their page makes three claims: registered and experienced teachers, "higher than required
 * ratios", and "more than the minimum number of staff required by the Ministry of Education". The
 * first is theirs to make and is repeated. The other two are claims about a regulatory minimum,
 * and this repo does not restate a regulatory figure it has not sourced — the platform's own ratio
 * tables are flagged unverified for exactly that reason. Both are in CONTENT-GAPS.md.
 *
 * No named staff and no photographs, because their site publishes none and naming a person needs
 * that person's agreement.
 *
 * THE APPLICATION FORM WAS REMOVED, 2026-08-27, on the owner's instruction: "sending email is
 * enough". This reverses a deliberate decision and the reasoning it reversed is kept, because it
 * is the cost of the change rather than an argument against it.
 *
 * The form existed because "email us your CV" meant every application lived in a shared mailbox —
 * no record of who had been replied to, and nothing to answer with if somebody asked why they never
 * heard back. That problem is real and it is now back. It was also never fully solved: the form
 * could not take attachments, so every applicant had to email a CV *as well as* filling it in, and
 * a form that captures half an application while looking complete has its own failure mode.
 *
 * What goes with it, and this is the part worth knowing: the site no longer imports
 * `@ece/api/recruitment`, so **the public container's only remaining reason to reach Postgres is
 * the enrolment enquiry form**. If that ever moves to email too, the marketing site returns to
 * having no database access at all — which is what `tsconfig.json`'s note was written to protect.
 */
export default function CareersPage() {
  return (
    <>
      <PageBand eyebrow="Careers" title="Work with us">
        We are a {CENTRE_FACTS.structure.toLowerCase()} service across two Auckland centres, and we
        are always glad to hear from registered and experienced early childhood teachers.
      </PageBand>

      <div className="page">
        <section className="prose">
          <Eyebrow>What we care about</Eyebrow>
          <h2 className="section-title">Respect, and people who stay</h2>
          <p>
            Respect is the basis of our approach: treating even the youngest infant as a unique
            human being. We are committed to ongoing professional development for our kaiako, and to
            promoting te reo Māori and tikanga Māori in daily practice.
          </p>

          {/* Leads with the offer rather than the absence — see the note on the same block in
              `enrolment/page.tsx`. */}
          <div className="gap">
            <strong>Send us an application whenever you are ready.</strong> We do not list current
            vacancies here — tell us what you are looking for and we will say what is open at each
            centre.
          </div>
        </section>

        <hr className="rule" aria-hidden="true" />

        <section className="prose">
          <Eyebrow>Apply</Eyebrow>
          <h2 className="section-title">Tell us about yourself</h2>
          <p>
            Email your CV and a note about what you are looking for to{' '}
            <a href={`mailto:${CENTRE_FACTS.careersEmail}`}>{CENTRE_FACTS.careersEmail}</a>. Tell us
            which centre suits you — Ōwairaka / Mt Albert, Puketāpapa / Mt Roskill, or either — and
            we will let you know what is open.
          </p>
          <p>
            Only the centre’s manager and owner will see it, and you can ask us to delete it at any
            time.
          </p>
        </section>
      </div>
    </>
  );
}
