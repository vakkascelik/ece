/**
 * Generates the web app's CSS custom properties from `@ece/core/tokens`.
 *
 * The tokens were already the single source for the mobile theme, which reads them
 * as data. The web app restated them by hand in `globals.css` — so the accent green
 * existed twice, the contrast test asserted one copy, and the screens rendered the
 * other. That is the sort of duplication that stays correct right up until somebody
 * adjusts a colour.
 *
 *   npm run tokens          write the file
 *   npm run tokens:check    fail if it is out of date (CI)
 *
 * `--check` rather than generating during the build: a build step that rewrites a
 * tracked file produces diffs nobody asked for, and the failure mode of a stale
 * committed file is a puzzling visual mismatch. Better for CI to say so.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { color, contrastRatio, CONTRAST_PAIRS, font, radius, space, target } from '@ece/core';

const OUT = path.resolve(import.meta.dirname, '../apps/web/src/app/tokens.css');

function generate(): string {
  const lines: string[] = [
    '/*',
    ' * GENERATED FILE — do not edit.',
    ' *',
    ' * Written by `npm run tokens` from packages/core/src/tokens.ts, which is also',
    ' * what the mobile theme reads. Edit the tokens, not this.',
    ' *',
    ' * `npm run tokens:check` fails if this is out of date, so a colour changed in one',
    ' * place cannot silently disagree with the other.',
    ' */',
    '',
    ':root {',
    '  /* Colour */',
  ];

  for (const [name, value] of Object.entries(color)) {
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

  lines.push('}', '');

  // The measured ratios, as a comment. Not decoration: the numbers in the tokens
  // file were once wrong by more than a point, and having them recomputed here means
  // a change that breaks contrast shows up in the diff of this file too.
  lines.push('/*', ' * Measured contrast, recomputed at generation time:');
  for (const pair of CONTRAST_PAIRS) {
    const ratio = contrastRatio(pair.fg, pair.bg).toFixed(2);
    const verdict = contrastRatio(pair.fg, pair.bg) >= pair.min ? 'passes' : 'FAILS';
    lines.push(` *   ${pair.label.padEnd(16)} ${ratio}:1  ${verdict} AA (needs ${pair.min}:1)`);
  }
  lines.push(' */', '');

  return lines.join('\n');
}

/** `inkMuted` → `ink-muted`, `surfaceSunken` → `surface-sunken`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

const generated = generate();

if (process.argv.includes('--check')) {
  let existing = '';
  try {
    existing = readFileSync(OUT, 'utf8');
  } catch {
    console.error('\n  apps/web/src/app/tokens.css does not exist. Run `npm run tokens`.\n');
    process.exit(1);
  }
  // Newlines normalised so a Windows checkout and a Linux CI runner agree.
  if (existing.replace(/\r\n/g, '\n') !== generated.replace(/\r\n/g, '\n')) {
    console.error(
      '\n  apps/web/src/app/tokens.css is out of date with packages/core/src/tokens.ts.\n' +
        '  Run `npm run tokens` and commit the result.\n',
    );
    process.exit(1);
  }
  console.log('\n  tokens.css is up to date.\n');
} else {
  writeFileSync(OUT, generated);
  console.log(`\n  wrote ${path.relative(process.cwd(), OUT)}\n`);
}
