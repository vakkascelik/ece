import { can, type Capability, type MemberRole } from '@ece/core';

/**
 * The child record's tabs, as routes.
 *
 * WHY ROUTES AND NOT `useState`
 *
 * So a manager can send a colleague straight to the health tab. A tab held in state cannot
 * be sent to anybody, cannot be bookmarked, and loses its place on every refresh — and this
 * is the record somebody links to in a message that starts "have a look at".
 *
 * WHICH OF THE HANDOVER'S SIX ARE HERE, AND WHICH IS NOT
 *
 * The handover names Overview, Whānau, Health, Learning, Attendance and Documents. Five of
 * those are groupings of panels that already exist. **Learning is not built**, because there
 * is nothing to put in it: nothing in this product associates a post, a learning moment or a
 * curriculum strand with one child on a page the child's record could read. Building it means
 * building a per-child feed, which is a feature and not a restyle, and an empty tab labelled
 * "Learning" is a promise the product does not keep — the same objection this record already
 * makes to an empty "Custody" heading.
 *
 * WHY THE CAPABILITY GATE IS HERE AND CURRENTLY LETS EVERYTHING THROUGH
 *
 * The handover asks for the tabs a guardian's capabilities cannot fill to be hidden. With the
 * mapping below there are none: a parent legitimately reads their own child's whānau, health,
 * attendance and paperwork, and the panels inside each already gate what they show — custody
 * is absent from Whānau for anybody without `viewCustody`, and the details form is read-only
 * without `manageChildren`. So `capability` is the mechanism, honestly reporting that it
 * currently excludes nobody, rather than a filter invented to make a sentence true.
 *
 * It is not the boundary. RLS decides what the queries return; this decides what is offered.
 */
export interface RecordTab {
  /** The URL segment. The overview is the record's own route and has none. */
  slug: string | null;
  label: string;
  /** Withheld from a role that lacks this. `null` means everybody who can open the record. */
  capability: Capability | null;
}

export const RECORD_TABS: readonly RecordTab[] = [
  { slug: null, label: 'Overview', capability: null },
  { slug: 'whanau', label: 'Whānau', capability: null },
  { slug: 'health', label: 'Health', capability: null },
  { slug: 'attendance', label: 'Attendance', capability: null },
  { slug: 'documents', label: 'Documents', capability: null },
];

export function tabsFor(role: MemberRole): RecordTab[] {
  return RECORD_TABS.filter((t) => t.capability === null || can(role, t.capability));
}

/** The slugs `[tab]` will accept. Anything else is a 404 rather than an empty tab. */
export const TAB_SLUGS = RECORD_TABS.filter((t) => t.slug !== null).map((t) => t.slug as string);

export function hrefFor(childId: string, slug: string | null): string {
  return slug === null ? `/children/${childId}` : `/children/${childId}/${slug}`;
}
