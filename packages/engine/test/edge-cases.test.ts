/**
 * The edge-case register (spec §12), one named test each.
 *
 * The spec's instruction is "write a test for each of these before considering the engine
 * done", so the numbering here is deliberate and should stay aligned with the document.
 */

import { describe, expect, it } from 'vitest';
import { computeOffering, computeProgram, FrameworkMismatchError } from '../src/index.js';
import {
  CTX,
  NBA_V3,
  NBA_V4,
  affiliatedPolicy,
  coOf,
  hasWarning,
  poOf,
  policy,
  scenario,
  students,
} from './helpers.js';

const lenient = { validation: { min_assessments_per_co: 1 }, cohort: { min_cohort_size: 1 } };

describe('§12.1 — choice questions whose alternatives map to different COs', () => {
  // "Answer either Q5 or Q6." Q5 tests CO2, Q6 tests CO3. Four students, two taking each.
  const input = scenario({
    cos: ['CO1', 'CO2', 'CO3'],
    outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3 } },
    choiceGroups: [{ id: 'either', assessment: 'A1', required: 1 }],
    assessments: [
      {
        id: 'A1',
        weight: 100,
        max: 20,
        questions: [
          { label: 'Q1', max: 10, co: 'CO1' },
          { label: 'Q5', max: 10, co: 'CO2', choice: 'either' },
          { label: 'Q6', max: 10, co: 'CO3', choice: 'either' },
        ],
      },
    ],
    students: [
      { roll: 'R1', marks: { 'A1:Q1': 7, 'A1:Q5': 8, 'A1:Q6': null } },
      { roll: 'R2', marks: { 'A1:Q1': 7, 'A1:Q5': 9, 'A1:Q6': null } },
      { roll: 'R3', marks: { 'A1:Q1': 7, 'A1:Q5': null, 'A1:Q6': 5 } },
      { roll: 'R4', marks: { 'A1:Q1': 7, 'A1:Q5': null, 'A1:Q6': 3 } },
    ],
  });

  const result = computeOffering(input, policy(lenient), CTX);

  it('measures each student against their own denominator', () => {
    // R1 answered Q5 only. Their CO2 percentage is 8/10, NOT 8/20 — the unanswered Q6 is
    // not part of their paper. A class-wide denominator is the classic wrong answer here.
    const co2 = coOf(result, 'CO2');
    expect(co2.trace.students.find((s) => s.roll_no === 'R1')?.pct).toBeCloseTo(0.8, 10);
    expect(co2.trace.students.find((s) => s.roll_no === 'R1')?.maximum).toBe(10);
  });

  it('counts only the students who actually answered, in each CO’s cohort', () => {
    expect(coOf(result, 'CO2').students_considered).toBe(2);
    expect(coOf(result, 'CO3').students_considered).toBe(2);
    // CO1 was compulsory, so everyone counts.
    expect(coOf(result, 'CO1').students_considered).toBe(4);
  });

  it('leaves a student unmeasured on the CO they did not attempt', () => {
    const co3 = coOf(result, 'CO3');
    const r1 = co3.trace.students.find((s) => s.roll_no === 'R1');
    expect(r1?.pct).toBeUndefined();
    expect(r1?.maximum).toBe(0);
  });
});

