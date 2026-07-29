#!/usr/bin/env node
/**
 * Privacy gate (OSS-SPLIT §4).
 *
 * Fails the build on anything under `fixtures/` that looks like it came from a real cohort.
 *
 * This is a backstop, not a substitute for judgement — a determined mistake will get past any
 * regex. But the mistake this actually guards against is not malice, it is convenience: the
 * quickest way to build a realistic fixture is to export a real class, and by the time anyone
 * notices, it is in the git history of a public repository and cannot be taken back.
 *
 * The rule the gate encodes: invent the students.
 *
 *   node scripts/privacy-gate.mjs [--path fixtures]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--path');
const target = join(root, i >= 0 && args[i + 1] ? args[i + 1] : 'fixtures');

const PATTERNS = [
  {
    id: 'email',
    re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi,
    why: 'an email address. No real person should be identifiable from a fixture.',
    allow: /@(example|test|invalid|localhost)\b/i,
  },
  {
    id: 'roll-number',
    // 2023BCS0205, 21BCS001, 19EC1234 — the admission-year-plus-branch shape used across
    // Indian institutions, which is exactly what a real export would contain.
    re: /\b(?:19|20)?\d{2}[A-Z]{2,4}\d{3,4}\b/g,
    why: 'a roll number in the shape real Indian institutions issue. Invent one that cannot collide.',
    allow: null,
  },
  {
    id: 'aadhaar',
    re: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
    why: 'twelve digits — possibly an Aadhaar number.',
    allow: null,
  },
  {
    id: 'phone',
    re: /\b(?:\+91[\s-]?)?[6-9]\d{9}\b/g,
    why: 'an Indian mobile number.',
    allow: null,
  },
];

function walk(dir) {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const files = walk(target);
const violations = [];

for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text))) {
      if (p.allow?.test(m[0])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      violations.push({ rel, line, id: p.id, match: m[0], why: p.why });
    }
  }
}

console.log(`privacy gate: ${files.length} file(s) under ${relative(root, target) || '.'}`);

if (violations.length === 0) {
  console.log('  nothing resembling real data ✓');
  process.exit(0);
}

for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  [${v.id}]  ${v.match}\n      ${v.why}`);
}
console.error(
  `\n${violations.length} possible real-data leak(s). Fixtures are synthetic — invent the students.\n` +
    `If a match is a false positive, change the fixture rather than the gate: a value that looks\n` +
    `like real data will be assumed to be real data by anyone who finds it in a public repository.`,
);
process.exit(1);
