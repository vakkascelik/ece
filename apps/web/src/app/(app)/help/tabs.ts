import type { Capability } from '@ece/core';

/**
 * What every tab is, how it works, and what it will not tell you — written once.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE COPY, BECAUSE TWO WOULD DIVERGE AND NOBODY WOULD NOTICE
 *
 * The same sentences appear in two places: the question mark beside a screen's heading,
 * and the documentation page at `/help`. Written twice they would drift, and the drift
 * would be invisible — nothing renders them side by side, so the first person to read
 * both would be a user finding two different answers to the same question.
 *
 * This repo has been here before. The design tokens were a hand-maintained copy in two
 * files that had *already* silently diverged before `tokens:check` existed — the
 * background colour and the muted grey differed, and the tests were asserting one set
 * while the screens rendered the other. The fix was one source and a check, which is the
 * same shape as this: one array, imported by both readers.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE THIRD FIELD IS THE ONE WORTH HAVING
 *
 * `limit` is what the screen will not tell you, and it is copied from the behaviour it
 * describes rather than composed: the ratio wording from `RatioBanner`, the funding
 * wording from the funding page, the broadcast wording from `BroadcastForm`. A manager
 * who believes the ratio block has confirmed they are legally covered is worse off than
 * one who never opened the screen, and documentation that dropped those sentences while
 * summarising would be the one place a reader is told the comfortable version.
 *
 * If a screen's caveat changes, the entry here is wrong and should be corrected with it.
 */

export interface TabDoc {
  href: string;
  label: string;
  /** Null when everybody with a login sees it. */
  capability: Capability | null;
  what: string;
  how: string;
  /** The sentence the screen itself is careful about. Omitted where there is nothing to warn. */
  limit?: string;
}