describe('§12.2 — a question mapped to two COs with 0.6 / 0.4 weights', () => {
  const input = scenario({
    cos: ['CO1', 'CO2'],
    outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3, CO2: 2 } },
    assessments: [
      {
        id: 'A1',
        weight: 100,
        questions: [
          { label: 'Q1', max: 10, co: { CO1: 0.6, CO2: 0.4 } },
          { label: 'Q2', max: 10, co: 'CO1' },
        ],
      },
    ],
    students: [{ roll: 'R1', marks: { 'A1:Q1': 8, 'A1:Q2': 4 } }],
  });

  const result = computeOffering(input, policy(lenient), CTX);

  it('splits both the numerator and the denominator by the weight', () => {
    // CO1: obtained = 8·0.6 + 4·1 = 8.8 ; maximum = 10·0.6 + 10·1 = 16 ; pct = 0.55
    const co1 = coOf(result, 'CO1').trace.students[0]!;
    expect(co1.obtained).toBeCloseTo(8.8, 10);
    expect(co1.maximum).toBeCloseTo(16, 10);
    expect(co1.pct).toBeCloseTo(0.55, 10);
  });

  it('leaves a single shared question’s percentage unchanged by its weight', () => {
    // CO2 sees only Q1: 8·0.4 / 10·0.4 = 0.8. Weighting redistributes influence between
    // COs; it does not distort the percentage of a question measured alone.
    const co2 = coOf(result, 'CO2').trace.students[0]!;
    expect(co2.pct).toBeCloseTo(0.8, 10);
  });
});

