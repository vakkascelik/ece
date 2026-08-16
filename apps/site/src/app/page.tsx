import Link from 'next/link';
import { Eyebrow } from './Eyebrow';
import { Pearl } from './Pearl';
import { Photo } from './Photo';
import { Waves } from './Waves';
import { PHOTOS } from '@/lib/photos';
import { CENTRES, CENTRE_FACTS, ROOMS } from '@/lib/centres';

/**
 * The homepage.
 *
 * THE PEARL ANALOGY IS BACK, WHICH IS THE WHOLE POINT OF THIS PASS. The centre manager asked for
 * three things by name: bring the pearl back from the old site, give the page moving water and a
 * boat, and put the children's photographs inside the pearls. All three are here, and the analogy is
 * *made* rather than decorated with — see the "Why pearls" section, without which the pearls would
 * be three round pictures and a mystery.
 *
 * Their existing homepage is titled "About" and carries their own About copy. That copy is still
 * here, tidied for grammar and with macrons restored, and nothing has been added to it — no invented
 * differentiators, no stock warmth.
 *
 * WHAT IS FIRST DRAFT AND NEEDS THE MANAGER'S SIGN-OFF, flagged rather than shipped quietly: the
 * three "Why pearls" cards and their intro paragraph are the handoff's copy, not the centre's own
 * words, and the handoff says so itself. Everything else on this page came from them.
 */
