/**
 * Schema tests.
 *
 * OSS-SPLIT step 2 names the first of these explicitly: the existing policy example must
 * validate against the published policy schema. That is the check that proves the schema
 * describes the thing that actually exists, rather than a tidier thing we wish existed.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const schemaDir = join(root, 'packages', 'schemas');

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

function compile(name: string): ValidateFunction {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(read(join(schemaDir, `${name}.schema.json`)));
}

function explain(validate: ValidateFunction): string {
  return (validate.errors ?? [])
    .map((e) => `  ${e.instancePath || '/'} ${e.message}`)
    .join('\n');
}

const SCHEMAS = [
  'framework-outcomes',
  'framework-criteria',
  'framework-knowledge-indicators',
  'attainment-policy',
  'engine-input',
  'engine-output',
];

/** A framework file's `kind` selects the schema it must satisfy. */
const SCHEMA_FOR_KIND: Record<string, string> = {
  outcomes: 'framework-outcomes',
  criteria: 'framework-criteria',
  'knowledge-indicators': 'framework-knowledge-indicators',
};

describe('the schemas themselves', () => {
  for (const name of SCHEMAS) {
    it(`${name} is a valid JSON Schema and compiles`, () => {
      expect(() => compile(name)).not.toThrow();
    });

    it(`${name} declares a stable $id`, () => {
      // Consumers reference schemas by $id; changing one silently breaks their pinning.
      const doc = read(join(schemaDir, `${name}.schema.json`));
      expect(doc.$id).toMatch(/^https:\/\/.+\/schemas\/.+\.schema\.json$/);
    });
  }
});

describe('attainment-policy schema (OSS-SPLIT step 2)', () => {
  const validate = compile('attainment-policy');

  it('accepts the reference policy example', () => {
    // The example lives in the private repo alongside the spec; skip rather than fail if
    // this repo has been cloned on its own, which is the normal case for an outside user.
    const candidates = [
      join(root, 'fixtures', 'attainment-policy.example.json'),
      join(root, '..', 'accred', 'docs', 'attainment-policy.example.json'),
    ];
    const path = candidates.find(existsSync);
    if (!path) return;

    const ok = validate(read(path));
    if (!ok) throw new Error(`Reference policy failed validation:\n${explain(validate)}`);
    expect(ok).toBe(true);
  });

  it('requires a framework binding', () => {
    // A policy that does not say which framework it computes under produces numbers nobody
    // can interpret once the framework revises.
    const doc = { id: 'p', version: '1.0.0', scope: { type: 'institution', ref: null } };
    expect(validate(doc)).toBe(false);
    expect(explain(validate)).toMatch(/framework/);
  });
});

describe('framework-outcomes schema', () => {
  const validate = compile('framework-outcomes');

  const base = {
    id: 'nba/gapc-v4.0',
    body: 'NBA',
    version: '4.0',
    kind: 'outcomes',
    effective_from: '2025-01-01',
    source_document: 'NBA GAPC Manual v4.0',
    source_url: 'https://example.org/manual.pdf',
    retrieved_on: '2026-07-29',
    verified_on: '2026-07-29',
    outcomes: [{ code: 'PO1', kind: 'po', statement: 'Apply knowledge of mathematics…' }],
  };

  it('accepts a well-formed outcome set', () => {
    const ok = validate(base);
    if (!ok) throw new Error(explain(validate));
    expect(ok).toBe(true);
  });

  it('rejects a file with no provenance', () => {
    // Provenance is the registry's entire credibility: an untraceable outcome statement is
    // worse than a missing one, because it will be trusted.
    for (const field of ['source_document', 'source_url', 'retrieved_on', 'verified_on']) {
      const doc: Record<string, unknown> = { ...base };
      delete doc[field];
      expect(validate(doc), `${field} should be required`).toBe(false);
    }
  });

  it('rejects an id that is not a registry path', () => {
    expect(validate({ ...base, id: 'GAPC v4' })).toBe(false);
  });

  it('carries the correspondence needed to migrate between versions', () => {
    // "PO6+PO7" means two outcomes collapsed into one — the case that cannot be resolved
    // mechanically and must block on a human decision.
    const doc = {
      ...base,
      outcomes: [{ code: 'PO6', kind: 'po', statement: 'The engineer and the world', migrated_from: 'PO6+PO7' }],
    };
    expect(validate(doc)).toBe(true);
  });

  it('refuses to be used for a criterion-based body', () => {
    // NAAC has no outcomes to list. Forcing it through this schema would invent them.
    expect(validate({ ...base, kind: 'criteria' })).toBe(false);
  });
});

