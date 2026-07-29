/**
 * Property tests (spec §14.2).
 *
 * The edge cases pin known situations. These pin things that must hold for *every* input,
 * which is where the bugs nobody thought to write a case for tend to live.
 */

import { describe, expect, it } from 'vitest';
import { computeOffering } from '../src/index.js';
import { CTX, coOf, policy, scenario, students } from './helpers.js';

/** Seeded LCG — tests that shuffle must fail identically on every machine and every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rand = rng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const p = policy({ validation: { min_assessments_per_co: 1 } });

function build(scoreFor: (i: number) => number) {
  return scenario({
    cos: ['CO1', 'CO2', 'CO3'],
    outcomes: ['PO1', 'PO2'],
    articulation: { PO1: { CO1: 3, CO2: 2 }, PO2: { CO2: 1, CO3: 3 } },
    assessments: [
      {
        id: 'A1',
        weight: 40,
        questions: [
          { label: 'Q1', max: 10, co: 'CO1' },
          { label: 'Q2', max: 10, co: { CO1: 0.5, CO2: 0.5 } },
        ],
      },
      {
        id: 'A2',
        weight: 60,
        questions: [
          { label: 'Q1', max: 10, co: 'CO2' },
          { label: 'Q2', max: 10, co: 'CO3' },
        ],
      },
    ],
    students: students(24, (i) => ({
      'A1:Q1': scoreFor(i),
      'A1:Q2': scoreFor(i + 7),
      'A2:Q1': scoreFor(i + 13),
      'A2:Q2': scoreFor(i + 19),
    })),
  });
}

const base = build((i) => (i * 3) % 11);

describe('invariance under input order', () => {
  const expected = computeOffering(base, p, CTX);

  it('is invariant under student row order', () => {
    // Postgres makes no ordering promise, so a result that depended on row order would
    // drift between runs of the same data.
    const reordered = structuredClone(base);
    reordered.enrollments = shuffle(reordered.enrollments, 11);
    reordered.marks = shuffle(reordered.marks, 23);
    expect(computeOffering(reordered, p, CTX)).toEqual(expected);
  });

  it('is invariant under question order', () => {
    const reordered = structuredClone(base);
    reordered.questions = shuffle(reordered.questions, 37);
    reordered.question_outcomes = shuffle(reordered.question_outcomes, 41);
    expect(computeOffering(reordered, p, CTX)).toEqual(expected);
  });

  it('produces the same input hash regardless of order', () => {
    const reordered = structuredClone(base);
    reordered.enrollments = shuffle(reordered.enrollments, 53);
    reordered.marks = shuffle(reordered.marks, 59);
    expect(computeOffering(reordered, p, CTX).input_hash).toBe(expected.input_hash);
  });
});

describe('determinism and reproducibility', () => {
  it('is deterministic across repeated runs on identical input', () => {
    const a = computeOffering(base, p, CTX);
    const b = computeOffering(base, p, CTX);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('reproduces an archived run byte-identically from its pinned policy (§14.3)', () => {
    const archived = computeOffering(base, p, CTX);
    const archivedJson = JSON.stringify(archived);

    // Some time later, the same input document and the same pinned policy version.
    const recomputed = computeOffering(structuredClone(base), structuredClone(p), CTX);

    expect(JSON.stringify(recomputed)).toBe(archivedJson);
    expect(recomputed.input_hash).toBe(archived.input_hash);
    expect(recomputed.engine_version).toBe(archived.engine_version);
  });
});

describe('monotonicity in scores', () => {
  it('never lowers CO attainment when a student’s mark is raised', () => {
    // Attainment that could fall when a student does better would be indefensible in front
    // of an evaluator, whatever the formula said.
    const before = computeOffering(base, p, CTX);

    for (const co of ['CO1', 'CO2', 'CO3']) {
      const beforeValue = coOf(before, co).direct_value ?? 0;

      const raised = structuredClone(base);
      for (const m of raised.marks) {
        const q = raised.questions.find((x) => x.id === m.question_id)!;
        m.score = Math.min(q.max_marks, m.score + 1);
      }
      const afterValue = coOf(computeOffering(raised, p, CTX), co).direct_value ?? 0;
      expect(afterValue).toBeGreaterThanOrEqual(beforeValue);
    }
  });

  it('holds across a sweep of score distributions', () => {
    for (let seed = 0; seed < 12; seed++) {
      const rand = rng(seed * 977 + 1);
      const low = build(() => Math.floor(rand() * 6));
      const lowResult = computeOffering(low, p, CTX);

      const high = structuredClone(low);
      for (const m of high.marks) {
        const q = high.questions.find((x) => x.id === m.question_id)!;
        m.score = Math.min(q.max_marks, m.score + 4);
      }
      const highResult = computeOffering(high, p, CTX);

      for (const co of ['CO1', 'CO2', 'CO3']) {
        expect(coOf(highResult, co).direct_value ?? 0).toBeGreaterThanOrEqual(
          coOf(lowResult, co).direct_value ?? 0,
        );
      }
    }
  });
});

describe('scale bounds', () => {
  it('never produces a value outside the policy scale', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rand = rng(seed * 131 + 7);
      const result = computeOffering(build(() => Math.floor(rand() * 11)), p, CTX);
      for (const co of result.co_attainments) {
        for (const v of [co.direct_value, co.indirect_value, co.final_value]) {
          if (v === undefined) continue;
          expect(v).toBeGreaterThanOrEqual(p.scale.min);
          expect(v).toBeLessThanOrEqual(p.scale.max);
        }
      }
      for (const po of result.po_attainments) {
        if (po.value === undefined) continue;
        expect(po.value).toBeGreaterThanOrEqual(p.scale.min);
        expect(po.value).toBeLessThanOrEqual(p.scale.max);
      }
    }
  });
});

describe('performance target (§13)', () => {
  it('computes a 200-student offering in well under a second', () => {
    const big = scenario({
      cos: ['CO1', 'CO2', 'CO3', 'CO4', 'CO5'],
      outcomes: ['PO1', 'PO2', 'PO3'],
      articulation: { PO1: { CO1: 3, CO2: 2 }, PO2: { CO3: 3 }, PO3: { CO4: 2, CO5: 3 } },
      assessments: Array.from({ length: 6 }, (_, a) => ({
        id: `A${a}`,
        weight: 100 / 6,
        questions: Array.from({ length: 40 }, (_, q) => ({
          label: `Q${q}`,
          max: 5,
          co: `CO${(q % 5) + 1}`,
        })),
      })),
      students: students(200, (i) =>
        Object.fromEntries(
          Array.from({ length: 6 }, (_, a) =>
            Array.from({ length: 40 }, (_, q) => [`A${a}:Q${q}`, (i + a + q) % 6]),
          ).flat(),
        ),
      ),
    });

    const started = performance.now();
    const result = computeOffering(big, p, CTX);
    const elapsed = performance.now() - started;

    expect(result.co_attainments).toHaveLength(5);
    expect(elapsed).toBeLessThan(1000);
  });
});
