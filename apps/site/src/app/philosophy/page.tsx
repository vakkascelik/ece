import type { Metadata } from 'next';
import { Photo } from '../Photo';
import { PHOTOS } from '@/lib/photos';

export const metadata: Metadata = {
  title: 'Our philosophy',
  description:
    'Little Pearls Educare Centre’s philosophy: aroha, ngā hononga, children as capable learners, ' +
    'partnership with whānau, and te reo Māori and tikanga Māori in daily practice.',
};

/**
 * Their philosophy statement, as a page.
 *
 * It exists today only as a one-page PDF linked from their homepage — 73KB, last modified in 2018,
 * and the single most important thing they publish about themselves. A PDF is the wrong container
 * for it: it is not indexed usefully, it does not reflow on a phone, a screen reader handles it
 * worse than HTML, and a parent has to leave the site to read it.
 *
 * The words are theirs. Three kinds of change, all deliberate and all recorded:
 *
 *  1. **Macrons restored** — their PDF writes "Maori", "whanau", "Nga Hononga". The bicultural
 *     commitment in this very statement is the reason that matters; the platform's design pack
 *     makes the same rule.
 *  2. **Typos fixed** — "whana" for "whānau", "its just a pleasure", and a sentence that reads
 *     "We aim to environmental/sustainability focus".
 *  3. **Nothing added.** No claim appears here that is not in their statement.
 */
export default function PhilosophyPage() {
  return (
    <>
      <h1>Our philosophy</h1>
      <p className="lede">Every child is precious like a pearl.</p>

      <h2>Aroha</h2>
      <p>
        We believe education should be given with aroha — with love — to children. Ngā hononga,
        relationships, are the key to forming quality education.
      </p>

      <h2>Children as capable learners</h2>
      <p>
        Children are capable, competent and active learners. Respect is the basis of the Little
        Pearls approach: respecting a child means treating even the youngest infant as a unique
        human being, not as an object.
      </p>

      <h2>A partnership with whānau</h2>
      <p>
        Education is a partnership between whānau, parents and the centre. We celebrate that
        partnership through parent-teacher meetings, family whānau days, dinners and seminars.
      </p>

      <h2>Bicultural practice</h2>
      <p>
        We are in a bicultural country living in a multicultural society. We aim to promote te reo
        Māori and tikanga Māori in daily practice.
      </p>

      {/* Placed against "our environment", which is what it shows. No caption: the section that
          follows describes the room better than a line under a picture could. */}
      <hr className="rule" aria-hidden="true" />

      <Photo photo={PHOTOS.quietCorner} className="photo-arch" showCaption={false} />

      <h2>Our environment</h2>
      <p>
        The inside of our centre is shoe-free. We are committed to ongoing professional development
        for our kaiako, and to an environmental and sustainability focus in what we do day to day.
      </p>

      <h2>Te Whāriki</h2>
      <p>
        Our programmes are guided by Te Whāriki, the New Zealand early childhood curriculum, and in
        our infant room by the Pikler and RIE approaches and the schema concept.
      </p>
    </>
  );
}