describe('framework-criteria schema — how NAAC and NIRF are modelled', () => {
  const validate = compile('framework-criteria');

  const naac = {
    id: 'naac/binary-2025',
    body: 'NAAC',
    version: 'binary-2025',
    kind: 'criteria',
    assessment_model: 'binary',
    institution_scope: true,
    effective_from: '2025-02-01',
    source_document: 'NAAC Binary Accreditation Framework',
    source_url: 'https://example.org/naac.pdf',
    retrieved_on: '2026-07-29',
    verified_on: '2026-07-29',
    retires: ['cgpa-raf'],
    criteria: [
      {
        code: '1',
        title: 'Curricular Aspects',
        metric_type: 'quantitative',
        evidence_sources: [
          { kind: 'po_attainment', description: 'Programme outcome attainment per term' },
          { kind: 'articulation_matrix' },
        ],
      },
    ],
  };

  it('accepts NAAC as criteria that consume outcome evidence', () => {
    const ok = validate(naac);
    if (!ok) throw new Error(explain(validate));
    expect(ok).toBe(true);
  });

  it('models maturity levels for MBGL', () => {
    const mbgl = {
      ...naac,
      id: 'naac/mbgl',
      version: 'mbgl-2025',
      assessment_model: 'graded_levels',
      levels: [
        { level: 1, label: 'Level 1', criteria_required: ['1'] },
        { level: 5, label: 'Level 5', criteria_required: ['1'] },
      ],
    };
    const ok = validate(mbgl);
    if (!ok) throw new Error(explain(validate));
    expect(ok).toBe(true);
  });

  it('records which assessment models a version retires', () => {
    // NAAC's CGPA/RAF grading is withdrawn. Stating that in data lets an export template
    // hard-fail rather than silently emit a submission in a shape the body no longer takes.
    expect(naac.retires).toContain('cgpa-raf');
    expect(validate(naac)).toBe(true);
  });

  it('lets a criterion declare that attainment data cannot evidence it', () => {
    // Honest coverage beats claimed coverage: 'external' says a separate submission is
    // needed rather than implying the platform has it covered.
    const doc = {
      ...naac,
      criteria: [
        { code: '7', title: 'Institutional Values', metric_type: 'qualitative', evidence_sources: [{ kind: 'external' }] },
      ],
    };
    expect(validate(doc)).toBe(true);
  });

  it('rejects an unknown evidence kind', () => {
    const doc = { ...naac, criteria: [{ code: '1', title: 'x', evidence_sources: [{ kind: 'vibes' }] }] };
    expect(validate(doc)).toBe(false);
  });

  it('rejects an outcome-based body being described as criteria without a model', () => {
    const doc: Record<string, unknown> = { ...naac };
    delete doc.assessment_model;
    expect(validate(doc)).toBe(false);
  });
});

