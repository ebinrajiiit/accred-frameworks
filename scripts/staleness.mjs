#!/usr/bin/env node
/**
 * Registry staleness.
 *
 * Reports the OLDEST `verified_on` across every framework file, and exits non-zero once it
 * passes the threshold. Deliberately the oldest and not the newest: one freshly-checked file
 * must not make a neglected one look current, which is exactly how a registry goes stale
 * without anyone noticing.
 *
 *   node scripts/staleness.mjs [--max-age-days 200] [--today YYYY-MM-DD]
 *
 * `--today` is injectable so the check is testable and reproducible rather than depending on
 * when it happens to run.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

// Two semesters, per MAINTENANCE.md's lapse procedure.
const maxAgeDays = Number(arg('max-age-days', '200'));
const today = arg('today', new Date().toISOString().slice(0, 10));

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [],
  );
}

const files = walk(join(root, 'frameworks'));
const entries = [];

for (const file of files) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    console.error(`unreadable: ${file}`);
    process.exit(2);
  }
  if (!doc.kind) continue; // index.json and similar
  entries.push({ id: doc.id ?? file, verified_on: doc.verified_on ?? null, file });
}

if (entries.length === 0) {
  console.log('No framework files yet.');
  console.log('badge: unknown');
  process.exit(0);
}

// Unverified is a distinct, worse state than stale: nobody has ever checked the file, so
// there is no date to age. Report it separately rather than letting it drop out of the
// calculation and leave the badge looking healthy.
const unverified = entries.filter((e) => !e.verified_on);
const verified = entries.filter((e) => e.verified_on);

if (unverified.length > 0) {
  console.log(`frameworks         : ${entries.length}`);
  console.log(`unverified         : ${unverified.length}`);
  for (const e of unverified) console.log(`  - ${e.id}`);
  console.log(`badge              : UNVERIFIED`);
  console.error(
    `\n${unverified.length} framework file(s) have never been checked against an official manual.\n` +
      `Outcome statements are reproduced verbatim in a Self-Assessment Report, so an unverified\n` +
      `transcription is a defect waiting to happen. Verify against source_url and set verified_on.`,
  );
  process.exit(1);
}

verified.sort((a, b) => a.verified_on.localeCompare(b.verified_on));
const oldest = verified[0];

const days = Math.floor(
  (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest.verified_on}T00:00:00Z`)) / 86400000,
);

const stale = days > maxAgeDays;

console.log(`frameworks checked : ${verified.length}`);
console.log(`oldest verified_on : ${oldest.verified_on}  (${oldest.id})`);
console.log(`age                : ${days} days (threshold ${maxAgeDays})`);
console.log(`badge              : ${stale ? 'UNMAINTAINED' : 'verified ' + oldest.verified_on}`);

if (stale) {
  console.error(
    `\nRegistry is stale. MAINTENANCE.md commits to re-verifying every framework file each ` +
      `semester; the oldest check is ${days} days old.\n` +
      `Re-verify against source_url and update verified_on, or mark the registry unmaintained.`,
  );
  process.exit(1);
}