/*
  Ordered as the sidebar orders them, so somebody reading with the nav open can follow
  down the page. `Your tamariki` and `Pānui` are the parent-facing names for `/children`
  and `/posts` — this page is reachable by a parent, so both names appear.
*/
export const TABS: TabDoc[] = [
  {
    href: '/',
    label: 'Overview',
    capability: null,
    what: 'The centre’s front page: who has access, and what the product holds so far.',
    how: 'Nothing is entered here. It is a summary of the other screens.',
  },
  {
    href: '/children',
    label: 'Children',
    capability: null,
    what: 'Everyone enrolled, and how many are under two.',
    how: 'Open a child for their health notes, booked days, consents, whānau, enrolment and custody information. A parent opening this same link sees their own tamariki and nobody else’s. The under-two count drives the ratio and is worked out from dates of birth, which are required when a child is enrolled.',
  },
  {
    href: '/posts',
    label: 'Posts',
    capability: null,
    what: 'What whānau see. Drafts are visible only to kaiako.',
    how: 'A post stays a draft until it is published. Photographs of a child can only be attached where a consent decision has been recorded for that child.',
  },
  {
    href: '/messages',
    label: 'Messages',
    capability: null,
    what: 'Conversations with whānau.',
    how: 'A thread can be about a particular child, and then the whānau who can read it are that child’s guardians.',
  },
  {
    href: '/notifications',
    label: 'Notifications',
    capability: null,
    what: 'Your own inbox. Only you can see this list.',
    how: 'An emergency broadcast sent by an owner or manager arrives here.',
  },
  {
    href: '/attendance',
    label: 'Attendance',
    capability: 'recordDailyPractice',
    what: 'Today’s roll — who is here, who is not — and the ratio for the room.',
    how: 'Sign in and Sign out are separate buttons rather than one toggle, because a mis-tap on a toggle records the opposite of what happened. A tap is saved on the device first and sent when there is a connection, so the roll keeps working with the wifi down; a row that has not been sent yet says “Waiting to send”.',
    limit:
      'The ratio figures have not been checked against the regulations by anybody. Treat them as a prompt, not as confirmation you are compliant. The adult count comes from who has signed in on the Staff screen — if nobody signs in, it reads zero adults and shows a breach.',
  },
  {
    href: '/incidents',
    label: 'Incidents',
    capability: 'recordDailyPractice',
    what: 'Injuries, illness, behaviour and near misses.',
    how: 'A report is a draft until it is finalised, and a family sees it only once it has been. An amendment adds a correcting entry rather than editing the original, because after an incident the question is what was recorded at the time.',
  },
  {
    href: '/sleep',
    label: 'Sleep checks',
    capability: 'recordDailyPractice',
    what: 'Children signed in today, longest since a check first.',
    how: 'Recording a check asks whether the child was breathing, and there is no preselected answer — the most consequential claim on the screen should not be recorded by nobody answering it.',
    limit:
      'Unless your centre has stated a checking interval in Settings, this screen shows how long ago each child was checked and passes no judgement on whether that is often enough. It does not know what often enough means until somebody tells it.',
  },
  {
    href: '/facilities',
    label: 'Site safety',
    capability: 'recordDailyPractice',
    what: 'Hazards, emergency drills and daily checks.',
    how: 'A hazard stays on the register until it is resolved.',
    limit:
      'The daily checks list covers a fixed recent window. An area with no check shown has not been recorded in that time — which is not the same as having been checked and found fine.',
  },
  {
    href: '/visitors',
    label: 'Visitors',
    capability: 'recordDailyPractice',
    what: 'Who is in the building who is not a child or a staff member, and who has been.',
    how: 'A visitor is signed in at the door and signed out when they leave. A name on its own is accepted — the door is not a form review.',
  },
  {
    href: '/excursions',
    label: 'Excursions',
    capability: 'recordDailyPractice',
    what: 'Outings, and who is going on them.',
    how: 'The plan and the party are recorded before the outing, so the list of who left the building exists while they are out of it.',
  },
  {
    href: '/staff',
    label: 'Staff',
    capability: 'recordDailyPractice',
    what: 'Who works here, and who is here today.',
    how: 'Somebody can be on this list without having a login — a reliever who never uses the product still counts toward the ratio when they sign in.',
    limit:
      'Your ratio is computed from this list. If nobody signs in, it reads zero adults and shows a breach.',
  },
  {
    href: '/roster',
    label: 'Roster',
    capability: 'recordDailyPractice',
    what: 'Who is planned to be on, and whether that covers who is booked in.',
    how: 'It reads the roster forward against the bookings for the same days, so a gap can still be acted on.',
    limit:
      'These figures use the same unverified ratio tables as the attendance screen. Treat a covered day as an indication, not a clearance.',
  },
  {
    href: '/members',
    label: 'People',
    capability: 'manageMembers',
    what: 'Who can see and change this centre.',
    how: 'Access is by invitation — there is no public signup. Revoking somebody’s membership ends their access immediately, including a parent’s access to their own child’s record.',
  },
  {
    href: '/enquiries',
    label: 'Enquiries',
    capability: 'manageCentre',
    what: 'Enrolment enquiries from the public website form.',
    how: 'Move an enquiry along as you deal with it. Marking one “enrolled” is a label on the row.',
    limit:
      'There is deliberately no button that turns an enquiry into a child. Creating the child, the whānau and the enrolment is done by hand on the other screens, after a conversation.',
  },
  {
    href: '/applications',
    label: 'Applications',
    capability: 'manageRecruitment',
    what: 'People who have applied to work here, from the public careers page.',
    how: 'Applications arrive open and are closed once dealt with. Only owners and managers can see this.',
  },
  {
    href: '/compliance',
    label: 'Compliance',
    capability: 'manageCentre',
    what: 'Staff records and their expiry dates, recent ratio history, licensing criteria, and the evidence on file.',
    how: 'Expiring records are flagged before they lapse. The binder is a printable document assembled from what is recorded here.',
    limit:
      'Nothing being flagged is not the same as nothing being wrong — a record nobody has entered cannot expire. The binder states what the data shows; it does not claim the centre is compliant, and it is not a submission to anybody.',
  },
  {
    href: '/funding',
    label: 'Funding',
    capability: 'manageCentre',
    what: 'Attendance turned into funded hours for a period, ready to be entered elsewhere.',
    how: 'Attended is what the sign-in record shows. Funded is that figure with the caps applied and any day whose record is incomplete removed — so funded is never more than attended. A day with a broken record is excluded rather than estimated, and the screen refuses to look final while one exists.',
    limit:
      'This product does not submit anything to the Ministry of Education. It prepares figures a person then enters.',
  },
  {
    href: '/billing',
    label: 'Accounts',
    capability: 'manageCentre',
    what: 'What families still owe on invoices this centre has issued.',
    how: 'Balances come from the payments recorded against each invoice, not from its status — so an invoice marked paid that has not been paid still appears here.',
    limit:
      'There is no payment processing. Recording a payment records that one happened; it does not take money.',
  },
  {
    href: '/reports',
    label: 'Reports',
    capability: 'manageCentre',
    what: 'Occupancy day by day, attendance trends week by week, and what became of every enquiry.',
    how: 'Occupancy needs the centre’s licensed places, which is stated in Settings. Until it is, the screen reports attendance without a percentage rather than inventing a denominator.',
    limit:
      'The daily average is over the days that had any attendance, not over all thirty. Averaging closed days in would report roughly a third of the truth.',
  },
  {
    href: '/settings',
    label: 'Settings',
    capability: 'manageCentre',
    what: 'The centre’s own details: name, Ministry service number, timezone, licensed places, sleep-check interval and ratio source.',
    how: 'Leaving the sleep-check interval empty stores nothing rather than zero, and the sleep screen then passes no judgement. Stating one turns that screen’s elapsed times into overdue warnings.',
  },
  {
    href: '/broadcast',
    label: 'Emergency broadcast',
    capability: 'broadcastEmergency',
    what: 'One message to every family at this centre at once.',
    how: 'It sends the instant you press Send, and there is no undo.',
    limit:
      'Today “broadcast” means an entry each family can read on their own Notifications page. It does not yet send a push notification, an email or a text message. If the building is being evacuated, this is not the fastest way to reach anybody.',
  },
  {
    href: '/account',
    label: 'Account',
    capability: null,
    what: 'Your own login — your name and your password.',
    how: 'This is yours, not the centre’s. Changing it here changes it everywhere you sign in.',
  },
];

/** The entry for a route, or undefined when that screen has no documentation yet. */
export function tabDoc(href: string): TabDoc | undefined {
  return TABS.find((t) => t.href === href);
}