describe('§12.3 — a student absent for one assessment but present for others', () => {
  const build = (absentHandling: 'exclude' | 'zero') =>
    computeOffering(
      scenario({
        cos: ['CO1'],
        outcomes: ['PO1'],
        articulation: { PO1: { CO1: 3 } },
        assessments: [
          { id: 'A1', weight: 50, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
          { id: 'A2', weight: 50, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
        ],
        students: [
          { roll: 'R1', marks: { 'A1:Q1': 8 }, assessmentStatus: { A2: 'absent' } },
          { roll: 'R2', marks: { 'A1:Q1': 6, 'A2:Q1': 6 } },
        ],
      }),
      policy({ ...lenient, cohort: { ...lenient.cohort, absent_handling: absentHandling } }),
      CTX,
    );

  it('under "exclude", keeps the student, scored on the assessments they sat', () => {
    const r1 = coOf(build('exclude'), 'CO1').trace.students.find((s) => s.roll_no === 'R1');
    expect(r1?.pct).toBeCloseTo(0.8, 10);
  });

  it('under "zero", scores the missed assessment as nothing', () => {
    // Half the course at 0.8 and half at 0 → 0.4.
    const r1 = coOf(build('zero'), 'CO1').trace.students.find((s) => s.roll_no === 'R1');
    expect(r1?.pct).toBeCloseTo(0.4, 10);
  });

  it('changes the attainment level — which is why the setting is surfaced in the UI', () => {
    expect(coOf(build('exclude'), 'CO1').direct_value).not.toBe(
      coOf(build('zero'), 'CO1').direct_value,
    );
  });
});

describe('§12.4–12.6 — enrolment status rules', () => {
  const build = (status: 'dropped' | 'audit' | 'backlog', patch = {}) =>
    computeOffering(
      scenario({
        cos: ['CO1'],
        outcomes: ['PO1'],
        articulation: { PO1: { CO1: 3 } },
        assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
        students: [
          { roll: 'R1', marks: { 'A1:Q1': 9 } },
          { roll: 'R2', marks: { 'A1:Q1': 2 }, status },
        ],
      }),
      policy({ ...lenient, ...patch }),
      CTX,
    );

  it('§12.4 excludes a student who dropped mid-term', () => {
    const r = build('dropped');
    expect(coOf(r, 'CO1').students_considered).toBe(1);
    expect(r.cohort_summary.exclusion_reasons.dropped).toBe(1);
  });

  it('§12.5 excludes an audit enrolment', () => {
    expect(build('audit').cohort_summary.exclusion_reasons.audit).toBe(1);
  });

  it('§12.6 excludes backlog students by default but includes them on request', () => {
    expect(build('backlog').cohort_summary.exclusion_reasons.backlog).toBe(1);
    const included = build('backlog', { cohort: { ...lenient.cohort, include_backlog_students: true } });
    expect(coOf(included, 'CO1').students_considered).toBe(2);
  });
});

describe('§12.7 — malpractice voids a score rather than zeroing it', () => {
  const build = (handling: 'exclude' | 'zero') =>
    computeOffering(
      scenario({
        cos: ['CO1'],
        outcomes: ['PO1'],
        articulation: { PO1: { CO1: 3 } },
        assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
        students: [
          { roll: 'R1', marks: { 'A1:Q1': 9 } },
          { roll: 'R2', marks: { 'A1:Q1': 0 }, assessmentStatus: { A1: 'malpractice' } },
        ],
      }),
      policy({ ...lenient, cohort: { ...lenient.cohort, malpractice_handling: handling } }),
      CTX,
    );

  it('drops the student from the CO cohort under the default rule', () => {
    // Voiding says "this is not evidence". Zeroing asserts the student demonstrated
    // nothing, which is a different — and unsupported — claim.
    const co1 = coOf(build('exclude'), 'CO1');
    expect(co1.students_considered).toBe(1);
    expect(co1.trace.students.find((s) => s.roll_no === 'R2')?.excluded_reason).toBe('malpractice');
  });

  it('counts it as zero only when the policy explicitly says so', () => {
    expect(coOf(build('zero'), 'CO1').students_considered).toBe(2);
  });
});

describe('§12.8 — best-two-of-three where the best two differ per CO', () => {
  const quiz = (id: string, a: number, b: number) => ({
    id,
    weight: 1,
    group: 'G',
    questions: [
      { label: 'Qa', max: 10, co: 'CO1' },
      { label: 'Qb', max: 10, co: 'CO3' },
    ],
    scores: { [`${id}:Qa`]: a, [`${id}:Qb`]: b },
  });

  const q1 = quiz('Z1', 9, 3);
  const q2 = quiz('Z2', 5, 9);
  const q3 = quiz('Z3', 7, 6);

  const result = computeOffering(
    scenario({
      cos: ['CO1', 'CO3'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      groups: [{ id: 'G', name: 'Quizzes', rule: 'best_n', n: 2, weight: 100 }],
      assessments: [q1, q2, q3].map(({ scores: _s, ...a }) => a),
      students: [{ roll: 'R1', marks: { ...q1.scores, ...q2.scores, ...q3.scores } }],
    }),
    policy(lenient),
    CTX,
  );

  it('selects per CO, not once per student', () => {
    // CO1 percentages 0.9 / 0.5 / 0.7 → keeps Z1 and Z3 → 0.80
    // CO3 percentages 0.3 / 0.9 / 0.6 → keeps Z2 and Z3 → 0.75
    // A single per-student selection would have to pick one pair and be wrong for one CO.
    expect(coOf(result, 'CO1').trace.students[0]?.pct).toBeCloseTo(0.8, 10);
    expect(coOf(result, 'CO3').trace.students[0]?.pct).toBeCloseTo(0.75, 10);
  });
});

describe('§12.9 — a CO with no questions mapped to it', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1', 'CO4'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3, CO4: 2 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: [{ roll: 'R1', marks: { 'A1:Q1': 8 } }],
    }),
    policy(lenient),
    CTX,
  );

  it('warns loudly rather than silently scoring zero', () => {
    const co4 = coOf(result, 'CO4');
    expect(co4.direct_value).toBeUndefined();
    expect(co4.final_value).toBeUndefined();
    expect(co4.warnings.map((w) => w.code)).toContain('CO_NOT_ASSESSED');
    expect(result.warnings.find((w) => w.code === 'CO_NOT_ASSESSED')?.severity).toBe('error');
  });

  it('keeps the unmeasured CO out of the PO calculation entirely', () => {
    // CO4 contributes nothing rather than dragging PO1 down with a fabricated zero.
    expect(poOf(result, 'PO1').value).toBeCloseTo(coOf(result, 'CO1').final_value!, 10);
  });
});

