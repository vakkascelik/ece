import type { Metadata } from 'next';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { CENTRE_FACTS } from '@/lib/centres';
import { ApplicationForm } from './ApplicationForm';

export const metadata: Metadata = {
  title: 'Careers',
  description:
    'Work at Little Pearls Educare Centre in Mt Albert or Mt Roskill. Apply online, or send ' +
    'your CV to career@littlepearls.org.nz.',
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
 * WHAT CHANGED HERE: the page used to say "email us your CV" and nothing else, which meant every
 * application lived in a shared mailbox — no record of who was replied to, and nothing to answer
 * with if somebody asks why they never heard back. The form now creates a record in the centre's
 * own system. The CV still goes by email, because there is no attachment path yet and saying so
 * is better than a form that looks complete and loses half the application.
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
            Only the centre’s manager and owner can see what you send, and you can ask us to delete
            it at any time. Please also email your CV to{' '}
            <a href={`mailto:${CENTRE_FACTS.careersEmail}`}>{CENTRE_FACTS.careersEmail}</a> — this
            form cannot take attachments yet.
          </p>

          <ApplicationForm />
        </section>
      </div>
    </>
  );
}
