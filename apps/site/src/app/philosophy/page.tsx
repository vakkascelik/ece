import type { Metadata } from 'next';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { Pearl } from '../Pearl';
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
      {/*
        THE TAGLINE IS THE LEDE ON THIS PAGE and always was — which is why this is the one route
        where the band's opening line is the centre's own sentence rather than a summary. It is also
        the sentence the whole pearl design is built on, so it belongs on the water.
      */}
      <PageBand eyebrow="What we believe" title="Our philosophy">
        Every child is precious like a pearl.
      </PageBand>

      <div className="page">
        {/*
          A pearl beside the opening, at 124px. The only decorative pearl on an inner page, and it
          earns the exception: this page is where the analogy is stated in the centre's own words,
          so the object is on the page the sentence is on.
        */}
        <section className="aside-grid">
          <div className="prose">
            {/*
              Plain `h2`s, all four, and NOT `.section-title` on the first. These are peers — four
              beliefs at the same level — and giving the first the lighter, larger section treatment
              made it look like a heading the other three sat under, which is an outline the document
              does not have. `.section-title` is for a heading that follows an eyebrow and opens a
              section; there is no eyebrow here because the band above already carries one.
            */}
            <h2 style={{ marginTop: 0 }}>Aroha</h2>
            <p>
              We believe education should be given with aroha — with love — to children. Ngā
              hononga, relationships, are the key to forming quality education.
            </p>

            <h2>Children as capable learners</h2>
            <p>
              Children are capable, competent and active learners. Respect is the basis of the
              Little Pearls approach: respecting a child means treating even the youngest infant as
              a unique human being, not as an object.
            </p>

            <h2>A partnership with whānau</h2>
            <p>
              Education is a partnership between whānau, parents and the centre. We celebrate that
              partnership through parent-teacher meetings, family whānau days, dinners and seminars.
            </p>

            <h2>Bicultural practice</h2>
            <p>
              We are in a bicultural country living in a multicultural society. We aim to promote te
              reo Māori and tikanga Māori in daily practice.
            </p>
          </div>
          <aside>
            {/*
              `infantRoom` and not `quietCorner`, which is a correction from looking at the rendered
              page. The quiet corner belongs to "Our environment" below — it is the photograph that
              sentence is about — and taking it up here left that section illustrated by a
              *playground*, directly under the words "the inside of our centre is shoe-free".
              An outdoor photo under a claim about indoors is worse than no photo.
            */}
            <Pearl photo={PHOTOS.infantRoom} size={220} />
          </aside>
        </section>

        <hr className="rule" aria-hidden="true" />

        <section>
          <Eyebrow>Our environment</Eyebrow>
          <h2 className="section-title">Shoe-free inside, and quiet where it needs to be</h2>
          {/*
            Inside `.prose` so the photograph keeps the measure. A square image at the full 68rem
            container is a 1088px-tall block — the container widened in this pass and an uncapped
            `aspect-ratio: 1/1` widened with it.
          */}
          <div className="prose">
            <p>
              The inside of our centre is shoe-free. We are committed to ongoing professional
              development for our kaiako, and to an environmental and sustainability focus in what
              we do day to day.
            </p>

            {/* Placed against "our environment", which is what it shows. No caption: the paragraph
                above describes the room better than a line under a picture could. */}
            <Photo photo={PHOTOS.quietCorner} className="photo-arch" showCaption={false} />
          </div>
        </section>

        <hr className="rule" aria-hidden="true" />

        <section className="prose">
          <Eyebrow>The curriculum</Eyebrow>
          <h2 className="section-title">Te Whāriki</h2>
          <p>
            Our programmes are guided by Te Whāriki, the New Zealand early childhood curriculum, and
            in our infant room by the Pikler and RIE approaches and the schema concept.
          </p>
        </section>
      </div>
    </>
  );
}
