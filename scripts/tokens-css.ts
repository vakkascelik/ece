/**
 * Generates CSS custom properties from `@ece/core/tokens`, for every app that needs them.
 *
 * The tokens were already the single source for the mobile theme, which reads them
 * as data. The web app restated them by hand in `globals.css` — so the accent green
 * existed twice, the contrast test asserted one copy, and the screens rendered the
 * other. That is the sort of duplication that stays correct right up until somebody
 * adjusts a colour.
 *
 *   npm run tokens          write the files
 *   npm run tokens:check    fail if any is out of date (CI)
 *
 * `--check` rather than generating during the build: a build step that rewrites a
 * tracked file produces diffs nobody asked for, and the failure mode of a stale
 * committed file is a puzzling visual mismatch. Better for CI to say so.
 *
 * TWO OUTPUTS, NOT ONE
 *
 * `apps/web` gets the platform's palette. `apps/site` — Little Pearls' public website — gets
 * *their* palette, and the same spacing, radii, type scale, targets and motion, because those
 * are structure rather than identity and there is no reason for two surfaces to disagree about
 * what "the 15px step" means.
 *
 * This script used to hardcode one output path, and `--check` compared exactly one file. A
 * second consumer added under that shape would have drifted unguarded — which is precisely the
 * failure the generator exists to prevent, so the shape changed before the consumer arrived.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  brandLittlePearls,
  color,
  contrastRatio,
  CONTRAST_PAIRS,
  font,
  LITTLE_PEARLS_CONTRAST_PAIRS,
  motion,
  radius,
  space,
  target,
} from '@ece/core';

interface Surface {
  /** Path relative to the repo root. */
  out: string;
  /** Which colour set this surface uses, and what to call it in the header. */
  palette: Record<string, string>;
  paletteName: string;
  /** The pairs whose measured ratios are printed as a footer comment. */
  pairs: readonly { fg: string; bg: string; min: number; label: string }[];
  /** Extra lines for the generated header, explaining anything surface-specific. */
  note?: string[];
}

const SURFACES: Surface[] = [
  {
    out: 'apps/web/src/app/tokens.css',
    palette: color,
    paletteName: 'the platform palette (packages/core/src/tokens.ts → color)',
    pairs: CONTRAST_PAIRS,
  },
  {
    out: 'apps/site/src/app/tokens.css',
    palette: brandLittlePearls,
    paletteName: "Little Pearls' own palette (tokens.ts → brandLittlePearls)",
    pairs: LITTLE_PEARLS_CONTRAST_PAIRS,
    note: [
      ' * Their light palette is BACKGROUND ONLY — white text on any of it fails WCAG AA, which',
      ' * is measured in tokens.ts and asserted in its tests. `--teal-ink` and `--coral-ink` are',
      ' * their own hues darkened to the threshold, for white text or for text itself.',
    ],
  },
];

/** `inkMuted` → `ink-muted`, `surfaceSunken` → `surface-sunken`, `tealInk` → `teal-ink`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function generate(surface: Surface): string {
  const lines: string[] = [
    '/*',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Written by `npm run tokens` from packages/core/src/tokens.ts, which is also',
    ' * what the mobile theme reads. Edit the tokens, not this.',
    ' *',
    ` * Colour here is ${surface.paletteName}.`,
    ...(surface.note ?? []),
    ' *',
    ' * `npm run tokens:check` fails if this is out of date, so a colour changed in one',
    ' * place cannot silently disagree with the other.',
    ' */',
    '',
    ':root {',
    '  /* Colour */',
  ];

  for (const [name, value] of Object.entries(surface.palette)) {
    lines.push(`  --${kebab(name)}: ${value};`);
  }

  lines.push('', '  /* Spacing */');
  for (const [name, value] of Object.entries(space)) {
    lines.push(`  --space-${name}: ${value}px;`);
  }

  lines.push('', '  /* Radius */');
  for (const [name, value] of Object.entries(radius)) {
    lines.push(`  --radius-${name}: ${value}px;`);
  }

  lines.push('', '  /* Type scale */');
  for (const [name, value] of Object.entries(font.size)) {
    lines.push(`  --text-${kebab(name)}: ${value}px;`);
  }

  lines.push(
    '',
    '  /*',
    '   * Touch targets. The token calls 44px the minimum for anything interactive,',
    '   * which is written for a thumb on a tablet. The web app uses 32px for buttons',
    '   * inside a table row — above the WCAG 2.2 AA floor of 24px, below this, and a',
    '   * deliberate compromise for a desk screen with a mouse.',
    '   */',
  );
  for (const [name, value] of Object.entries(target)) {
    lines.push(`  --target-${kebab(name)}: ${value}px;`);
  }

  /*
   * Motion. Added when the nav drawer needed the 260ms dialog timing and was about to
   * hardcode it — which is the exact duplication this generator exists to prevent. The
   * easing curve is one string in one place for the same reason.
   */
  lines.push('', '  /* Motion */');
  for (const [name, value] of Object.entries(motion)) {
    lines.push(`  --motion-${kebab(name)}: ${typeof value === 'number' ? `${value}ms` : value};`);
  }

  lines.push('}', '');

  // The measured ratios, as a comment. Not decoration: the numbers in the tokens
  // file were once wrong by more than a point, and having them recomputed here means
  // a change that breaks contrast shows up in the diff of this file too.
  lines.push('/*', ' * Measured contrast, recomputed at generation time:');
  for (const pair of surface.pairs) {
    const ratio = contrastRatio(pair.fg, pair.bg).toFixed(2);
    const verdict = contrastRatio(pair.fg, pair.bg) >= pair.min ? 'passes' : 'FAILS';
    lines.push(` *   ${pair.label.padEnd(20)} ${ratio}:1  ${verdict} AA (needs ${pair.min}:1)`);
  }
  lines.push(' */', '');

  return lines.join('\n');
}

const checking = process.argv.includes('--check');
let stale = 0;

for (const surface of SURFACES) {
  const out = path.resolve(import.meta.dirname, '..', surface.out);
  const generated = generate(surface);

  if (!checking) {
    writeFileSync(out, generated);
    console.log(`  wrote ${surface.out}`);
    continue;
  }

  let existing = '';
  try {
    existing = readFileSync(out, 'utf8');
  } catch {
    console.error(`\n  ${surface.out} does not exist. Run \`npm run tokens\`.`);
    stale += 1;
    continue;
  }
  // Newlines normalised so a Windows checkout and a Linux CI runner agree.
  if (existing.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) {
    console.error(`  ${surface.out} is out of date with packages/core/src/tokens.ts.`);
    stale += 1;
  } else {
    console.log(`  ${surface.out} is up to date.`);
  }
}

console.log('');

if (checking && stale > 0) {
  console.error(`  ${stale} file(s) stale. Run \`npm run tokens\` and commit the result.\n`);
  process.exit(1);
}
