import type { Metadata } from 'next';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { Pearl } from '../Pearl';
import { Photo } from '../Photo';
import { ART } from '@/lib/art';
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

        <hr className="rule" aria-hidden="true" />

        {/*
          FROM THE CENTRE'S OWN STRATEGIC PLAN (2026–2029), supplied by the owner on 2026-08-17 with
          the instruction to use it — and with the manager's direction for the voice of the whole
          site: plain, warm, nothing boastful, nothing that binds or builds expectations.

          These are their sentences, lightly trimmed for the page, not paraphrased into marketing.
          The five lines under "What we want to be known for" run as written; the strategic
          machinery around them (objectives, PLD, documentation systems) stays in the plan, because
          a parent is not its audience.

          The plan's own attribution for the four values is kept — they are drawn from the Teaching
          Council's Code and Standards — because a value with its source named reads as practice
          rather than as decoration, and this repo does not strip citations.
        */}
        <section className="aside-grid">
          <div className="prose">
          <Eyebrow>Where we are heading</Eyebrow>
          <h2 className="section-title">What we want to be known for</h2>
          <ul className="plain-list">
            <li>We are diverse. Our children are unique, our team is unique and our centre is unique.</li>
            <li>We are free to be and to express ourselves. We want to see you, and for others to see you too.</li>
            <li>We form bonds and make friendships. The families are part of our family.</li>
            <li>We play, learn and grow together. We take our learning wherever we go.</li>
            <li>Respect is fundamental to our practice.</li>
          </ul>

          <h3>Our values</h3>
          <dl className="facts">
            <dt>Whakamana</dt>
            <dd>Empowering all learners to reach their highest potential.</dd>
            <dt>Manaakitanga</dt>
            <dd>
              A welcoming, caring and creative environment that treats everyone with respect and
              dignity.
            </dd>
            <dt>Pono</dt>
            <dd>Acting in ways that are fair, honest, ethical and just.</dd>
            <dt>Whanaungatanga</dt>
            <dd>
              Positive, collaborative relationships with our learners, their families and whānau,
              our colleagues and the wider community.
            </dd>
          </dl>
          <p className="source-note">
            Our values draw on the Teaching Council&rsquo;s Code and Standards.
          </p>

          <h3>A global focus</h3>
          <p>
            Little Pearls is part of a global movement for unity, justice and human dignity.
            Supported by the Pearl of the Isles Foundation, our purpose goes beyond early learning —
            we weave the aspirations of the Foundation with the unique cultural context of Aotearoa
            and the hopes we hold for future generations. We understand ourselves as global citizens
            and cultural bridge-builders, and we help build a generation strong in their identity,
            culture and language, who show empathy and inclusiveness.
          </p>
          </div>
          {/*
            A decorative pearl, holding generated nacre artwork rather than a photograph — see
            `lib/art.ts` for what these images are and are not. Deliberate: the aside beside the
            philosophy statement above holds a real room, because that section describes the real
            place; this section is the centre's aspirations, and an abstract texture suits words
            about direction better than a photograph pretending to illustrate them.
          */}
          <aside aria-hidden="true">
            <Pearl photo={ART.ocean} size={220} />
          </aside>
        </section>
      </div>
    </>
  );
}
