#!/usr/bin/env node
/**
 * Renders the verification badge into the README (OSS-SPLIT §3).
 *
 * The badge shows the *oldest* `verified_on` in the registry, so staleness is visible on the
 * landing page rather than buried in a file nobody opens. Oldest and not newest, deliberately:
 * a registry is only as trustworthy as its least-recently-checked file, and averaging would
 * let one fresh check hide a decade-old one.
 *
 *   node scripts/badge.mjs           update the README
 *   node scripts/badge.mjs --check   fail if the README is out of date (CI)
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const readmePath = join(root, 'README.md');
const check = process.argv.includes('--check');

const START = '<!-- verification-badge -->';
const END = '<!-- /verification-badge -->';

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [],
  );
}

const files = walk(join(root, 'frameworks'))
  .map((f) => JSON.parse(readFileSync(f, 'utf8')))
  .filter((d) => d.kind);

const unverified = files.filter((d) => !d.verified_on);
const verified = files.filter((d) => d.verified_on).sort((a, b) => a.verified_on.localeCompare(b.verified_on));

let label, message, colour, note;

if (files.length === 0) {
  [label, message, colour] = ['frameworks', 'none', 'lightgrey'];
  note = 'No framework files in the registry yet.';
} else if (unverified.length > 0) {
  [label, message, colour] = ['verification', `${unverified.length} UNVERIFIED`, 'critical'];
  note =
    `${unverified.length} of ${files.length} framework files have never been checked against an ` +
    `official manual: ${unverified.map((d) => `\`${d.id}\``).join(', ')}. ` +
    `They carry \`verified_on: null\` and a note saying what a verifier must confirm.`;
} else {
  const oldest = verified[0];
  [label, message, colour] = ['verified', oldest.verified_on, 'brightgreen'];
  note =
    `Every framework file has been checked against its official manual. The date shown is the ` +
    `oldest across the registry — \`${oldest.id}\` — because a registry is only as current as ` +
    `its least-recently-verified file.`;
}

const enc = (s) => encodeURIComponent(s).replace(/-/g, '--').replace(/_/g, '__');
const badge = `![${label}: ${message}](https://img.shields.io/badge/${enc(label)}-${enc(message)}-${colour})`;
const block = `${START}\n${badge}\n\n${note}\n${END}`;

const readme = readFileSync(readmePath, 'utf8');
let updated;

if (readme.includes(START) && readme.includes(END)) {
  updated = readme.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
} else {
  // First run: place it directly under the title so it cannot be scrolled past.
  const lines = readme.split('\n');
  const at = lines.findIndex((l) => l.startsWith('# ')) + 1;
  lines.splice(at, 0, '', block);
  updated = lines.join('\n');
}

if (check) {
  if (updated !== readme) {
    console.error('README verification badge is out of date.');
    console.error('Run `npm run badge` and commit the result.');
    console.error(`\nExpected:\n  ${badge}\n  ${note}`);
    process.exit(1);
  }
  console.log(`badge up to date: ${label} — ${message}`);
  process.exit(0);
}

writeFileSync(readmePath, updated);
console.log(`badge: ${label} — ${message}`);
console.log(`  ${note}`);
