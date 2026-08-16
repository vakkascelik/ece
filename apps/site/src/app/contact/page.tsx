import type { Metadata } from 'next';
import Link from 'next/link';
import { CentreMap } from '../CentreMap';
import { Eyebrow } from '../Eyebrow';
import { PageBand } from '../PageBand';
import { CENTRES, CENTRE_FACTS } from '@/lib/centres';

export const metadata: Metadata = {
  title: 'Contact us',
  description:
    'Phone, email and addresses for Little Pearls Educare Centre in Ōwairaka / Mt Albert and ' +
    'Puketāpapa / Mt Roskill, Auckland.',
};

/**
 * Contact.
 *
 * Their version has both centres' details and a row of social icons. The details are carried over;
 * the social links are **not**, yet — their Twitter link predates X, their Facebook link is plain
 * HTTP, and neither those accounts nor the Flickr and Instagram ones could be confirmed as active
 * during research. A footer of dead links is worse than no footer, so they return once somebody
 * has opened each one. Recorded in CONTENT-GAPS.md.
 *
 * Their page also states hours nowhere — hours appear once, on the homepage. They are here too,
 * because "what time do you open" is why people open a contact page.
 *
 * A MAP EACH, as of 2026-08-07, replacing the bare "Open in maps" link. Nothing about the position
 * on third parties moved to allow it: the picture is fetched by this server and served from this
 * origin, so the CSP is byte-for-byte what it was. See `lib/staticMap.ts` for why that distinction
 * is the whole design and not a technicality.
 */
export default async function ContactPage() {
  return (
    <>
      <PageBand eyebrow="Get in touch" title="Contact us">
        If you have any questions, please send us an email or give us a call. We are open{' '}
        {CENTRE_FACTS.hours.toLowerCase()}.
      </PageBand>

      <div className="page">
        <section>
          <Eyebrow>Both centres</Eyebrow>
          <h2 className="section-title">Phone, email and where to find us</h2>
          <div className="grid">
            {CENTRES.map((centre) => (
              <div className="card" key={centre.path}>
                {/*
                  `<h3>`, not `<h2>`. These sit under the section heading above, and the footer
                  carries each centre's name as a `<p class="foot-head">` for the same reason — a
                  heading outline that lists "Ōwairaka / Mt Albert" twice at the same level is one
                  nobody can navigate by. That defect was fixed once already; the restructure in this
                  pass is exactly the kind of change that reintroduces it.
                */}
                <h3 style={{ marginTop: 0 }}>{centre.name}</h3>
                <dl className="facts">
                  <dt>Phone</dt>
                  <dd>
                    <a href={`tel:${centre.phoneHref}`}>{centre.phone}</a>
                  </dd>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${centre.email}`}>{centre.email}</a>
                  </dd>
                  <dt>Address</dt>
                  <dd>
                    {centre.street}
                    <br />
                    {centre.suburb} {centre.postcode}
                  </dd>
                </dl>
                {/* The picture drops out if there is no map to show; the links under it do not. */}
                <CentreMap centre={centre} />
              </div>
            ))}
          </div>
        </section>

        <hr className="rule" aria-hidden="true" />

        <section className="prose">
          <Eyebrow>Anything else</Eyebrow>
          <h2 className="section-title">Working with us</h2>
          <p>
            For a place, see <Link href="/enrolment">enrolment</Link>. To join the team, email{' '}
            <a href={`mailto:${CENTRE_FACTS.careersEmail}`}>{CENTRE_FACTS.careersEmail}</a>.
          </p>

          {/*
            THE "FAMILIES AND KAIAKO" SIGN-IN SECTION IS GONE. The site does not refer to the app at
            all — see the note in the masthead in `layout.tsx`.

            What went with it is the sentence "Access comes from the centre inviting you — there is
            no sign-up", which was doing real work: it stopped a parent hunting this page for a
            registration form that does not exist. That is no longer a question this page raises,
            because nothing on it now suggests there is an app to register for. If the link returns,
            that sentence returns with it.
          */}
        </section>
      </div>
    </>
  );
}
