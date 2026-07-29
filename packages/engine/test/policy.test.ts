/**
 * Policy document tests: the shipped documents must be valid, and validation must catch the
 * mistakes that produce a plausible-looking wrong number rather than an error.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import { resolvePolicy, validatePolicy } from '../src/index.js';
import type { PolicyDocument } from '../src/types.js';
import { policy } from './helpers.js';

const read = (rel: string) => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

// The schema is published from packages/schemas, not kept as a private copy inside the
// engine. One document, one source of truth: a consumer validating against the published
// schema must get the same answer the engine gives.
const schema = read('../../schemas/attainment-policy.schema.json');
const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

/**
 * Synthetic test policies only. Institution config packs are proprietary and live in the
 * private repository — see helpers.ts. Between them these four exercise every branch the
 * engine has: level and percentage scales, weighted and split CIE/SEE combination,
 * question-wise and apportioned and excluded end-semester data, and both absentee rules.
 */
const POLICIES = [
  'level-target-ratio',
  'split-blueprint',
  'percentage-credit-weighted',
  'internal-only',
] as const;

describe('synthetic test policies', () => {
  for (const name of POLICIES) {
    const doc = read(`../../../fixtures/policies/${name}.json`);

    it(`${name} validates against the published JSON Schema`, () => {
      const ok = validateSchema(doc);
      if (!ok) {
        throw new Error(
          `Schema errors:\n${(validateSchema.errors ?? [])
            .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
            .join('\n')}`,
        );
      }
      expect(ok).toBe(true);
    });

    it(`${name} passes runtime validation`, () => {
      expect(validatePolicy(doc)).toEqual([]);
    });
  }

  it('covers both scale kinds and every end-semester mode between them', () => {
    const docs = POLICIES.map((n) => read(`../../../fixtures/policies/${n}.json`));
    expect(new Set(docs.map((d) => d.scale.kind))).toEqual(new Set(['level', 'percentage']));
    expect(new Set(docs.map((d) => d.direct.combination))).toEqual(
      new Set(['weighted_components', 'split']),
    );
    expect(new Set(docs.map((d) => d.cohort.absent_handling))).toEqual(new Set(['exclude', 'zero']));
  });
});

describe('validatePolicy catches the silent-wrong-answer mistakes', () => {
  it('rejects direct/indirect weights that do not sum to 1', () => {
    // Nothing crashes when these are wrong; every final value is quietly scaled.
    const issues = validatePolicy(policy({ weights: { direct: 0.8, indirect: 0.3 } }));
    expect(issues.join()).toMatch(/weights.direct \+ weights.indirect must be 1/);
  });

  it('rejects CIE/SEE weights that do not sum to 1 under split combination', () => {
    const issues = validatePolicy(
      policy({ direct: { combination: 'split', cie_weight: 0.4, see_weight: 0.5 } }),
    );
    expect(issues.join()).toMatch(/cie_weight \+ direct.see_weight must be 1/);
  });

  it('rejects a non-monotonic band table', () => {
    // A higher ratio mapping to a lower level would make attainment fall as students improve.
    const issues = validatePolicy(
      policy({
        direct: {
          bands: [
            { at_least: 0.6, level: 3 },
            { at_least: 0.8, level: 1 },
          ],
        },
      }),
    );
    expect(issues.join()).toMatch(/not monotonic/);
  });

  it('rejects bands expressed as percentages rather than ratios', () => {
    const issues = validatePolicy(policy({ direct: { bands: [{ at_least: 60, level: 1 }] } }));
    expect(issues.join()).toMatch(/ratio in 0\.\.1/);
  });

  it('rejects a target outside the scale', () => {
    const issues = validatePolicy(policy({ program: { targets_by_outcome: { PO1: 7 } } }));
    expect(issues.join()).toMatch(/falls outside the scale/);
  });

  it('rejects a policy with no framework binding', () => {
    const broken = policy();
    delete (broken as Partial<PolicyDocument>).framework;
    expect(validatePolicy(broken).join()).toMatch(/framework.code and framework.version are required/);
  });

  it('rejects zero as a minimum survey response count', () => {
    const issues = validatePolicy(policy({ indirect: { min_responses: 0 } }));
    expect(issues.join()).toMatch(/min_responses must be at least 1/);
  });

  it('flags recompute_historical_terms, which destroys the audit trail', () => {
    const issues = validatePolicy(policy({ migration: { recompute_historical_terms: true } }));
    expect(issues.join()).toMatch(/destroys the audit trail/);
  });

  it('rejects indirect_sources whose weights do not sum to 1', () => {
    const issues = validatePolicy(
      policy({ program: { indirect_sources: [{ kind: 'alumni_survey', weight: 0.5 }] } }),
    );
    expect(issues.join()).toMatch(/indirect_sources weights must sum to 1/);
  });
});

describe('four-scope resolution (§7)', () => {
  const institution = policy();

  it('lets a narrower scope override a single field without restating the rest', () => {
    const resolved = resolvePolicy({
      institution,
      program: { scope: { type: 'program', ref: 'prog:cse' }, direct: { target_pct: 50 } },
    });
    expect(resolved.direct.target_pct).toBe(50);
    // Everything not mentioned is inherited.
    expect(resolved.direct.method).toBe(institution.direct.method);
    expect(resolved.cohort.absent_handling).toBe(institution.cohort.absent_handling);
  });

  it('applies course → course_type → program → institution, narrowest wins', () => {
    const resolved = resolvePolicy({
      institution,
      program: { scope: { type: 'program', ref: 'p' }, direct: { target_pct: 50 } },
      course_type: { scope: { type: 'course_type', ref: 'lab' }, direct: { target_pct: 55 } },
      course: { scope: { type: 'course', ref: 'c' }, direct: { target_pct: 65 } },
    });
    expect(resolved.direct.target_pct).toBe(65);
    expect(resolved.scope).toEqual({ type: 'course', ref: 'c' });
  });

  it('replaces arrays wholesale rather than merging them', () => {
    // Merging band tables would produce a table nobody wrote.
    const resolved = resolvePolicy({
      institution,
      course: { scope: { type: 'course', ref: 'c' }, direct: { bands: [{ at_least: 0.5, level: 1 }] } },
    });
    expect(resolved.direct.bands).toEqual([{ at_least: 0.5, level: 1 }]);
  });

  it('strips human annotations from the resolved document', () => {
    const annotated = { ...institution, _comment_direct: 'note' } as PolicyDocument;
    const resolved = resolvePolicy({ institution: annotated });
    expect(Object.keys(resolved).some((k) => k.startsWith('_comment'))).toBe(false);
  });

  it('produces a document that still passes validation', () => {
    const resolved = resolvePolicy({
      institution,
      program: { scope: { type: 'program', ref: 'p' }, direct: { target_pct: 55 } },
    });
    expect(validatePolicy(resolved)).toEqual([]);
  });
});