describe('§12.10 — a PO with no CO mapped to it across an entire program', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1'],
      outcomes: ['PO1', 'PO2'],
      articulation: { PO1: { CO1: 3 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: [{ roll: 'R1', marks: { 'A1:Q1': 8 } }],
    }),
    policy(lenient),
    CTX,
  );

  it('leaves the unmapped outcome uncomputed on the course report', () => {
    expect(poOf(result, 'PO2').value).toBeUndefined();
  });

  it('does not warn per course — one course is not meant to address every PO', () => {
    // Warning here would fire half a dozen times on every course report under an 11-PO
    // framework, which is how a warnings panel becomes wallpaper.
    expect(hasWarning(result, 'PO_UNMAPPED')).toBe(false);
  });

  it('warns at program level, where an unmapped PO is a real gap', () => {
    const rollup = computeProgram(
      {
        program_id: 'prog:cse',
        framework: NBA_V4,
        outcomes: [
          { id: 'outcome:PO1', code: 'PO1', kind: 'po' },
          { id: 'outcome:PO2', code: 'PO2', kind: 'po' },
        ],
        courses: [
          {
            offering_id: 'offering:1',
            course_id: 'course:1',
            course_code: 'CS201',
            credits: 4,
            po_attainments: result.po_attainments,
          },
        ],
      },
      policy(lenient),
      CTX,
    );
    const unmapped = rollup.warnings.filter((w) => w.code === 'PO_UNMAPPED');
    expect(unmapped.map((w) => w.subject?.outcome_code)).toEqual(['PO2']);
  });
});

describe('§10.3 — articulation matrix validations, at course scope', () => {
  const build = (articulation: Record<string, Record<string, number>>, cos = ['CO1', 'CO2']) =>
    computeOffering(
      scenario({
        cos,
        outcomes: ['PO1', 'PO2', 'PO3', 'PO4', 'PO5', 'PO6', 'PO7'],
        articulation,
        assessments: [
          {
            id: 'A1',
            weight: 100,
            questions: cos.map((co, i) => ({ label: `Q${i + 1}`, max: 10, co })),
          },
        ],
        students: [{ roll: 'R1', marks: Object.fromEntries(cos.map((_, i) => [`A1:Q${i + 1}`, 8])) }],
      }),
      policy(lenient),
      CTX,
    );

  it('treats a CO mapped to no PO as an error', () => {
    // Nothing this CO measures can reach a program outcome, so it is invisible to the SAR.
    const r = build({ PO1: { CO1: 3 } });
    const w = r.warnings.find((x) => x.code === 'CO_UNMAPPED');
    expect(w?.severity).toBe('error');
    expect(w?.subject?.course_outcome_id).toBe('co:CO2');
  });

  it('warns when a CO claims to evidence implausibly many POs', () => {
    const r = build({
      PO1: { CO1: 3 },
      PO2: { CO1: 3 },
      PO3: { CO1: 3 },
      PO4: { CO1: 3 },
      PO5: { CO1: 3 },
      PO6: { CO1: 3 },
      PO7: { CO1: 3 },
    }, ['CO1']);
    // Policy sets the plausible limit at 6.
    expect(r.warnings.find((x) => x.code === 'CO_OVER_MAPPED')?.detail?.mapped_to).toBe(7);
  });

  it('stays quiet on a sensibly-filled matrix', () => {
    const r = build({ PO1: { CO1: 3, CO2: 2 }, PO2: { CO1: 2 } });
    expect(hasWarning(r, 'CO_UNMAPPED')).toBe(false);
    expect(hasWarning(r, 'CO_OVER_MAPPED')).toBe(false);
    expect(hasWarning(r, 'PO_UNMAPPED')).toBe(false);
  });
});