export default function HomePage() {
  return (
    <>
      {/* --- The hero ------------------------------------------------------------- */}
      <section className="band-ocean hero">
        {/* Decorative and submerged; it moves on scroll and carries nothing. */}
        <div className="hero__glow" data-parallax="glow" aria-hidden="true" />

        <div className="band-ocean__inner wrap hero__inner">
          <div>
            <Eyebrow tone="ocean">Ōwairaka · Puketāpapa</Eyebrow>

            <h1>Nau mai — welcome to Little Pearls</h1>

            {/*
              THEIR OWN SENTENCE, GIVEN THE ROOM IT ASKS FOR. It was 13px of header microcopy under
              the logo. It is the organising idea of the entire design and now reads as one.
            */}
            <p className="hero__tagline">{CENTRE_FACTS.tagline}.</p>

            <p className="hero__intro">
              {CENTRE_FACTS.structure} childcare centres — a warm, nurturing, safe and affordable
              home-like environment for children {CENTRE_FACTS.ages} in Ōwairaka / Mt Albert and
              Puketāpapa / Mt Roskill.
            </p>

            {/*
              Both buttons above the fold at 1440×900, which is a constraint rather than a hope: the
              hero's bottom padding is what keeps the waterline off them, and the pearl column is
              beside this copy rather than above it for the same reason.
            */}
            <p className="hero__actions">
              <Link className="btn btn-invert" href="/enrolment">
                Enquire about a place
              </Link>
              <Link className="btn btn-onocean" href="/centres">
                Visit our centres
              </Link>
            </p>
          </div>

          {/*
            THE HERO PEARL. `painting` and not `atTheTable`, and the choice was made by opening all
            ten photographs against a 420px circle rather than by reading filenames.

            It is the only one the centre owns with a single subject, face-on, centred — everything
            else is a room or a group, and a group in a circle is a picture of somebody's shoulder.
            It also needs its highlight mirrored, or the sheen lands on the child's forehead and
            burns it out; that is a per-image field on the photograph itself. See `lib/photos.ts`.
          */}
          <div className="hero__pearl">
            {/*
              `min(420px, 78vw)` and not `420` — the responsive size is in the value because
              `--pearl-size` is an inline style and no media query can override one. At 420px flat
              this pearl forced the copy column out to 420px on a 390px phone and the heading was
              cut off mid-word, invisibly, because the band clips its own overflow.
            */}
            <Pearl photo={PHOTOS.painting} size="min(420px, 78vw)" parallax="heroPearl" priority />
          </div>
        </div>

        {/*
          The boat. The entire illustration budget — no fish, no bubbles, no gulls. Two motions on
          two elements because one element cannot carry two transforms; hidden below 640px, where
          there is not enough waterline for it to sail along without meeting the buttons.
        */}
        <div className="boat" data-parallax="boat" aria-hidden="true">
          <div className="boat__bob">
            <svg viewBox="0 0 120 84" width="74" height="52" aria-hidden="true" focusable="false">
              <path d="M56 8 L56 58 L18 58 Z" fill="rgba(255,255,255,0.88)" />
              <path d="M64 22 L64 58 L96 58 Z" fill="rgba(255,255,255,0.62)" />
              <path d="M10 62 L110 62 L96 78 L24 78 Z" fill="#0b3032" />
              <rect x="58" y="6" width="3" height="54" fill="#0b3032" />
            </svg>
          </div>
        </div>

        <Waves variant="hero" />
      </section>

      <div className="page">
        {/* --- Why pearls ---------------------------------------------------------- */}
        {/*
          WITHOUT THIS SECTION THE PEARLS ARE DECORATION. It is where the analogy is actually made,
          and it is the reason the design is a design rather than a texture.

          The copy is the handoff's first draft and is NOT the centre's own words — the only text on
          this site that is not. It needs the manager's sign-off before it is published; recorded
          here and in CONTENT-GAPS.md rather than left to be discovered.
        */}
        <section>
          <Eyebrow>Why pearls</Eyebrow>
          <h2 className="section-title">A pearl is made slowly, one layer at a time</h2>
          <p className="prose">
            No two are alike, and none of it is hurried. It is the closest thing we know to how a
            child grows here — a little at a time, in the care of people who know them well.
          </p>

          {/*
            The pearls grow 64 → 80 → 98 across the three cards. The layers accumulating, in the
            layout itself rather than only in the words.

            THERE IS NO TODDLER-ROOM PHOTOGRAPH. The centre's ten images cover the infant room and
            the preschool room but not the middle one, so the second card uses the play kitchen —
            which is a toddler-room fixture and is what "days of play" looks like. Substituting a
            real photograph of the right kind beats captioning a wrong room, and beats an empty
            pearl in the middle of three full ones.
          */}
          <div className="story">
            <article className="card story__card">
              <Pearl photo={PHOTOS.infantRoom} size={64} />
              <h3>Something singular arrives</h3>
              <p>
                Every child comes to us already themselves — their whānau, their language, their way
                of seeing the day. We start there, not with a programme.
              </p>
            </article>
            <article className="card story__card">
              <Pearl photo={PHOTOS.playKitchen} size={80} />
              <h3>Layer upon layer</h3>
              <p>
                Days of play, kai shared, a kaiako who notices. Nothing dramatic on its own;
                everything, gathered over years, is what learning turns out to be.
              </p>
            </article>
            <article className="card story__card">
              <Pearl photo={PHOTOS.preschoolRoom} size={98} />
              <h3>Something to treasure</h3>
              <p>
                A child who leaves us settled, curious and sure of themselves. That is the whole of
                the work, and it belongs to the family first.
              </p>
            </article>
          </div>
        </section>

        {/* --- Learning through play ------------------------------------------------ */}
        <hr className="rule" aria-hidden="true" />

        <section>
          <Eyebrow>Learning through play</Eyebrow>
          <h2 className="section-title">Play is how the day is spent</h2>
          <p className="prose">
            We recognise the importance of play, using spontaneous and planned moments to build on a
            child&rsquo;s existing knowledge and skills. Our programmes are guided by{' '}
            <strong>Te Whāriki</strong>, the New Zealand early childhood curriculum, and in our
            infant room by the Pikler and RIE approaches and the schema concept.
          </p>

          {/* Arched, because these are square — the shape only works on a square or portrait box,
              and it is the shape of their own ivy doorway and their own badge. */}
          <div className="photo-row">
            <Photo photo={PHOTOS.atTheTable} className="photo-arch" />
            <Photo photo={PHOTOS.writing} className="photo-arch" />
            <Photo photo={PHOTOS.playground} className="photo-arch" />
          </div>

          <p className="prose">
            <Link href="/philosophy">Read our philosophy</Link>
          </p>
        </section>

        {/* --- The rooms ------------------------------------------------------------ */}
        <hr className="rule" aria-hidden="true" />

        <section className="aside-grid">
          <div>
            <Photo photo={PHOTOS.preschoolRoom} showCaption />
          </div>
          <aside>
            <Eyebrow>Our rooms</Eyebrow>
            <h2 className="section-title">Three rooms, one unhurried pace</h2>
            {/*
              The pearl scale used a third time, here as age: 18 / 24 / 30px for Infant, Toddler and
              Preschool. Ages only — the ratios live on `/rooms` where there is room to state what
              they are a claim about, and repeating a staffing figure as a bullet on a homepage is
              how a qualified statement loses its qualification.
            */}
            <div className="room-list">
              {ROOMS.map((room, i) => (
                <div className="room-list__item" key={room.name}>
                  <span
                    className="room-list__dot"
                    style={{ width: 18 + i * 6, height: 18 + i * 6 }}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="room-list__name">{room.name}</div>
                    <div className="room-list__ages">{room.ages}</div>
                  </div>
                </div>
              ))}
            </div>
            <p>
              <Link href="/rooms">See the rooms</Link>
            </p>
          </aside>
        </section>

        {/* --- Food ----------------------------------------------------------------- */}
        <hr className="rule" aria-hidden="true" />

        {/*
          "A chef, not a delivery" was the title here and it is gone on the manager's own direction
          for the site's voice — plain and warm, nothing that scores a point off anybody. The
          comparison was doing exactly that.

          "Healthy Heart Award" replaces "reward programme": the proper name of the Heart Foundation
          programme, from the manager's enrolment email (2026-08-17), which also supplied the
          menu-on-a-visit sentence. Their words, not embellishment.
        */}
        <section>
          <Eyebrow>Food made on site</Eyebrow>
          <h2 className="section-title">A chef in the kitchen</h2>
          <p className="prose">
            A full-time on-site chef cooks for the children — hot meals at lunchtime, fresh baking
            in the mornings and afternoons, and fresh and dried fruit through the day. We take part
            in the Heart Foundation&rsquo;s Healthy Heart Award and our menu follows their
            guidelines; ask to see the menu when you visit.
          </p>

          {/* On the second ground. Ngā hononga is the centre's own emphasis, so it gets the one
              section on this page that is visibly set apart. */}
          <div className="band prose">
            <h3>Whānau are part of it</h3>
            <p>
              Education is a partnership between whānau and the centre. We celebrate that through
              parent-teacher meetings, family whānau days, dinners and seminars — and ngā hononga,
              relationships, are the key to quality education.
            </p>
          </div>
        </section>

        {/* --- Where we are --------------------------------------------------------- */}
        <hr className="rule" aria-hidden="true" />

        <section>
          <Eyebrow>Where we are</Eyebrow>
          <h2 className="section-title">Two centres, a few minutes apart</h2>
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
        </section>
      </div>
    </>
  );
}
