/**
 * Golden fixtures (SPEC §14.1).
 *
 * Each fixture is a real `engine-input` document plus a policy and a set of hand-computed
 * expectations. Three things are checked, and the first and third matter as much as the
 * second: the input validates against the published schema, the engine reproduces the
 * hand-computed numbers, and the result validates against the published output schema.
 *
 * If these ever disagree with the engine, work out which is wrong by re-deriving the
 * arithmetic in `scripts/build-fixtures.mjs` — do not "fix" the fixture by pasting in
 * whatever the engine printed. A golden fixture that agrees with the code by construction
 * tests nothing.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';
import { computeOffering, FrameworkMismatchError } from '../packages/engine/src/index.js';
import type { EngineInput, PolicyDocument } from '../packages/engine/src/types.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const goldenDir = join(root, 'fixtures', 'golden');
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function compile(name: string): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(read(join(root, 'packages', 'schemas', `${name}.schema.json`)));
}
const validateInput = compile('engine-input');
const validateOutput = compile('engine-output');
const errs = (v: ValidateFunction) =>
  (v.errors ?? []).map((e) => `  ${e.instancePath || '/'} ${e.message}`).join('\n');

const CTX = { computed_at: '2026-07-29T00:00:00.000Z', run_id: 'run:fixture' };

const dirs = readdirSync(goldenDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

interface Expected {
  title: string;
  framework_version?: string;
  scale_kind?: string;
  see_mode?: string;
  cohort?: { considered: number; excluded: number };
  co?: Record<string, Record<string, number>>;
  po?: Record<string, number>;
  student_pct?: Record<string, Record<string, number>>;
  student_maximum?: Record<string, Record<string, number>>;
  warnings_include?: string[];
  stamps_include?: string[];
  stamps_exclude?: string[];
}

describe('golden fixtures', () => {
  it('every fixture in the index exists on disk', () => {
    const index = read(join(goldenDir, 'index.json'));
    for (const f of index.fixtures) expect(dirs).toContain(f.dir);
    expect(dirs.length).toBe(index.fixtures.length);
  });

  for (const dir of dirs) {
    const input = read(join(goldenDir, dir, 'input.json')) as EngineInput;
    const policy = read(join(goldenDir, dir, 'policy.json')) as PolicyDocument;
    const expected = read(join(goldenDir, dir, 'expected.json')) as Expected;

    describe(`${dir} — ${expected.title}`, () => {
      it('input validates against the published engine-input schema', () => {
        if (!validateInput(input)) throw new Error(`\n${errs(validateInput)}`);
        expect(true).toBe(true);
      });

      const result = computeOffering(input, policy, CTX);

      it('result validates against the published engine-output schema', () => {
        if (!validateOutput(result)) throw new Error(`\n${errs(validateOutput)}`);
        expect(true).toBe(true);
      });

      it('reproduces the hand-computed values', () => {
        if (expected.framework_version) expect(result.framework.version).toBe(expected.framework_version);
        if (expected.scale_kind) expect(result.scale.kind).toBe(expected.scale_kind);
        if (expected.see_mode) expect(result.see_mode).toBe(expected.see_mode);

        if (expected.cohort) {
          expect(result.cohort_summary.considered).toBe(expected.cohort.considered);
          expect(result.cohort_summary.excluded).toBe(expected.cohort.excluded);
        }

        for (const [code, want] of Object.entries(expected.co ?? {})) {
          const co = result.co_attainments.find((c) => c.code === code);
          expect(co, `${code} missing from result`).toBeDefined();
          for (const [field, value] of Object.entries(want)) {
            const actual =
              field === 'direct' ? co!.direct_value
              : field === 'final' ? co!.final_value
              : field === 'indirect' ? co!.indirect_value
              : field === 'ratio' ? co!.trace.ratio
              : (co as unknown as Record<string, number>)[field];
            expect(actual, `${code}.${field}`).toBeCloseTo(value, 6);
          }
        }

        for (const [code, value] of Object.entries(expected.po ?? {})) {
          const po = result.po_attainments.find((p) => p.code === code);
          expect(po, `${code} missing from result`).toBeDefined();
          expect(po!.value, `${code}`).toBeCloseTo(value, 6);
        }
      });

      if (expected.student_pct || expected.student_maximum) {
        it('reproduces the per-student figures behind them', () => {
          for (const [code, byRoll] of Object.entries(expected.student_pct ?? {})) {
            const co = result.co_attainments.find((c) => c.code === code)!;
            for (const [roll, pct] of Object.entries(byRoll)) {
              const s = co.trace.students.find((x) => x.roll_no === roll);
              expect(s?.pct, `${code} ${roll} pct`).toBeCloseTo(pct, 6);
            }
          }
          // Each student's own denominator — the choice-question property.
          for (const [code, byRoll] of Object.entries(expected.student_maximum ?? {})) {
            const co = result.co_attainments.find((c) => c.code === code)!;
            for (const [roll, max] of Object.entries(byRoll)) {
              const s = co.trace.students.find((x) => x.roll_no === roll);
              expect(s?.maximum, `${code} ${roll} maximum`).toBeCloseTo(max, 6);
            }
          }
        });
      }

      it('carries the expected stamps and warnings', () => {
        for (const code of expected.warnings_include ?? []) {
          expect(result.warnings.map((w) => w.code)).toContain(code);
        }
        for (const stamp of expected.stamps_include ?? []) {
          expect(result.stamps).toContain(stamp);
        }
        for (const stamp of expected.stamps_exclude ?? []) {
          expect(result.stamps).not.toContain(stamp);
        }
      });

      it('is reproducible — recomputing gives a byte-identical result', () => {
        const again = computeOffering(read(join(goldenDir, dir, 'input.json')), policy, CTX);
        expect(JSON.stringify(again)).toBe(JSON.stringify(result));
      });

      it('contains no data that could belong to a real student', () => {
        const raw = readFileSync(join(goldenDir, dir, 'input.json'), 'utf8');
        expect(raw).not.toMatch(/@[a-z0-9.-]+\.[a-z]{2,}/i);
        // Real Indian roll numbers look like 2023BCS0205 / 21BCS001 / CS-19-0042.
        expect(raw).not.toMatch(/\b(19|20)\d{2}[A-Z]{2,4}\d{3,4}\b/);
      });
    });
  }
});

describe('F — the framework binding, which is what fixture F exists to prove', () => {
  const v3 = {
    input: read(join(goldenDir, 'f1-migration-v3-term', 'input.json')) as EngineInput,
    policy: read(join(goldenDir, 'f1-migration-v3-term', 'policy.json')) as PolicyDocument,
  };
  const v4 = {
    input: read(join(goldenDir, 'f2-migration-v4-term', 'input.json')) as EngineInput,
    policy: read(join(goldenDir, 'f2-migration-v4-term', 'policy.json')) as PolicyDocument,
  };

  it('computes each term under the framework in force at the time', () => {
    expect(computeOffering(v3.input, v3.policy, CTX).framework.version).toBe('gapc-v3.0');
    expect(computeOffering(v4.input, v4.policy, CTX).framework.version).toBe('gapc-v4.0');
  });

  it('refuses to compute the older term under the newer framework', () => {
    // The whole point. A twelve-outcome cohort restated under an eleven-outcome framework is
    // invalid, not approximate — so this throws rather than warning on a report nobody reads.
    expect(() => computeOffering(v3.input, v4.policy, CTX)).toThrow(FrameworkMismatchError);
    expect(() => computeOffering(v3.input, v4.policy, CTX)).toThrow(/Refusing to compute/);
  });

  it('and refuses the reverse, so neither direction is silently restated', () => {
    expect(() => computeOffering(v4.input, v3.policy, CTX)).toThrow(FrameworkMismatchError);
  });

  it('keeps the two terms as separate series with different outcome sets', () => {
    const a = computeOffering(v3.input, v3.policy, CTX);
    const b = computeOffering(v4.input, v4.policy, CTX);

    expect(a.po_attainments.map((p) => p.code)).toEqual(['PO12']);
    expect(b.po_attainments.map((p) => p.code)).toEqual(['PO11']);
    // Identical marks, identical attainment — only the framework differs, which is what
    // makes the two series comparable in substance but not mergeable in reporting.
    expect(a.co_attainments[0]!.direct_value).toBe(b.co_attainments[0]!.direct_value);
    expect(a.input_hash).not.toBe(b.input_hash);
  });
});