describe('engine contracts', () => {
  it('engine-input requires the framework binding the engine guards on', () => {
    const validate = compile('engine-input');
    const doc = {
      offering: { id: 'o1', course: { id: 'c', code: 'CS201', title: 'DS', credits: 4, type: 'theory' } },
      course_outcomes: [{ id: 'co1', code: 'CO1' }],
      outcomes: [{ id: 'po1', code: 'PO1', kind: 'po' }],
      articulation: [],
      assessments: [],
      questions: [],
      question_outcomes: [],
      enrollments: [],
      marks: [],
    };
    expect(validate(doc)).toBe(false);
    expect(explain(validate)).toMatch(/framework/);
  });

  it('engine-output requires a hash, versions and a trace on every value', () => {
    const validate = compile('engine-output');
    const doc = {
      engine_version: '0.1.0',
      policy_id: 'p',
      policy_version: '1.0.0',
      framework: { code: 'nba-ug-eng', version: 'gapc-v4.0' },
      input_hash: 'abc',
      computed_at: '2026-07-29T00:00:00.000Z',
      offering_id: 'o1',
      scale: { kind: 'level', min: 0, max: 3 },
      see_mode: 'question_wise',
      stamps: [],
      cohort_summary: { considered: 1, excluded: 0, exclusion_reasons: {} },
      co_attainments: [{ course_outcome_id: 'co1', code: 'CO1', students_considered: 1, warnings: [] }],
      po_attainments: [],
      warnings: [],
    };
    // The CO entry has no trace — an untraceable number is exactly what this contract exists
    // to make impossible.
    expect(validate(doc)).toBe(false);
    expect(explain(validate)).toMatch(/trace/);
  });
});

describe('registry contents', () => {
  it('every framework file validates against the schema its kind selects', () => {
    const dir = join(root, 'frameworks');
    if (!existsSync(dir)) return;

    const compiled = new Map(Object.values(SCHEMA_FOR_KIND).map((n) => [n, compile(n)]));

    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.json') ? [join(d, e.name)] : [],
      );

    for (const file of walk(dir)) {
      const doc = read(file);
      if (!doc.kind) continue; // index.json and similar

      const schemaName = SCHEMA_FOR_KIND[doc.kind];
      // An unrecognised kind must fail loudly. Falling back to a default schema is how a
      // file ends up silently validated against rules that were never meant for it.
      if (!schemaName) throw new Error(`${file} declares unknown kind "${doc.kind}".`);

      const validate = compiled.get(schemaName)!;
      if (!validate(doc)) throw new Error(`${file} failed validation:\n${explain(validate)}`);
    }
  });
});