describe('§12.11 — SEE totals only, no blueprint', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1', 'CO2'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      seeMode: 'uniform_split',
      assessments: [
        { id: 'CIE', weight: 40, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
        { id: 'SEE', kind: 'see', weight: 60, max: 60 },
      ],
      students: [
        { roll: 'R1', marks: { 'CIE:Q1': 8 }, totals: { SEE: 45 } },
        { roll: 'R2', marks: { 'CIE:Q1': 5 }, totals: { SEE: 30 } },
      ],
    }),
    policy(lenient),
    CTX,
  );

  it('apportions the total across every mapped CO', () => {
    // R1: 45/60 = 0.75 on both COs, since apportionment scales numerator and denominator
    // by the same share and therefore adds no per-outcome information.
    const co2 = coOf(result, 'CO2');
    expect(co2.trace.students.find((s) => s.roll_no === 'R1')?.pct).toBeCloseTo(0.75, 10);
  });

  it('stamps the report so a reader can tell this from a full computation', () => {
    expect(result.stamps).toContain('SEE apportioned uniformly');
    expect(hasWarning(result, 'SEE_FALLBACK_USED')).toBe(true);
  });
});

describe('§12.11b — SEE totals with a published blueprint', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1', 'CO2'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      seeMode: 'blueprint_uniform',
      seeBlueprint: { CO1: 40, CO2: 20 },
      assessments: [
        { id: 'CIE', weight: 40, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
        { id: 'SEE', kind: 'see', weight: 60, max: 60 },
      ],
      students: [{ roll: 'R1', marks: { 'CIE:Q1': 8 }, totals: { SEE: 45 } }],
    }),
    affiliatedPolicy(lenient),
    CTX,
  );

  it('carries the blueprint stamp', () => {
    expect(result.stamps).toContain('SEE apportioned by published blueprint');
  });

  it('weights each CO’s SEE denominator by its share of the paper', () => {
    // CO1 holds 40 of the 60 blueprint marks → denominator 60·(40/60) = 40.
    const co1 = coOf(result, 'CO1');
    const see = co1.trace.students[0]?.per_assessment.find((a) => a.assessment_id === 'SEE');
    expect(see?.maximum).toBeCloseTo(40, 10);
    expect(see?.pct).toBeCloseTo(0.75, 10);
  });
});

describe('§12.12 — SEE available as grades only', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      seeMode: 'uniform_split',
      assessments: [
        { id: 'CIE', weight: 40, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
        { id: 'SEE', kind: 'see', weight: 60, max: 60 },
      ],
      students: [{ roll: 'R1', marks: { 'CIE:Q1': 8 }, grades: { SEE: 'A' } }],
    }),
    affiliatedPolicy(lenient),
    CTX,
  );

  it('converts through the grade scale and marks the result grade-derived', () => {
    // 'A' maps to 75% of the 60-mark paper = 45.
    const see = coOf(result, 'CO1').trace.students[0]?.per_assessment.find(
      (a) => a.assessment_id === 'SEE',
    );
    expect(see?.obtained).toBeCloseTo(45, 10);
    expect(result.stamps).toContain('Grade-derived components');
  });

  it('refuses the conversion when the policy has not enabled a grade scale', () => {
    const strict = computeOffering(
      scenario({
        cos: ['CO1'],
        outcomes: ['PO1'],
        articulation: { PO1: { CO1: 3 } },
        seeMode: 'uniform_split',
        assessments: [
          { id: 'CIE', weight: 40, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
          { id: 'SEE', kind: 'see', weight: 60, max: 60 },
        ],
        students: [{ roll: 'R1', marks: { 'CIE:Q1': 8 }, grades: { SEE: 'A' } }],
      }),
      policy(lenient), // pack #1 has grade_scale.enabled = false
      CTX,
    );
    expect(hasWarning(strict, 'SEE_DATA_MISSING')).toBe(true);
  });
});

describe('§12.13 — zero (or too few) survey responses', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: [{ roll: 'R1', marks: { 'A1:Q1': 8 } }],
      survey: { responses: { CO1: [5, 4] } }, // policy requires 10
    }),
    policy(lenient),
    CTX,
  );

  it('suppresses indirect attainment and falls back to direct', () => {
    const co1 = coOf(result, 'CO1');
    expect(co1.indirect_value).toBeUndefined();
    expect(co1.final_value).toBe(co1.direct_value);
  });

  it('stamps the report rather than letting the fallback pass unnoticed', () => {
    expect(hasWarning(result, 'INDIRECT_SUPPRESSED')).toBe(true);
    expect(result.stamps).toContain('Indirect attainment suppressed — insufficient survey responses');
  });
});

