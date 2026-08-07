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
        The front door, arched. Two things already theirs meet here: the rounded badge of the logo,
        and the ivy-trailed archway their quiet corner is photographed through. Cropped wide as well,
        because a full square hero pushes the buttons below the fold on a phone.
        No caption — the paragraph above already says who and where.
      */}
      <Photo photo={PHOTOS.entrance} className="photo-lead" showCaption={false} priority />

      <p>
        <Link className="btn" href="/enrolment">
          Enquire about a place
        </Link>{' '}
        <Link className="btn btn-quiet" href="/centres">
          Visit our centres
        </Link>
      </p>

      {/* Te Whāriki is "the woven mat". The rule between sections is a weave — decorative, so it is
          hidden from assistive technology; the heading already says a new section has begun. */}
      <hr className="weave" aria-hidden="true" />

      <h2>Learning through play</h2>
      <p>
        We recognise the importance of play, using spontaneous and planned moments to build on a
        child&rsquo;s existing knowledge and skills. Our programmes are guided by{' '}
        <strong>Te Whāriki</strong>, the New Zealand early childhood curriculum, and in our infant
        room by the Pikler and RIE approaches and the schema concept.
      </p>

      {/* Arched, because these are square — the shape only works on a square or portrait box, and
          it is the shape of their own ivy doorway and their own badge. */}
      <div className="photo-row">
        <Photo photo={PHOTOS.atTheTable} className="photo-arch" />
        <Photo photo={PHOTOS.painting} className="photo-arch" />
        <Photo photo={PHOTOS.writing} className="photo-arch" />
      </div>

      <p>
        <Link href="/philosophy">Read our philosophy</Link>
      </p>

      <hr className="weave" aria-hidden="true" />

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