describe('the NBA framework files (OSS-SPLIT step 3)', () => {
  const outcomes = compile('framework-outcomes');
  const wk = compile('framework-knowledge-indicators');
  const fw = (p: string) => read(join(root, 'frameworks', p));

  const v3 = fw('nba/gapc-v3.0/outcomes.json');
  const v4 = fw('nba/gapc-v4.0/outcomes.json');
  const indicators = fw('nba/gapc-v4.0/wk-indicators.json');
  const index = fw('index.json');

  it('both outcome sets validate', () => {
    for (const [name, doc] of [['v3', v3], ['v4', v4]] as const) {
      if (!outcomes(doc)) throw new Error(`${name}:\n${explain(outcomes)}`);
    }
    if (!wk(indicators)) throw new Error(explain(wk));
    expect(true).toBe(true);
  });

  it('holds 12 outcomes under v3 and 11 under v4', () => {
    expect(v3.outcomes).toHaveLength(12);
    expect(v4.outcomes).toHaveLength(11);
    expect(v3.outcome_count).toBe(v3.outcomes.length);
    expect(v4.outcome_count).toBe(v4.outcomes.length);
  });

  it('links the two versions in both directions', () => {
    // A one-way link means a reader of the old file cannot discover it is retired.
    expect(v4.supersedes).toBe(v3.id);
    expect(v3.superseded_by).toBe(v4.id);
  });

  it('is honest that nothing has been verified yet', () => {
    // The whole registry rests on verified_on meaning what it says. Seeding it with a
    // plausible date to make the badge green would be the one unrecoverable mistake here.
    for (const doc of [v3, v4, indicators]) {
      expect(doc.verified_on).toBeNull();
      expect(doc.verification_note.length).toBeGreaterThan(20);
    }
  });

  it('records the v3 to v4 changelog with the outcomes it affects', () => {
    const entry = v4.changelog.find((c: { from: string }) => c.from === v3.id);
    expect(entry).toBeDefined();
    expect(entry.affects).toEqual(expect.arrayContaining(['PO6', 'PO7', 'PO8']));
  });

  it('marks exactly the two outcomes that cannot migrate mechanically', () => {
    const retired = v3.outcomes.filter((o: { retired_in?: string }) => o.retired_in === 'gapc-v4.0');
    expect(retired.map((o: { code: string }) => o.code)).toEqual(['PO7', 'PO8']);
    for (const o of retired) expect(o.migration_note).toBeTruthy();
  });

  it('shows the twelve-to-eleven reduction as a genuine merge', () => {
    // "PO6+PO7" is the signal that two outcomes collapsed into one — the case that has to
    // block on a human decision instead of being auto-assigned.
    const merged = v4.outcomes.find((o: { code: string }) => o.code === 'PO6');
    expect(merged.migrated_from).toBe('PO6+PO7');
    expect(merged.migration_note).toMatch(/must NOT be auto-assigned/i);
  });

  it('accounts for every v3 outcome in the v4 correspondence', () => {
    const claimed = new Set(
      v4.outcomes.flatMap((o: { migrated_from?: string }) =>
        (o.migrated_from ?? '').split('+').map((s) => s.trim()).filter(Boolean),
      ),
    );
    const missing = v3.outcomes.map((o: { code: string }) => o.code).filter((c: string) => !claimed.has(c));
    expect(missing).toEqual([]);
  });

  it('cross-references only knowledge indicators that exist', () => {
    const defined = new Set(indicators.knowledge_indicators.map((k: { code: string }) => k.code));
    for (const o of v4.outcomes) {
      for (const code of o.knowledge_indicators ?? []) {
        expect(defined.has(code), `${o.code} references unknown ${code}`).toBe(true);
      }
    }
    expect(v4.knowledge_indicators_ref).toBe('wk-indicators.json');
  });

  it('keeps the index in step with the files on disk', () => {
    for (const entry of index.entries) {
      const doc = fw(entry.path);
      expect(doc.id, `${entry.path} id`).toBe(entry.id);
      expect(doc.kind, `${entry.path} kind`).toBe(entry.kind);
      expect(doc.verified_on ?? null, `${entry.path} verified_on`).toBe(entry.verified_on);
    }
  });

  it('does not claim NIRF or ABET are shipped', () => {
    // Listing what is not here, with the reason it is blocked, is more useful than an empty
    // directory or a fabricated file.
    const planned = index.planned.map((p: { id: string }) => p.id);
    expect(planned).toEqual(expect.arrayContaining(['nirf/2026', 'abet/eac', 'naac/mbgl']));
    const shipped = index.entries.map((e: { id: string }) => e.id);
    for (const id of planned) expect(shipped).not.toContain(id);
  });

  it('ships NAAC as criteria carrying titles only, with nothing invented', () => {
    // The seven criterion titles are stable and long-published. Key indicators, their codes
    // and any weightages are not: NAAC's manuals are institution-type specific and were
    // revised for binary accreditation. Approximating them would produce a file that looks
    // authoritative and is not, which is worse than shipping the structure alone.
    const naac = index.entries.find((e: { id: string }) => e.id === 'naac/binary-2025');
    expect(naac).toBeDefined();

    const doc = fw(naac.path);
    expect(doc.kind).toBe('criteria');
    expect(doc.assessment_model).toBe('binary');
    expect(doc.institution_scope).toBe(true);
    expect(doc.criteria).toHaveLength(7);
    expect(doc.verified_on).toBeNull();

    for (const c of doc.criteria) {
      expect(c.title, 'every criterion is titled').toBeTruthy();
      expect(c.statement, 'no criterion carries invented official wording').toBeUndefined();
      expect(c.weight, 'binary accreditation assigns no weightage').toBeUndefined();
      expect(c.sub_criteria, 'no key indicators are invented').toBeUndefined();
    }
  });

  it('says plainly which NAAC criteria attainment data cannot evidence', () => {
    // A criterion honestly marked unevidenced is worth more than one padded with a number
    // that does not answer the question.
    const doc = fw('naac/binary-2025/criteria.json');
    const external = doc.criteria.filter((c: { evidence_sources?: { kind: string }[] }) =>
      (c.evidence_sources ?? []).some((s) => s.kind === 'external'),
    );
    expect(external.length).toBeGreaterThan(0);
    for (const c of external) {
      const ext = c.evidence_sources.find((s: { kind: string }) => s.kind === 'external');
      expect(ext.description, `criterion ${c.code} says what is missing`).toBeTruthy();
    }
  });

  it('retires the grading model NAAC withdrew', () => {
    // Emitting a CGPA/RAF grade would produce a submission in a format the body no longer
    // accepts, which fails at the portal rather than in review.
    const doc = fw('naac/binary-2025/criteria.json');
    expect(doc.retires).toContain('cgpa-raf');
  });
});