describe('§12.13b — a survey with enough responses does contribute', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: students(10, () => ({ 'A1:Q1': 8 })),
      survey: { responses: { CO1: Array(10).fill(4) }, invited: 10 },
    }),
    policy({ validation: { min_assessments_per_co: 1 } }),
    CTX,
  );

  it('maps the mean rating linearly onto the attainment scale', () => {
    // Rating 4 on a 1–5 scale is 0.75 of the way up, mapped onto 0–3 → 2.25.
    expect(coOf(result, 'CO1').indirect_value).toBeCloseTo(2.25, 10);
  });

  it('blends direct and indirect at the policy weights', () => {
    // Everyone scored 0.8 → ratio 1.0 → level 3. final = 0.8·3 + 0.2·2.25 = 2.85
    expect(coOf(result, 'CO1').final_value).toBeCloseTo(2.85, 10);
  });
});

describe('§12.14 — every student above target', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: students(20, () => ({ 'A1:Q1': 9 })),
    }),
    policy({ validation: { min_assessments_per_co: 1 } }),
    CTX,
  );

  it('reaches the top band without a division problem', () => {
    const co1 = coOf(result, 'CO1');
    expect(co1.trace.ratio).toBe(1);
    expect(co1.direct_value).toBe(3);
    expect(Number.isFinite(co1.final_value!)).toBe(true);
  });
});

describe('§12.15 — a single-student cohort', () => {
  const result = computeOffering(
    scenario({
      cos: ['CO1'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: [{ roll: 'R1', marks: { 'A1:Q1': 8 } }],
    }),
    policy({ validation: { min_assessments_per_co: 1 } }),
    CTX,
  );

  it('computes, but marks the result indicative', () => {
    expect(coOf(result, 'CO1').direct_value).toBe(3);
    expect(result.stamps).toContain('Small cohort — indicative only');
    expect(hasWarning(result, 'SMALL_COHORT')).toBe(true);
  });
});

describe('§12.16 — blueprint CO mapping edited after marks entry', () => {
  const base = scenario({
    cos: ['CO1', 'CO2'],
    outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3 } },
    assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
    students: [{ roll: 'R1', marks: { 'A1:Q1': 8 } }],
  });

  it('changes the input hash, so a stored run can be detected as stale', () => {
    const before = computeOffering(base, policy(lenient), CTX);

    const edited = structuredClone(base);
    edited.question_outcomes = [
      { question_id: 'A1:Q1', course_outcome_id: 'co:CO2', weight: 1 },
    ];
    const after = computeOffering(edited, policy(lenient), CTX);

    expect(after.input_hash).not.toBe(before.input_hash);
  });
});

describe('§12.17 — two regulations running in the same term for one course code', () => {
  // Same course code, different cohorts, different CO sets. Attainment is computed per
  // offering, so the two never touch: the 2021 batch resolves its COs through its own
  // regulation and the 2024 batch through its own.
  const offering = (cos: string[], score: number) =>
    computeOffering(
      scenario({
        cos,
        outcomes: ['PO1'],
        articulation: { PO1: { [cos[0]!]: 3 } },
        assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: cos[0]! }] }],
        students: [{ roll: 'R1', marks: { 'A1:Q1': score } }],
      }),
      policy(lenient),
      CTX,
    );

  it('produces independent results with independent hashes', () => {
    const r2021 = offering(['CO1', 'CO2'], 9);
    const r2024 = offering(['CO1', 'CO2', 'CO3'], 5);
    expect(r2021.input_hash).not.toBe(r2024.input_hash);
    expect(r2021.co_attainments).toHaveLength(2);
    expect(r2024.co_attainments).toHaveLength(3);
  });
});

