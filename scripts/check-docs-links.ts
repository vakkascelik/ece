/**
 * Checks that every link in the markdown documentation resolves.
 *
 * Written because it immediately found a real one: the root README linked to a test file
 * under `app/(app)/…`, and the closing parenthesis of `(app)` terminates a markdown link
 * early — so the link rendered broken on GitHub while looking perfectly fine in the source.
 * Parentheses in a path have to be percent-encoded.
 *
 * Two kinds of link:
 *
 *   [[page-name]]            must match llm-wiki/wiki/<page-name>.md
 *   [text](some/path.ts)     must exist on disk
 *
 *   npm run check:docs
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const WIKI = path.join(ROOT, 'llm-wiki', 'wiki');

/** Markdown files that are documentation rather than source comments. */
function docFiles(): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(ROOT, entry.name));
  }
  // `docs/` added in Phase 6. It holds the documents a *centre* reads — the privacy
  // statement, the breach runbook, the retention schedule — and they cross-link to each
  // other and to the wiki. Those are the links most worth checking, because they are the
  // ones somebody follows during an incident.
  for (const dir of [path.join(ROOT, 'llm-wiki'), WIKI, path.join(ROOT, 'docs')]) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const pages = new Set(
  existsSync(WIKI)
    ? readdirSync(WIKI)
        .filter((f) => f.endsWith('.md'))
        .map((f) => f.replace(/\.md$/, ''))
    : [],
);

const problems: string[] = [];
const files = docFiles();

for (const file of files) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  // Fenced code blocks hold template examples, which are illustrations rather than links.
  const body = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');

  for (const match of body.matchAll(/\[\[([a-z0-9-]+)\]\]/g)) {
    const name = match[1]!;
    if (!pages.has(name)) problems.push(`${rel}: [[${name}]] has no page`);
  }

  for (const match of body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1]!;
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    // Percent-decoded, because a path containing parentheses must be encoded to survive
    // markdown link syntax at all — which is the bug that motivated this script.
    const bare = decodeURIComponent(target.split('#')[0]!);
    if (!existsSync(path.resolve(path.dirname(file), bare))) {
      problems.push(`${rel}: ${target} does not exist`);
    }
  }
}

console.log(`\n  ${files.length} markdown files, ${pages.size} wiki pages`);

if (problems.length > 0) {
  console.error(`\n  ${problems.length} broken link(s):\n`);
  for (const p of problems) console.error(`    ${p}`);
  console.error(
    '\n  A path containing parentheses — like app/(app)/… — must be percent-encoded as\n' +
      '  %28app%29, or the closing bracket ends the markdown link early.\n',
  );
  process.exit(1);
}

console.log('  all links resolve\n');
