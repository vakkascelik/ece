import Link from 'next/link';

/**
 * Reached when a page calls `notFound()`, which in this app has two quite different causes
 * that must look identical.
 *
 * A child record is `notFound()` both when the id does not exist **and** when the caller is
 * not allowed to see it — because RLS returns no row either way and the query layer cannot
 * tell them apart. That is deliberate: distinguishing them would turn this screen into a way
 * to test whether a given child is enrolled at a centre, one URL at a time.
 *
 * So the wording has to be true of both. "Not found" is true of both. "You do not have
 * permission" would leak the very thing the design refuses to leak, and "this child does not
 * exist" would be a lie in the case that matters.
 *
 * Without this file Next serves its own unstyled 404 — outside the shell, with no navigation
 * — which for a member of staff mid-task reads as the product having broken rather than as a
 * bad link.
 */
export default function AppNotFound() {
  return (
    <>
      <h1>Not found</h1>
      <p className="sub">
        This page does not exist, or it is not part of the centre you are looking at.
      </p>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          If you followed a link from somewhere in the app, that is worth telling us about. If
          you were sent this address by someone at another centre, records do not cross between
          centres — they would need to invite you.
        </p>
        <p style={{ marginBottom: 0 }}>
          <Link href="/">Back to the overview</Link>
        </p>
      </div>
    </>
  );
}