describe('§12.18 — one course, three sections, three different question papers', () => {
  const section = (name: string, max: number, score: number) =>
    computeOffering(
      scenario({
        cos: ['CO1'],
        outcomes: ['PO1'],
        articulation: { PO1: { CO1: 3 } },
        assessments: [{ id: name, weight: 100, questions: [{ label: 'Q1', max, co: 'CO1' }] }],
        students: [{ roll: `${name}-R1`, marks: { [`${name}:Q1`]: score } }],
      }),
      policy(lenient),
      CTX,
    );

  it('computes each section against its own paper', () => {
    // Different maxima, same percentage — sections are comparable even when papers differ.
    expect(coOf(section('P1', 10, 8), 'CO1').trace.students[0]?.pct).toBeCloseTo(0.8, 10);
    expect(coOf(section('P2', 25, 20), 'CO1').trace.students[0]?.pct).toBeCloseTo(0.8, 10);
    expect(coOf(section('P3', 50, 40), 'CO1').trace.students[0]?.pct).toBeCloseTo(0.8, 10);
  });
});

describe('§12.19 — recomputation after a policy change', () => {
  const input = scenario({
    cos: ['CO1'],
    outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3 } },
    assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 20, co: 'CO1' }] }],
    // Seven students at 70%, three at 55% — a group that sits between the two targets.
    students: students(10, (i) => ({ 'A1:Q1': i < 7 ? 14 : 11 })),
  });

  it('produces a different run, identifiable by policy version and hash', () => {
    const old = computeOffering(input, policy({ validation: { min_assessments_per_co: 1 } }), CTX);
    const revised = computeOffering(
      input,
      policy({ version: '2.1.0', direct: { target_pct: 50 }, validation: { min_assessments_per_co: 1 } }),
      CTX,
    );

    expect(revised.policy_version).toBe('2.1.0');
    expect(revised.input_hash).not.toBe(old.input_hash);
    // 7 of 10 cross 60% → ratio 0.7 → level 2. Lowering the target to 50% brings the 55%
    // group across too → ratio 1.0 → level 3.
    expect(old.co_attainments[0]?.direct_value).toBe(2);
    expect(revised.co_attainments[0]?.direct_value).toBe(3);
  });
});

describe('§12.20 — a late correction recorded as an override', () => {
  const input = scenario({
    cos: ['CO1'],
    outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3 } },
    assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
    students: [{ roll: 'R1', marks: { 'A1:Q1': 4 } }],
  });
  input.overrides = [
    {
      entity_type: 'co_attainment',
      entity_id: 'co:CO1',
      override_value: 2,
      reason: 'Q1 re-evaluation after the marks lock; see minute IQAC/2026/14.',
      author_id: 'user:hod',
      created_at: '2026-07-20T10:00:00.000Z',
    },
  ];

  const result = computeOffering(input, policy(lenient), CTX);

  it('applies the override but keeps the computed value alongside it', () => {
    const co1 = coOf(result, 'CO1');
    expect(co1.final_value).toBe(2);
    expect(co1.overridden?.original).toBe(0);
    expect(co1.overridden?.reason).toContain('re-evaluation');
  });

  it('marks it visibly, so no report can show the number as computed', () => {
    expect(hasWarning(result, 'OVERRIDE_APPLIED')).toBe(true);
  });
});

