import Link from 'next/link';
import { PageBand } from './PageBand';
import { CENTRES } from '@/lib/centres';

/**
 * A 404 that helps rather than apologises.
 *
 * Their old site's URLs were Muse exports — `/our-centres.html`, `/enrolment---fees.html` — so
 * every existing link, bookmark and search result will land here after the switchover. That makes
 * this page a working part of the migration rather than an edge case: it names the things somebody
 * was most likely looking for.
 */
export default function NotFound() {
  return (
    <>
      <PageBand eyebrow="Page not found" title="We couldn’t find that page">
        Our website has been rebuilt, so an older link may no longer work. Here is where things are
        now.
      </PageBand>

      <div className="page prose">
      <ul>
        <li>
          <Link href="/enrolment">Enrolment and fees</Link>
        </li>
        <li>
          <Link href="/centres">Our centres</Link> —{' '}
          {CENTRES.map((centre, i) => (
            <span key={centre.path}>
              {i > 0 && ' and '}
              <Link href={`/centres/${centre.path}`}>{centre.shortName}</Link>
            </span>
          ))}
        </li>
        <li>
          <Link href="/rooms">Our rooms</Link>
        </li>
        <li>
          <Link href="/philosophy">Our philosophy</Link>
        </li>
        <li>
          <Link href="/careers">Careers</Link>
        </li>
        <li>
          <Link href="/contact">Contact us</Link>
        </li>
      </ul>
      </div>
    </>
  );
}
