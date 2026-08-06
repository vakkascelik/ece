import type { Metadata } from 'next';
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
 */
export default function CareersPage() {
  return (
    <>
      <h1>Work with us</h1>
      <p className="lede">
        We are a {CENTRE_FACTS.structure.toLowerCase()} service across two Auckland centres, and we
        are always glad to hear from registered and experienced early childhood teachers.
      </p>

      <h2>Send us your CV</h2>
      <p>
        Email <a href={`mailto:${CENTRE_FACTS.careersEmail}`}>{CENTRE_FACTS.careersEmail}</a> and we
        will be in touch. Tell us which centre interests you — Ōwairaka / Mt Albert or Puketāpapa /
        Mt Roskill — and what you are looking for.
      </p>

      <h2>What we care about</h2>
      <p>
        Respect is the basis of our approach: treating even the youngest infant as a unique human
        being. We are committed to ongoing professional development for our kaiako, and to promoting
        te reo Māori and tikanga Māori in daily practice.
      </p>

      <div className="gap">
        <strong>Current vacancies are not listed here yet.</strong> Email us and we will tell you
        what is open at each centre.
      </div>
    </>
  );
}
