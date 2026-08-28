/**
 * The rail's icons.
 *
 * WHY THEY ARE DRAWN HERE AND NOT INSTALLED
 *
 * The handover forbids an icon package, and it is right to for this rail: twenty-four glyphs
 * is a few kilobytes of hand-written path data against a dependency that ships several hundred
 * and updates on somebody else's schedule. These are server-rendered into the HTML, so they
 * cost nothing on the JavaScript budget and nothing on the CSS one.
 *
 * Not text glyphs either, unlike the flags. `▲` and `✓` are text on purpose over there —
 * they survive a copy-paste into an email and need no asset — but a *navigation* icon drawn
 * from a font renders as colour emoji on Windows and as something else on macOS, at a size
 * nobody chose. State needs to survive being copied; a nav icon needs to look the same on
 * every tablet in the centre.
 *
 * EVERY ONE IS `aria-hidden`, AND THE LABEL IS NOT OPTIONAL
 *
 * The word is the destination; the icon is a landmark for somebody who has already learned
 * it. This is the same rule the flags follow — never colour alone, never a glyph alone — and
 * it is why the icon is a prop on `NavLink` rather than something a caller could pass
 * *instead* of a label.
 *
 * Worth being honest about what icons buy: Attendance, Messages and Settings have shapes
 * everybody already knows, and Compliance, Site safety and Enquiries do not. For those three
 * the icon is a position marker rather than a picture of the idea — useful for finding the
 * same row twice, not for working out what it means the first time. That is the argument for
 * keeping the labels at full size rather than shrinking them now that there is a glyph.
 */
export type NavIconName =
  | 'overview'
  | 'attendance'
  | 'sleep'
  | 'visitors'
  | 'children'
  | 'posts'
  | 'messages'
  | 'incidents'
  | 'facilities'
  | 'tasks'
  | 'checklists'
  | 'excursions'
  | 'staff'
  | 'roster'
  | 'people'
  | 'enquiries'
  | 'applications'
  | 'funding'
  | 'accounts'
  | 'reports'
  | 'compliance'
  | 'settings'
  | 'broadcast'
  | 'account'
  | 'notifications'
  | 'help';

/**
 * One 24px grid, stroked rather than filled, so every glyph carries the same weight beside
 * 15px text and inherits the link's colour — including the accent the current row is painted
 * in, which a filled two-tone icon set could not do without a second colour token.
 */
const PATHS: Record<NavIconName, React.ReactNode> = {
  overview: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
      <path d="M9.5 20v-6h5v6" />
    </>
  ),
  attendance: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V3h6v1.5" />
      <path d="m8.8 13 2.4 2.4 4.2-4.6" />
    </>
  ),
  sleep: <path d="M20 14.4A8.5 8.5 0 1 1 9.6 4a6.8 6.8 0 0 0 10.4 10.4z" />,
  visitors: (
    <>
      <path d="M6.5 21V4.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5V21" />
      <path d="M4 21h16" />
      <path d="M14.5 12.2v.1" />
    </>
  ),
  children: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </>
  ),
  posts: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.4" />
      <path d="m3.5 16.5 4.5-4.5 4 4 3-3 5.5 5.5" />
    </>
  ),
  messages: <path d="M20 15a2 2 0 0 1-2 2H8.5L4 20.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />,
  incidents: (
    <>
      <path d="M12 4.5 20.5 19.5h-17z" />
      <path d="M12 10v4" />
      <path d="M12 16.9v.1" />
    </>
  ),
  facilities: <path d="M12 3.2 19.5 6v6c0 4.8-3.3 7.6-7.5 8.8C7.8 19.6 4.5 16.8 4.5 12V6z" />,
  tasks: (
    <>
      <path d="M4.5 7.5h15" />
      <path d="M4.5 12h15" />
      <path d="M4.5 16.5h9" />
    </>
  ),
  checklists: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M8.5 9.5l2 2 4-4.5" />
      <path d="M8.5 15.5h7" />
    </>
  ),
  excursions: (
    <>
      <path d="M12 20.5S18.5 15 18.5 10a6.5 6.5 0 1 0-13 0c0 5 6.5 10.5 6.5 10.5z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  staff: (
    <>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2" />
      <path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7" />
      <path d="M3 13h18" />
    </>
  ),
  roster: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10.5h17" />
      <path d="M8 3.5v4" />
      <path d="M16 3.5v4" />
    </>
  ),
  people: (
    <>
      <circle cx="9.2" cy="8.2" r="3.2" />
      <path d="M3.5 19.5a5.7 5.7 0 0 1 11.4 0" />
      <path d="M16.2 5.4a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.6 14.4a5.7 5.7 0 0 1 2.9 5.1" />
    </>
  ),
  enquiries: (
    <>
      <path d="M5.5 5h13l2 8v5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-5z" />
      <path d="M3.5 13h4l1.4 2.8h6.2L16.5 13h4" />
    </>
  ),
  applications: (
    <>
      <path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z" />
      <path d="M14 3v4h4" />
      <path d="M9 13h6" />
      <path d="M9 16.5h4" />
    </>
  ),
  funding: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M6 12h.1" />
      <path d="M18 12h.1" />
    </>
  ),
  accounts: (
    <>
      <path d="M6 3h12v18l-2.4-1.6L13.2 21l-2.4-1.6L8.4 21 6 19.4z" />
      <path d="M9.5 8.5h5" />
      <path d="M9.5 12.5h5" />
    </>
  ),
  reports: (
    <>
      <path d="M4 3.5v17h16" />
      <path d="M8 17v-4.5" />
      <path d="M12.5 17V8" />
      <path d="M17 17v-6.5" />
    </>
  ),
  compliance: (
    <>
      <circle cx="12" cy="9.2" r="5.7" />
      <path d="m8.6 13.9-1.1 6.6 4.5-2.4 4.5 2.4-1.1-6.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.9v2.4" />
      <path d="M12 18.7v2.4" />
      <path d="M2.9 12h2.4" />
      <path d="M18.7 12h2.4" />
      <path d="m6.4 6.4 1.7 1.7" />
      <path d="m15.9 15.9 1.7 1.7" />
      <path d="m17.6 6.4-1.7 1.7" />
      <path d="m8.1 15.9-1.7 1.7" />
    </>
  ),
  broadcast: (
    <>
      <path d="M4 10.2v3.6a1 1 0 0 0 1 1h2.2L14 19V5l-6.8 4.2H5a1 1 0 0 0-1 1z" />
      <path d="M17.4 9.2a4 4 0 0 1 0 5.6" />
      <path d="M19.8 6.8a7.4 7.4 0 0 1 0 10.4" />
    </>
  ),
  account: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.3 18.7a6.6 6.6 0 0 1 11.4 0" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5z" />
      <path d="M10.2 19a2.1 2.1 0 0 0 3.6 0" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.7 9.6a2.4 2.4 0 1 1 3.2 2.3c-.7.3-1 .8-1 1.5v.3" />
      <path d="M11.9 17.2v.1" />
    </>
  ),
};

export function NavIcon({ name }: { name: NavIconName }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      /*
        `aria-hidden` and `focusable="false"`. The second is not redundant: IE and some older
        engines put SVG in the tab order regardless of the first, and a rail with twenty-four
        extra tab stops is a rail a keyboard user gives up on. Cheap insurance for a file that
        renders on every screen.
      */
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
