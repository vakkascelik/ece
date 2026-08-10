import Link from 'next/link';
import { HelpNote } from '../HelpNote';
import { tabDoc } from './tabs';

/**
 * The question mark beside a screen's own heading.
 *
 * Takes a route rather than prose, so the words come from `tabs.ts` and are the same
 * words `/help` shows for that screen. A page passing its own sentence here is how the
 * two copies start to differ.
 *
 * Renders nothing when a route has no entry. That is deliberate rather than a thrown
 * error: a missing paragraph is a gap in documentation, and taking a screen down over
 * one would be a far worse failure than the gap. `help.test.ts` asserts every navigable
 * route has an entry, so the gap is caught where it is cheap instead.
 */
export function TabHelp({ href }: { href: string }) {
  const doc = tabDoc(href);
  if (!doc) return null;

  return (
    <HelpNote label={doc.label}>
      <p>{doc.what}</p>
      <p>{doc.how}</p>
      {doc.limit && (
        <p>
          <strong>What it will not tell you:</strong> {doc.limit}
        </p>
      )}
      <p>
        <Link href="/help">All the screens, and what they are for</Link>
      </p>
    </HelpNote>
  );
}
