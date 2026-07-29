#!/usr/bin/env node
/**
 * Engine purity gate (OSS-SPLIT §4).
 *
 * `dependency-cruiser` polices what the engine imports. This polices what it *does* with what
 * it already has — things no import rule can see:
 *
 *   - Reading the clock. `Date.now()` and `new Date()` with no argument make a run depend on
 *     when it happened, so an archived run can never be reproduced. The timestamp is an input.
 *   - Randomness. Same reason, more obviously.
 *   - Reading the environment. A result that changes with a deployment variable is a result
 *     nobody can defend to an evaluator.
 *   - Hardcoded thresholds. Every band, weight and target belongs in the policy document
 *     (principle P2). A literal like `0.6` sitting in a comparison is an institution's rule
 *     that has escaped into code, which is exactly what makes a tool unsellable outside the
 *     institution it was written for.
 *
 * The last check is heuristic and will occasionally be wrong. When it is, the fix is to name
 * the constant and say why in an allow-comment — not to delete the check.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'packages', 'engine', 'src');

/** Numbers that carry no policy meaning: identity, empty, percent, midpoint, rounding. */
const INNOCUOUS = new Set(['0', '1', '2', '-1', '100', '0.5', '10', '1000', '1e-9', '1e-12', '1e-6']);

const CHECKS = [
  {
    id: 'clock',
    re: /\bDate\.now\s*\(|\bnew\s+Date\s*\(\s*\)/g,
    why: 'reads the clock — the timestamp must be passed in, or runs cannot be reproduced',
  },
  {
    id: 'randomness',
    re: /\bMath\.random\s*\(/g,
    why: 'uses randomness — a run must give the same answer every time',
  },
  {
    id: 'environment',
    re: /\bprocess\.(env|argv|cwd)\b/g,
    why: 'reads the process environment — results must not depend on where the engine ran',
  },
  {
    id: 'globals',
    re: /\b(globalThis|window|document)\b/g,
    why: 'reaches for ambient state',
  },
];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')
        ? [join(dir, e.name)]
        : [],
  );
}

/** Strip comments and string literals so prose about `Date.now()` is not a violation. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

const violations = [];
const files = walk(srcDir);

for (const file of files) {
  const raw = readFileSync(file, 'utf8');
  const stripped = code(raw);
  const rel = relative(root, file);

  for (const check of CHECKS) {
    check.re.lastIndex = 0;
    let m;
    while ((m = check.re.exec(stripped))) {
      const line = stripped.slice(0, m.index).split('\n').length;
      violations.push({ rel, line, id: check.id, text: m[0].trim(), why: check.why });
    }
  }

  // Policy literals: a bare decimal compared against, outside a type or default position.
  for (const [i, lineText] of stripped.split('\n').entries()) {
    if (/\/\/\s*allow-literal/.test(raw.split('\n')[i] ?? '')) continue;
    const cmp = lineText.match(/[<>]=?\s*(\d*\.\d+)|(\d*\.\d+)\s*[<>]=?/g);
    if (!cmp) continue;
    for (const hit of cmp) {
      const num = hit.match(/\d*\.\d+/)?.[0];
      if (!num || INNOCUOUS.has(num)) continue;
      violations.push({
        rel,
        line: i + 1,
        id: 'policy-literal',
        text: hit.trim(),
        why: `compares against the literal ${num} — thresholds belong in the policy document (P2)`,
      });
    }
  }
}

console.log(`engine purity gate: ${files.length} source files checked`);

if (violations.length === 0) {
  console.log('  no violations ✓');
  console.log('  no clock, no randomness, no environment, no hardcoded thresholds');
  process.exit(0);
}

for (const v of violations) {
  console.error(`  ${v.rel}:${v.line}  [${v.id}]  ${v.text}\n      ${v.why}`);
}
console.error(`\n${violations.length} purity violation(s). The engine's contract is that it is a`);
console.error('pure function of its inputs; each of these breaks it in a way no import rule can see.');
process.exit(1);
