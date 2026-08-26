import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CENTRE_FACTS, ROOMS } from '../centres';

/**
 * The centre's opening hours and age range are two facts held in four places: `CENTRE_FACTS`, the
 * `<meta name="description">` in `layout.tsx`, the rooms page description, and a JSON-LD
 * `openingHours` block that Google reads for the knowledge panel.
 *
 * They drifted the moment they were first edited: on 2026-08-26 the centre corrected the day to
 * 7.30am–5.30pm and the youngest age to 6 months, and a change to `CENTRE_FACTS` alone would have
 * left three files quietly telling parents the old figures — including the structured data, which
 * is the copy a parent sees in search results without ever visiting the site.
 *
 * Nothing else in the build compares them. Typecheck cannot: they are strings.
 */

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

/** `7.30am to 5.30pm` -> `07:30-17:30`, the shape schema.org wants. */
function toSchemaHours(human: string): string {
  const times = [...human.matchAll(/(\d{1,2})\.(\d{2})\s*(am|pm)/gi)];
  expect(times, `could not parse two times out of "${human}"`).toHaveLength(2);
  const fmt = (m: RegExpMatchArray) => {
    let h = Number(m[1]);
    const isPm = m[3].toLowerCase() === 'pm';
    if (isPm && h !== 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
  };
  return `${fmt(times[0])}-${fmt(times[1])}`;
}

describe('centre facts stay in one voice', () => {
  it('the youngest room starts at the same age the centre advertises', () => {
    const youngest = CENTRE_FACTS.ages.match(/^(\d+\s+\w+)/)?.[1];
    expect(youngest, 'CENTRE_FACTS.ages should start with an age').toBeTruthy();
    expect(ROOMS[0].ages.startsWith(youngest!), `Infant room is "${ROOMS[0].ages}", centre says "${CENTRE_FACTS.ages}"`).toBe(true);
  });

  it('the oldest room ends at the same age the centre advertises', () => {
    const oldest = CENTRE_FACTS.ages.match(/(\d+\s+years)$/)?.[1];
    expect(oldest).toBeTruthy();
    expect(ROOMS[ROOMS.length - 1].ages.endsWith(oldest!)).toBe(true);
  });

  it('the JSON-LD opening hours match the human ones', () => {
    // What a parent sees in a Google knowledge panel, which is the copy least likely to be
    // eyeballed by anyone on the team.
    const page = read('app/centres/[centre]/page.tsx');
    const jsonLd = page.match(/openingHours:\s*'Mo-Fr ([\d:-]+)'/)?.[1];
    expect(jsonLd, 'no openingHours found in the centre page JSON-LD').toBeTruthy();
    expect(jsonLd).toBe(toSchemaHours(CENTRE_FACTS.hours));
  });

  it('the site description carries the current hours and ages', () => {
    const layout = read('app/layout.tsx');
    // `;\r?\n` — this repo is checked out with CRLF on Windows, and a bare `;\n` matched nothing.
    const description = layout.match(/const DESCRIPTION =([\s\S]*?);\r?\n/)?.[1] ?? '';
    expect(description, 'no DESCRIPTION const found in layout.tsx').not.toBe('');

    // Compared on the numbers rather than the whole phrase: the description is prose and may say
    // "weekdays 7.30am to 5.30pm" where CENTRE_FACTS says "Weekdays, 7.30am to 5.30pm".
    for (const fragment of [CENTRE_FACTS.ages, ...CENTRE_FACTS.hours.split(', ').slice(1)]) {
      expect(description.includes(fragment), `layout DESCRIPTION is missing "${fragment}"`).toBe(true);
    }
  });

  it('the rooms page description names the infant room correctly', () => {
    const rooms = read('app/rooms/page.tsx');
    expect(rooms.includes(`Infant (${ROOMS[0].ages})`), `rooms metadata disagrees with ROOMS[0].ages = "${ROOMS[0].ages}"`).toBe(true);
  });
});