describe('§12.21 — a program spanning the v3 → v4 transition', () => {
  const v4Policy = policy(lenient);

  it('refuses to compute a v3 outcome set under a v4 policy', () => {
    const v3Input = scenario({
      framework: NBA_V3,
      cos: ['CO1'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      assessments: [{ id: 'A1', weight: 100, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] }],
      students: [{ roll: 'R1', marks: { 'A1:Q1': 8 } }],
    });

    expect(() => computeOffering(v3Input, v4Policy, CTX)).toThrow(FrameworkMismatchError);
    // Fatal rather than a warning: a 12-PO number presented for a post-2025 submission is
    // invalid, and a warning on a report gets read past.
    expect(() => computeOffering(v3Input, v4Policy, CTX)).toThrow(/Refusing to compute/);
  });

  it('rolls the two framework versions up as separate series', () => {
    const v3Rollup = computeProgram(
      {
        program_id: 'prog:cse',
        framework: NBA_V3,
        outcomes: [{ id: 'outcome:PO12', code: 'PO12', kind: 'po' }],
        courses: [],
      },
      policy({ framework: { version: 'gapc-v3.0' } }),
      CTX,
    );
    expect(v3Rollup.framework.version).toBe('gapc-v3.0');

    const v4Rollup = computeProgram(
      {
        program_id: 'prog:cse',
        framework: NBA_V4,
        outcomes: [{ id: 'outcome:PO11', code: 'PO11', kind: 'po' }],
        courses: [],
      },
      v4Policy,
      CTX,
    );
    expect(v4Rollup.framework.version).toBe('gapc-v4.0');
    expect(v4Rollup.input_hash).not.toBe(v3Rollup.input_hash);
  });

  it('flags a target left behind on an outcome the new framework does not define', () => {
    // Pack #1 targets PO1/PO2/PO3/PO6/PO7/PO11; under an 11-PO set there is no PO12, and a
    // stale PO12 target means the policy has not been migrated.
    const rollup = computeProgram(
      {
        program_id: 'prog:cse',
        framework: NBA_V4,
        outcomes: [{ id: 'outcome:PO1', code: 'PO1', kind: 'po' }],
        courses: [],
      },
      policy({ program: { targets_by_outcome: { PO1: 2.2, PO12: 2.0 } } }),
      CTX,
    );
    const staleCodes = rollup.warnings
      .filter((w) => w.code === 'TARGET_OUTCOME_UNKNOWN')
      .map((w) => w.subject?.outcome_code);
    expect(staleCodes).toContain('PO12');
    expect(staleCodes).not.toContain('PO1');
  });
});

describe('§12.22 — a CO whose only v3 mapping was to a retired PO', () => {
  it('is carried by the migration policy, which never auto-maps PO7 or PO8', () => {
    // The migration itself lives in @attainment/frameworks; what the engine guarantees is
    // that the policy declaring those two codes as human-decision-only survives resolution.
    const p = policy();
    expect(p.migration?.require_human_decision_for).toEqual(['PO7', 'PO8']);
    expect(p.migration?.recompute_historical_terms).toBe(false);
  });
});

describe('blueprint validation and choice questions', () => {
  // A regression: counting every printed alternative would warn on almost every Indian
  // question paper, and a warning that fires constantly is one nobody reads.
  const paper = (max: number) =>
    scenario({
      cos: ['CO1', 'CO2'],
      outcomes: ['PO1'],
      articulation: { PO1: { CO1: 3 } },
      choiceGroups: [{ id: 'g', assessment: 'A1', required: 1 }],
      assessments: [
        {
          id: 'A1',
          weight: 100,
          max,
          questions: [
            { label: 'Q1', max: 10, co: 'CO1' },
            { label: 'Q5', max: 10, co: 'CO1', choice: 'g' },
            { label: 'Q6', max: 10, co: 'CO2', choice: 'g' },
          ],
        },
      ],
      students: [{ roll: 'R1', marks: { 'A1:Q1': 8, 'A1:Q5': 7, 'A1:Q6': null } }],
    });

  it('scores the paper a student sits, not every question printed on it', () => {
    // Q1 plus one of Q5/Q6 = 20 marks, even though 30 are printed.
    expect(hasWarning(computeOffering(paper(20), policy(lenient), CTX), 'ASSESSMENT_MARKS_MISMATCH')).toBe(false);
  });

  it('still catches a genuine mismatch', () => {
    expect(hasWarning(computeOffering(paper(25), policy(lenient), CTX), 'ASSESSMENT_MARKS_MISMATCH')).toBe(true);
  });
});
