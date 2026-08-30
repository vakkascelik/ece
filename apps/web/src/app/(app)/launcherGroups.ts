import { can, type Capability, type MemberRole } from '@ece/core';
import type { NavIconName } from './NavIcon';

/**
 * The overview's launcher: the rail's six groups, as cards somebody can hit.
 *
 * WHY THIS EXISTS
 *
 * The centre's owner signed in, looked at the rail, and said the product should be
 * "sub apps" rather than everything at once. He was describing something already
 * measured and already written down: `globals.css` records the rail at **1536px tall**
 * for an owner at 1440×900, and concludes that "twenty-four links and six headings do
 * not fit on a laptop and were never going to". `NavGroup` names the same asymmetry —
 * thirteen links for an educator is workable, twenty-something for an owner is not.
 *
 * WHY IT IS NOT A REPLACEMENT FOR THE RAIL, AND NOT THE TOP OF THE PAGE
 *
 * `page.tsx` opens by recording what this screen used to be — a count of who has a
 * login — and why that was worse than empty: "the screen every person in this product
 * lands on answered no question they arrived with". A launcher is an inventory, and an
 * inventory is what that change removed. So it sits *below* the ratio and below what
 * needs attention: the screen still answers "what needs doing" before it answers
 * "where is everything". Putting it above them buys discoverability with the one item
 * this page exists to surface.
 *
 * WHY THE GROUPS ARE THE RAIL'S GROUPS, IN THE RAIL'S ORDER
 *
 * A second arrangement of the same twenty-two screens would be a second thing to learn
 * and a second thing to keep in step. These are the same six words, the same order and
 * the same `can()` conditions — what changes is the size of the target and the fact
 * that the screens inside a group are named where the rail only names the group.
 *
 * WHY `/` IS NOT IN IT
 *
 * It is the page the launcher is on.
 *
 * WHY A GROUP WITH NO LINKS RENDERS NOTHING
 *
 * `NavGroup`'s rule, and `roles.spec.ts` is emphatic about why: a heading is a
 * disclosure. "Money" over an empty list tells an educator that money screens exist,
 * which is most of what withholding the links protects. `launcherFor` drops the group
 * rather than the links.
 */
export type LauncherLink = {
  href: string;
  label: string;
  /** Absent means every role that reaches the launcher at all may see it. */
  capability?: Capability;
};

export type LauncherGroup = {
  label: string;
  icon: NavIconName;
  /**
   * One line saying what the group is for.
   *
   * Written from the reasoning already in `layout.tsx`'s comments rather than invented,
   * because those sentences are why the grouping is what it is — "documents somebody
   * files, not a screen somebody watches" is the argument that put Incidents under
   * Records instead of Today, and it is the most useful thing to tell somebody who is
   * looking for it.
   */
  blurb: string;
  links: readonly LauncherLink[];
};

export const LAUNCHER_GROUPS: readonly LauncherGroup[] = [
  {
    label: 'Today',
    icon: 'attendance',
    blurb: 'What is happening in the building right now.',
    links: [
      { href: '/attendance', label: 'Attendance', capability: 'recordDailyPractice' },
      { href: '/sleep', label: 'Sleep checks', capability: 'recordDailyPractice' },
      { href: '/visitors', label: 'Visitors', capability: 'recordDailyPractice' },
    ],
  },
  {
    label: 'Tamariki',
    icon: 'children',
    blurb: 'The children, and what their whānau see.',
    links: [
      { href: '/children', label: 'Children' },
      { href: '/posts', label: 'Posts' },
      { href: '/messages', label: 'Messages' },
    ],
  },
  {
    label: 'Records',
    icon: 'checklists',
    blurb: 'Documents somebody files, rather than a screen somebody watches.',
    links: [
      { href: '/incidents', label: 'Incidents', capability: 'recordDailyPractice' },
      { href: '/facilities', label: 'Site safety', capability: 'recordDailyPractice' },
      { href: '/checklists', label: 'Checklists', capability: 'recordDailyPractice' },
      { href: '/tasks', label: 'Tasks', capability: 'recordDailyPractice' },
      { href: '/excursions', label: 'Excursions', capability: 'recordDailyPractice' },
    ],
  },
  {
    label: 'People',
    icon: 'people',
    blurb: 'Who works here, and who is asking to.',
    links: [
      { href: '/staff', label: 'Staff', capability: 'recordDailyPractice' },
      { href: '/roster', label: 'Roster', capability: 'recordDailyPractice' },
      { href: '/members', label: 'People', capability: 'manageMembers' },
      { href: '/enquiries', label: 'Enquiries', capability: 'manageCentre' },
      { href: '/applications', label: 'Applications', capability: 'manageRecruitment' },
    ],
  },
  {
    label: 'Money',
    icon: 'funding',
    blurb: 'What the Crown owes this centre, and what families do.',
    links: [
      { href: '/funding', label: 'Funding', capability: 'manageCentre' },
      { href: '/billing', label: 'Accounts', capability: 'manageCentre' },
      { href: '/reports', label: 'Reports', capability: 'manageCentre' },
    ],
  },
  {
    label: 'Centre',
    icon: 'compliance',
    blurb: 'Evidence for a reviewer, this centre’s own details, and the broadcast.',
    links: [
      { href: '/compliance', label: 'Compliance', capability: 'manageCentre' },
      { href: '/settings', label: 'Settings', capability: 'manageCentre' },
      { href: '/broadcast', label: 'Emergency broadcast', capability: 'broadcastEmergency' },
    ],
  },
];

/**
 * The groups this role is offered, empty groups removed.
 *
 * Presentation only, exactly as the rail is: `requireCapability` on each destination and
 * the policies underneath it are what refuse. A link drawn here that the caller cannot
 * open would be a usability defect, not a breach — and a link *withheld* here that they
 * can open is the same defect in the other direction, which is why this reads the same
 * `can()` the rail does rather than a list of its own.
 */
export function launcherFor(role: MemberRole): LauncherGroup[] {
  return LAUNCHER_GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => !link.capability || can(role, link.capability)),
  })).filter((group) => group.links.length > 0);
}