describe('published README', () => {
  /**
   * The npm page is the README, and its first code block is the first thing anyone runs.
   *
   * `@factsh/attainment-engine@0.1.0` shipped with an example calling `computeAttainment`,
   * which the engine does not export — written from memory rather than from the export list,
   * and caught only by installing the published package and importing it. A README that
   * fails on line one is worse than no README: it reads as though the package is broken.
   */
  const readme = readFileSync(new URL('../packages/engine/README.md', import.meta.url), 'utf8');

  it('only names symbols the engine actually exports', async () => {
    const engine = await import('../packages/engine/src/index.js');
    const exported = new Set(Object.keys(engine));

    // Every identifier the README imports, from every import statement in it.
    const imported = [...readme.matchAll(/import\s*\{([^}]+)\}\s*from\s*'@factsh\/attainment-engine'/g)]
      .flatMap((m) => m[1]!.split(',').map((s) => s.trim()).filter(Boolean));

    expect(imported.length, 'the README shows at least one import').toBeGreaterThan(0);
    for (const name of imported) {
      expect(exported, `README imports ${name}`).toContain(name);
    }
  });

  it('names symbols in prose that exist too', async () => {
    const engine = await import('../packages/engine/src/index.js');
    const exported = new Set(Object.keys(engine));

    // Backticked identifiers that look like exports — camelCase functions or Error classes.
    const claimed = [...readme.matchAll(/`([a-z][A-Za-z]+|[A-Z][A-Za-z]*Error)`/g)]
      .map((m) => m[1]!)
      .filter((n) => /^compute|^validate|Error$/.test(n));

    for (const name of new Set(claimed)) {
      expect(exported, `README mentions ${name}`).toContain(name);
    }
  });
});

describe('grade targets', () => {
  it('rejects an order that disagrees with the mapping', async () => {
    // "At or above C" must mean the grades the institution considers at least as good as C.
    // An order that runs the other way would admit exactly the wrong set, and every figure
    // downstream would still look reasonable.
    const { validatePolicy } = await import('../packages/engine/src/index.js');
    const base = JSON.parse(
      readFileSync(join(root, 'fixtures', 'policies', 'per-instrument-targets.json'), 'utf8'),
    );
    expect(validatePolicy(base)).toEqual([]);

    const scrambled = {
      ...base,
      grade_scale: { ...base.grade_scale, order: ['F', 'P', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+', 'S'] },
    };
    expect(validatePolicy(scrambled).join(' ')).toMatch(/best-to-worst|higher percentage/i);
  });

  it('rejects an order naming a grade the mapping has no percentage for', () => {
    const base = JSON.parse(
      readFileSync(join(root, 'fixtures', 'policies', 'per-instrument-targets.json'), 'utf8'),
    );
    const withGhost = {
      ...base,
      grade_scale: { ...base.grade_scale, order: [...base.grade_scale.order, 'X'] },
    };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return import('../packages/engine/src/index.js').then(({ validatePolicy }) => {
      expect(validatePolicy(withGhost).join(' ')).toMatch(/no percentage for|could not be resolved/i);
    });
  });
});
