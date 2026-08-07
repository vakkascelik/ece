import Link from 'next/link';
import { Photo } from './Photo';
import { PHOTOS } from '@/lib/photos';
import { CENTRES, CENTRE_FACTS } from '@/lib/centres';

/**
 * The homepage.
 *
 * Their existing homepage is titled "About" and carries their own About copy. That copy is used
 * here, tidied for grammar and with macrons restored, and nothing has been added to it — no
 * invented differentiators, no stock warmth. Two things were split out because they were buried in
 * a paragraph and are the strongest things they have to say: the on-site chef and the whānau
 * programme.
 *
 * One correction of substance: their copy says "our centre has a full time on-site chef",
 * singular, written when there was one site. Whether that is true of both is an open question in
 * CONTENT-GAPS.md, so it is stated here without claiming which centres it covers.
 */
export default function HomePage() {
  return (
    <>
      <h1>Nau mai — welcome to Little Pearls</h1>

      <p className="lede">
        {CENTRE_FACTS.structure} childcare centres, delivering a warm, nurturing, safe and
        affordable home-like environment for children {CENTRE_FACTS.ages} in Ōwairaka / Mt Albert
        and Puketāpapa / Mt Roskill.
      </p>

      {/*
        CHILDREN, NOT THE FRONT DOOR.

        The hero was `entrance` — and looked at rather than described, that photograph is an orange
        wall, a sliding glass door, a surveillance-camera warning sign and a painted yellow parking
        line. It is a good photograph of a building and it was the wrong first thing on a page whose
        job is to make somebody want to leave a three-month-old here. Every warm image the centre
        owns was two clicks away on /rooms.

        `entrance` has not been dropped. It is still the Open Graph share image — see the note in
        layout.tsx, which is the one place a building genuinely is the right picture, because a link
        preview is seen by people who did not choose to look — and it still opens both centre pages.

        No caption; the paragraph above already says who and where.
      */}
      <Photo photo={PHOTOS.atTheTable} className="photo-lead" showCaption={false} priority />

      <p>
        <Link className="btn" href="/enrolment">
          Enquire about a place
        </Link>{' '}
        <Link className="btn btn-quiet" href="/centres">
          Visit our centres
        </Link>
      </p>

      {/* Decorative, so it is hidden from assistive technology; the heading already says a new
          section has begun. Was a woven-mat glyph — see globals.css for why it is a hairline. */}
      <hr className="rule" aria-hidden="true" />

      <h2>Learning through play</h2>
      <p>
        We recognise the importance of play, using spontaneous and planned moments to build on a
        child&rsquo;s existing knowledge and skills. Our programmes are guided by{' '}
        <strong>Te Whāriki</strong>, the New Zealand early childhood curriculum, and in our infant
        room by the Pikler and RIE approaches and the schema concept.
      </p>

      {/* Arched, because these are square — the shape only works on a square or portrait box, and
          it is the shape of their own ivy doorway and their own badge.

          `atTheTable` left this row when it became the hero above. Showing the same photograph twice
          on one page makes a centre look like it owns three pictures. `playKitchen` takes the slot
          because this section is about play and that is what it shows. */}
      <div className="photo-row">
        <Photo photo={PHOTOS.painting} className="photo-arch" />
        <Photo photo={PHOTOS.writing} className="photo-arch" />
        <Photo photo={PHOTOS.playKitchen} className="photo-arch" />
      </div>

      <p>
        <Link href="/philosophy">Read our philosophy</Link>
      </p>

      <hr className="rule" aria-hidden="true" />

      <h2>Food made on site</h2>
      <p>
        A full-time on-site chef provides nutritious and delicious meals — hot meals at lunchtime,
        fresh baking in the mornings and afternoons, and fresh and dried fruit through the day. We
        take part in the Heart Foundation reward programme and follow their advice.
      </p>

      {/* On the second ground. Ngā hononga is the centre's own emphasis, so it gets the one section
          on this page that is visibly set apart. */}
      <div className="band">
        <h2>Whānau are part of it</h2>
        <p>
          Education is a partnership between whānau and the centre. We celebrate that through
          parent-teacher meetings, family whānau days, dinners and seminars — and ngā hononga,
          relationships, are the key to quality education.
        </p>
      </div>

      <div className="photo-row">
        <Photo photo={PHOTOS.playground} />
        <Photo photo={PHOTOS.sandpit} />
        <Photo photo={PHOTOS.preschoolRoom} />
      </div>

      <h2>Where we are</h2>
      <div className="grid">
        {CENTRES.map((centre) => (
          <div className="card" key={centre.path}>
            <h3 style={{ marginTop: 0 }}>{centre.name}</h3>
            <p>
              {centre.street}
              <br />
              {centre.suburb} {centre.postcode}
            </p>
            <p>
              <a href={`tel:${centre.phoneHref}`}>{centre.phone}</a>
            </p>
            <p>
              <Link href={`/centres/${centre.path}`}>About this centre</Link>
            </p>
          </div>
        ))}
      </div>

      <div className="callout">
        <p style={{ margin: 0 }}>
          <strong>{CENTRE_FACTS.hours}.</strong> Children {CENTRE_FACTS.ages}. Come and see us —{' '}
          <Link href="/contact">get in touch</Link> to arrange a visit.
        </p>
      </div>
    </>
  );
}
