#!/usr/bin/env node
/**
 * Generates the golden fixtures (SPEC §14.1) as real engine-input documents.
 *
 * The fixtures are data, not test code, so that another implementation of the engine can be
 * checked against them. Each directory holds `input.json`, `policy.json` and `expected.json`,
 * and the inputs validate against the published `engine-input.schema.json`.
 *
 * The expected values are **hand-computed**, and the arithmetic is written out in comments
 * beside each one. That is the entire point of a golden fixture: if the expectations were
 * copied from whatever the engine happened to print, they would freeze a bug rather than
 * catch one. Cohorts are deliberately tiny so a reader can check the sums.
 *
 *   node scripts/build-fixtures.mjs
 */

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'fixtures', 'golden');

const loadPolicy = (name) =>
  JSON.parse(readFileSync(join(root, 'fixtures', 'policies', `${name}.json`), 'utf8'));

const strip = (v) => {
  if (Array.isArray(v)) return v.map(strip);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v).filter(([k]) => !k.startsWith('_comment') && !k.startsWith('$')).map(([k, x]) => [k, strip(x)]),
    );
  }
  return v;
};

const merge = (base, patch) => {
  const o = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) {
    o[k] = v && typeof v === 'object' && !Array.isArray(v) && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k])
      ? merge(o[k], v)
      : v;
  }
  return o;
};

// ---------------------------------------------------------------------------
// Builder — turns a compact description into a full engine-input document.
// ---------------------------------------------------------------------------

function build(spec) {
  const coId = (c) => `co:${c}`;
  const outId = (c) => `outcome:${c}`;
  const qId = (a, l) => `${a}:${l}`;

  const questions = [];
  const questionOutcomes = [];
  const assessments = [];

  for (const a of spec.assessments) {
    const qs = a.questions ?? [];
    qs.forEach((q, i) => {
      const id = qId(a.id, q.label);
      questions.push({
        id, assessment_id: a.id, label: q.label, max_marks: q.max, sequence: i + 1,
        ...(q.parent ? { parent_id: qId(a.id, q.parent) } : {}),
        ...(q.choice ? { choice_group: q.choice } : {}),
      });
      if (q.co === undefined) return;
      if (typeof q.co === 'string') questionOutcomes.push({ question_id: id, course_outcome_id: coId(q.co), weight: 1 });
      else for (const [c, w] of Object.entries(q.co)) questionOutcomes.push({ question_id: id, course_outcome_id: coId(c), weight: w });
    });
    assessments.push({
      id: a.id, name: a.name ?? a.id, kind: a.kind ?? 'cie',
      max_marks: a.max ?? qs.reduce((s, q) => s + q.max, 0),
      weight_pct: a.weight, ...(a.group ? { group_id: a.group } : {}),
      ...(a.targetPct !== undefined ? { target_pct: a.targetPct } : {}),
      ...(a.targetGrade ? { target_grade: a.targetGrade } : {}),
      ...(a.coWeights
        ? {
            outcome_weights: Object.entries(a.coWeights).map(([c, w]) => ({
              course_outcome_id: coId(c),
              weight_pct: w,
            })),
          }
        : {}),
    });
  }

  const enrollments = spec.students.map((s) => ({
    id: `en:${s.roll}`, student_id: `st:${s.roll}`, roll_no: s.roll,
    display_name: s.name ?? `Student ${s.roll}`, status: s.status ?? 'active',
  }));

  const marks = [];
  const totals = [];
  for (const s of spec.students) {
    for (const [key, score] of Object.entries(s.marks ?? {})) {
      const [aid, label] = key.split(':');
      marks.push({
        enrollment_id: `en:${s.roll}`, question_id: qId(aid, label),
        score: score ?? 0, attempted: score !== null,
        ...(s.status_by_assessment?.[aid] ? { status: s.status_by_assessment[aid] } : {}),
      });
    }
    for (const [aid, t] of Object.entries(s.totals ?? {})) {
      totals.push({ enrollment_id: `en:${s.roll}`, assessment_id: aid, total_score: t });
    }
    for (const [aid, g] of Object.entries(s.grades ?? {})) {
      totals.push({ enrollment_id: `en:${s.roll}`, assessment_id: aid, grade: g });
    }
    for (const [aid, st] of Object.entries(s.status_by_assessment ?? {})) {
      const hasRows = marks.some((m) => m.enrollment_id === `en:${s.roll}` && m.question_id.startsWith(`${aid}:`));
      if (!hasRows) totals.push({ enrollment_id: `en:${s.roll}`, assessment_id: aid, status: st });
    }
  }

  const articulation = [];
  for (const [o, cells] of Object.entries(spec.articulation ?? {})) {
    for (const [c, corr] of Object.entries(cells)) {
      articulation.push({
        course_outcome_id: coId(c), outcome_id: outId(o), correlation: corr,
        justification: `${c} is assessed through work requiring ${o}-level capability.`,
      });
    }
  }

  const doc = {
    offering: {
      id: 'offering:1', term_id: 'term:1', section: 'A',
      course: { id: 'course:1', code: spec.course ?? 'CS201', title: spec.title ?? 'Synthetic Course', credits: spec.credits ?? 4, type: spec.courseType ?? 'theory' },
      ...(spec.seeMode ? { see_mode: spec.seeMode } : {}),
    },
    framework: spec.framework,
    course_outcomes: spec.cos.map((c, i) => ({ id: coId(c), code: c, statement: `${c} — synthetic course outcome.`, sequence: i + 1 })),
    outcomes: (spec.outcomes ?? Object.keys(spec.articulation ?? {})).map((c, i) => ({
      id: outId(c), code: c, kind: c.startsWith('PSO') ? 'pso' : c.startsWith('SO') ? 'so' : 'po',
      statement: `${c} — synthetic programme outcome.`, sequence: i + 1,
    })),
    articulation, assessments, questions, question_outcomes: questionOutcomes,
    enrollments, marks, assessment_totals: totals,
  };

  if (spec.groups) doc.assessment_groups = spec.groups.map((g) => ({
    id: g.id, name: g.name ?? g.id, weight_pct: g.weight,
    ...(g.rule ? { selection_rule: g.rule } : {}), ...(g.n !== undefined ? { n: g.n } : {}),
  }));
  if (spec.choiceGroups) doc.choice_groups = spec.choiceGroups.map((c) => ({ id: c.id, assessment_id: c.assessment, required: c.required }));
  if (spec.seeBlueprint) {
    const see = assessments.find((a) => a.kind === 'see');
    doc.see_blueprint = { assessment_id: see.id, distribution: Object.entries(spec.seeBlueprint).map(([c, m]) => ({ course_outcome_id: coId(c), marks: m })) };
  }
  if (spec.survey) doc.survey = {
    kind: 'course_exit', scale_min: 1, scale_max: 5, invited: spec.students.length,
    responses: Object.entries(spec.survey).flatMap(([c, ratings]) =>
      ratings.map((r, i) => ({ course_outcome_id: coId(c), rating: r, respondent_token: `r${i}` }))),
  };

  return doc;
}

const NBA_V4 = { code: 'nba-ug-eng', version: 'gapc-v4.0', outcome_count: 11, supersedes: 'gapc-v3.0' };
const NBA_V3 = { code: 'nba-ug-eng', version: 'gapc-v3.0', outcome_count: 12 };
const ABET = { code: 'abet-eac', version: '2024-25', outcome_count: 7 };

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

const fixtures = [];

// ---- A ---------------------------------------------------------------------
// Five students, two outcomes, an internal component at 40% and an end-semester
// component at 60%, every question tagged.
//
//   CO1 per student = 0.4·(CIE Q1/10) + 0.6·(SEE Q1/10)
//     S1 .4(.8)+.6(.8)=.80   S2 .70   S3 .60   S4 .90   S5 .50
//     crossing 60%: S1,S2,S3,S4 → 4/5 = 0.80 → band ≥0.80 → level 3
//   CO2 = 0.4·(CIE Q2/10) + 0.6·(SEE Q2/10)
//     S1 .4(.7)+.6(.6)=.64   S2 .54   S3 .44   S4 .74   S5 .34
//     crossing: S1,S4 → 2/5 = 0.40 → below the lowest band → level 0
//   No survey, so final = direct.
//   PO1 = (3·3 + 0·1)/(3+1) = 2.25
fixtures.push({
  dir: 'a-autonomous-question-wise',
  title: 'A — autonomous institute, question-wise end-semester data, target-ratio method',
  description:
    'The straightforward case: the institute sets and marks its own end-semester paper, so every question carries a course-outcome tag and nothing is apportioned. CO2 lands on level 0 rather than level 1, which is the point — a cohort that misses the lowest band is reported as missing it.',
  policy: 'level-target-ratio',
  spec: {
    framework: NBA_V4, cos: ['CO1', 'CO2'], outcomes: ['PO1', 'PO2'],
    articulation: { PO1: { CO1: 3, CO2: 1 }, PO2: { CO2: 2 } },
    assessments: [
      { id: 'CIE', name: 'Internal assessment', weight: 40, questions: [{ label: 'Q1', max: 10, co: 'CO1' }, { label: 'Q2', max: 10, co: 'CO2' }] },
      { id: 'SEE', name: 'End-semester examination', kind: 'see', weight: 60, questions: [{ label: 'Q1', max: 10, co: 'CO1' }, { label: 'Q2', max: 10, co: 'CO2' }] },
    ],
    students: [
      { roll: 'S1', marks: { 'CIE:Q1': 8, 'CIE:Q2': 7, 'SEE:Q1': 8, 'SEE:Q2': 6 } },
      { roll: 'S2', marks: { 'CIE:Q1': 7, 'CIE:Q2': 6, 'SEE:Q1': 7, 'SEE:Q2': 5 } },
      { roll: 'S3', marks: { 'CIE:Q1': 6, 'CIE:Q2': 5, 'SEE:Q1': 6, 'SEE:Q2': 4 } },
      { roll: 'S4', marks: { 'CIE:Q1': 9, 'CIE:Q2': 8, 'SEE:Q1': 9, 'SEE:Q2': 7 } },
      { roll: 'S5', marks: { 'CIE:Q1': 5, 'CIE:Q2': 4, 'SEE:Q1': 5, 'SEE:Q2': 3 } },
    ],
  },
  expected: {
    see_mode: 'question_wise',
    cohort: { considered: 5, excluded: 0 },
    co: {
      CO1: { students_considered: 5, students_crossed: 4, ratio: 0.8, direct: 3, final: 3 },
      CO2: { students_considered: 5, students_crossed: 2, ratio: 0.4, direct: 0, final: 0 },
    },
    po: { PO1: 2.25, PO2: 0 },
    warnings_include: ['INDIRECT_ABSENT'],
    stamps_exclude: ['SEE apportioned uniformly'],
  },
});

// ---- B ---------------------------------------------------------------------
// Affiliated college. Internal marks are question-wise; the end-semester result
// arrives as a total, apportioned by the university's published blueprint.
//
//   Apportionment scales numerator and denominator by the same share, so the
//   end-semester percentage is total/max for EVERY outcome it touches. It adds
//   no per-outcome information — which is why the report is stamped.
//   Split combination, so each half is banded separately (target 50%,
//   bands .5/.6/.7) and then blended 0.25 internal / 0.75 end-semester.
//
//   CIE CO1 pct:  S1 .8  S2 .6  S3 .4  S4 .9  S5 .5  → crossing 50%: 4/5 = .8 → level 3
//   SEE pct = total/40: S1 .75 S2 .60 S3 .45 S4 .90 S5 .50 → crossing: 4/5 = .8 → level 3
//   direct = 0.25·3 + 0.75·3 = 3
fixtures.push({
  dir: 'b-affiliated-blueprint-apportioned',
  title: 'B — affiliated college, end-semester totals apportioned by published blueprint',
  description:
    'The college never sees the end-semester question paper; the university returns a total. The total is spread across outcomes in proportion to the published blueprint, the two halves are banded separately, and the report carries a stamp saying so. A reader must be able to tell an apportioned number from a measured one.',
  policy: 'split-blueprint',
  spec: {
    framework: NBA_V4, cos: ['CO1', 'CO2'], outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3, CO2: 2 } },
    seeMode: 'blueprint_uniform',
    seeBlueprint: { CO1: 25, CO2: 15 },
    assessments: [
      { id: 'CIE', name: 'Internal assessment', weight: 25, questions: [{ label: 'Q1', max: 10, co: 'CO1' }, { label: 'Q2', max: 10, co: 'CO2' }] },
      { id: 'SEE', name: 'University end-semester examination', kind: 'see', weight: 75, max: 40 },
    ],
    students: [
      { roll: 'S1', marks: { 'CIE:Q1': 8, 'CIE:Q2': 7 }, totals: { SEE: 30 } },
      { roll: 'S2', marks: { 'CIE:Q1': 6, 'CIE:Q2': 6 }, totals: { SEE: 24 } },
      { roll: 'S3', marks: { 'CIE:Q1': 4, 'CIE:Q2': 4 }, totals: { SEE: 18 } },
      { roll: 'S4', marks: { 'CIE:Q1': 9, 'CIE:Q2': 8 }, totals: { SEE: 36 } },
      { roll: 'S5', marks: { 'CIE:Q1': 5, 'CIE:Q2': 5 }, totals: { SEE: 20 } },
    ],
  },
  expected: {
    see_mode: 'blueprint_uniform',
    cohort: { considered: 5, excluded: 0 },
    co: { CO1: { students_considered: 5, direct: 3 } },
    stamps_include: ['SEE apportioned by published blueprint'],
    warnings_include: ['SEE_FALLBACK_USED'],
  },
});

// ---- C ---------------------------------------------------------------------
// ABET-shaped. Percentage scale, unbanded, seven student outcomes, no PSOs.
//
//   method 'percentage' reports the crossing fraction × 100 rather than a level.
//   SO1 = 0.5·(A/10) + 0.5·(B/10):  S1 .85 S2 .75 S3 .65 S4 .95 S5 .55
//   crossing the 70% target: S1,S2,S4 → 3/5 = 0.60 → reported as 60
fixtures.push({
  dir: 'c-abet-percentage-scale',
  title: 'C — ABET programme, unbanded percentage scale, no programme-specific outcomes',
  description:
    'Proves the engine is not built around one regime. The scale is a raw percentage rather than a 0–3 level, there is no PSO concept, and the rollup is credit-weighted. Nothing in the engine changes — only the policy document.',
  policy: 'percentage-credit-weighted',
  spec: {
    framework: ABET, cos: ['CO1', 'CO2'], outcomes: ['SO1', 'SO2'],
    articulation: { SO1: { CO1: 3 }, SO2: { CO2: 3 } },
    assessments: [
      { id: 'A1', name: 'Homework and quizzes', weight: 50, questions: [{ label: 'A', max: 10, co: 'CO1' }, { label: 'B', max: 10, co: 'CO2' }] },
      { id: 'A2', name: 'Examinations', kind: 'see', weight: 50, questions: [{ label: 'A', max: 10, co: 'CO1' }, { label: 'B', max: 10, co: 'CO2' }] },
    ],
    students: [
      { roll: 'S1', marks: { 'A1:A': 8, 'A1:B': 9, 'A2:A': 9, 'A2:B': 8 } },
      { roll: 'S2', marks: { 'A1:A': 7, 'A1:B': 8, 'A2:A': 8, 'A2:B': 7 } },
      { roll: 'S3', marks: { 'A1:A': 6, 'A1:B': 7, 'A2:A': 7, 'A2:B': 6 } },
      { roll: 'S4', marks: { 'A1:A': 9, 'A1:B': 10, 'A2:A': 10, 'A2:B': 9 } },
      { roll: 'S5', marks: { 'A1:A': 5, 'A1:B': 6, 'A2:A': 6, 'A2:B': 5 } },
    ],
  },
  expected: {
    scale_kind: 'percentage',
    cohort: { considered: 5, excluded: 0 },
    co: { CO1: { students_considered: 5, students_crossed: 3, direct: 60 } },
  },
});

// ---- D ---------------------------------------------------------------------
// Lab course. No end-semester component at all, three reviews with the best two
// counted, and an absentee scored zero rather than excluded.
//
//   S5 missed review 3. Under absent_handling 'zero' they keep a mark of 0 for
//   it — but best-two-of-three then discards that zero, which is the correct
//   interaction and easy to get wrong.
//   CO1 pcts: S1 .85 S2 .75 S3 .65 S4 .95 S5 .70 (best two of .8,.6,0 → .70)
//   crossing 70%: S1,S2,S4,S5 → 4/5 = 0.8 → level 3
fixtures.push({
  dir: 'd-lab-internal-only',
  title: 'D — laboratory course, entirely internal, best two of three reviews',
  description:
    'There is no end-semester examination, so the end-semester component is excluded outright rather than apportioned. A missed review is scored zero because it is a missed deliverable, not an absence from a scheduled exam — and best-of-N then drops that zero, which is the interaction worth pinning.',
  policy: 'internal-only',
  spec: {
    framework: NBA_V4, cos: ['CO1'], outcomes: ['PO1'], courseType: 'lab', credits: 2,
    articulation: { PO1: { CO1: 3 } },
    groups: [{ id: 'G', name: 'Laboratory reviews', rule: 'best_n', n: 2, weight: 100 }],
    assessments: [
      { id: 'R1', name: 'Review 1', weight: 1, group: 'G', questions: [{ label: 'Rubric', max: 10, co: 'CO1' }] },
      { id: 'R2', name: 'Review 2', weight: 1, group: 'G', questions: [{ label: 'Rubric', max: 10, co: 'CO1' }] },
      { id: 'R3', name: 'Review 3', weight: 1, group: 'G', questions: [{ label: 'Rubric', max: 10, co: 'CO1' }] },
    ],
    students: [
      { roll: 'S1', marks: { 'R1:Rubric': 9, 'R2:Rubric': 8, 'R3:Rubric': 7 } },
      { roll: 'S2', marks: { 'R1:Rubric': 8, 'R2:Rubric': 7, 'R3:Rubric': 6 } },
      { roll: 'S3', marks: { 'R1:Rubric': 7, 'R2:Rubric': 6, 'R3:Rubric': 5 } },
      { roll: 'S4', marks: { 'R1:Rubric': 10, 'R2:Rubric': 9, 'R3:Rubric': 8 } },
      { roll: 'S5', marks: { 'R1:Rubric': 8, 'R2:Rubric': 6 }, status_by_assessment: { R3: 'absent' } },
    ],
  },
  expected: {
    see_mode: 'excluded',
    cohort: { considered: 5, excluded: 0 },
    co: { CO1: { students_considered: 5, students_crossed: 4, ratio: 0.8, direct: 3 } },
    student_pct: { CO1: { S5: 0.7 } },
    stamps_include: ['SEE excluded'],
  },
});

// ---- E ---------------------------------------------------------------------
// Best-of-two mid-semesters combined with a choice question.
//
//   Q3 or Q4 — the alternatives test DIFFERENT outcomes. A student answering Q3
//   is measured on CO2 out of 10; one answering Q4 is measured on CO3 out of 10.
//   Neither is charged for the question they were never required to answer.
//
//   CO1 across the two mid-semesters, best one of two (n=1):
//     S1 max(.9,.7)=.9  S2 max(.6,.8)=.8  S3 max(.5,.4)=.5  S4 max(.7,.9)=.9
//   crossing 60%: S1,S2,S4 → 3/4 = 0.75 → band ≥0.70 → level 2
//   CO2 cohort is only the students who chose Q3: S1 and S3.
//   CO3 cohort is only S2 and S4.
fixtures.push({
  dir: 'e-best-of-n-with-choice',
  title: 'E — best one of two mid-semesters, with a choice question spanning two outcomes',
  description:
    'The two computations the specification singles out as most often got wrong, in one fixture. Choice alternatives map to different outcomes, so each student carries their own denominator and each outcome has its own cohort. Best-of-N is resolved per outcome, not once per student.',
  policy: 'level-target-ratio',
  policy_overrides: { validation: { min_assessments_per_co: 1 }, cohort: { min_cohort_size: 1 } },
  spec: {
    framework: NBA_V4, cos: ['CO1', 'CO2', 'CO3'], outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3, CO2: 2, CO3: 2 } },
    groups: [{ id: 'M', name: 'Mid-semesters', rule: 'best_n', n: 1, weight: 100 }],
    choiceGroups: [{ id: 'either', assessment: 'M1', required: 1 }],
    assessments: [
      { id: 'M1', name: 'Mid-semester 1', weight: 1, group: 'M', max: 20, questions: [
        { label: 'Q1', max: 10, co: 'CO1' },
        { label: 'Q3', max: 10, co: 'CO2', choice: 'either' },
        { label: 'Q4', max: 10, co: 'CO3', choice: 'either' },
      ] },
      { id: 'M2', name: 'Mid-semester 2', weight: 1, group: 'M', questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
    ],
    students: [
      { roll: 'S1', marks: { 'M1:Q1': 9, 'M1:Q3': 8, 'M1:Q4': null, 'M2:Q1': 7 } },
      { roll: 'S2', marks: { 'M1:Q1': 6, 'M1:Q3': null, 'M1:Q4': 7, 'M2:Q1': 8 } },
      { roll: 'S3', marks: { 'M1:Q1': 5, 'M1:Q3': 4, 'M1:Q4': null, 'M2:Q1': 4 } },
      { roll: 'S4', marks: { 'M1:Q1': 7, 'M1:Q3': null, 'M1:Q4': 9, 'M2:Q1': 9 } },
    ],
  },
  expected: {
    cohort: { considered: 4, excluded: 0 },
    co: {
      CO1: { students_considered: 4, students_crossed: 3, ratio: 0.75, direct: 2 },
      CO2: { students_considered: 2 },
      CO3: { students_considered: 2 },
    },
    student_pct: { CO1: { S1: 0.9, S2: 0.8 }, CO2: { S1: 0.8 } },
    student_maximum: { CO2: { S1: 10 } },
  },
});

// ---- F ---------------------------------------------------------------------
// The one that proves the framework binding. Two terms of one programme, either
// side of the twelve-to-eleven cutover. Each computes under the framework that
// was actually in force; neither is restated under the other.
const migrationSpec = (framework, poCode) => ({
  framework, cos: ['CO1'], outcomes: [poCode],
  articulation: { [poCode]: { CO1: 3 } },
  assessments: [
    { id: 'CIE', name: 'Internal assessment', weight: 40, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
    { id: 'SEE', name: 'End-semester examination', kind: 'see', weight: 60, questions: [{ label: 'Q1', max: 10, co: 'CO1' }] },
  ],
  students: [
    { roll: 'S1', marks: { 'CIE:Q1': 8, 'SEE:Q1': 8 } },
    { roll: 'S2', marks: { 'CIE:Q1': 7, 'SEE:Q1': 7 } },
    { roll: 'S3', marks: { 'CIE:Q1': 6, 'SEE:Q1': 6 } },
    { roll: 'S4', marks: { 'CIE:Q1': 9, 'SEE:Q1': 9 } },
    { roll: 'S5', marks: { 'CIE:Q1': 5, 'SEE:Q1': 5 } },
  ],
});

// Both terms: CO1 pcts .8 .7 .6 .9 .5 → crossing 60%: 4/5 = .8 → level 3.
// Identical marks on purpose: the framework, not the arithmetic, is what differs.
fixtures.push({
  dir: 'f1-migration-v3-term',
  title: 'F1 — a term taught before the cutover, computed under the retired 12-outcome framework',
  description:
    'A historical term keeps the framework that was in force when it was taught. Restating it under the newer framework would make an attainment figure that nobody computed at the time appear in the record, which destroys the audit trail. Note the outcome code: PO12 exists here and does not exist in F2.',
  policy: 'level-target-ratio',
  policy_overrides: { framework: { version: 'gapc-v3.0', outcome_count: 12, supersedes: null }, validation: { min_assessments_per_co: 2 } },
  spec: migrationSpec(NBA_V3, 'PO12'),
  expected: {
    framework_version: 'gapc-v3.0',
    cohort: { considered: 5, excluded: 0 },
    co: { CO1: { students_considered: 5, students_crossed: 4, ratio: 0.8, direct: 3 } },
    po: { PO12: 3 },
  },
});

fixtures.push({
  dir: 'f2-migration-v4-term',
  title: 'F2 — a term taught after the cutover, computed under the current 11-outcome framework',
  description:
    'The same programme, the same marks, one term later. Only the framework differs. The two terms are reported as two series; averaging them would produce a number describing no framework at all. Computing F1 under this policy throws — see the fixture test.',
  policy: 'level-target-ratio',
  spec: migrationSpec(NBA_V4, 'PO11'),
  expected: {
    framework_version: 'gapc-v4.0',
    cohort: { considered: 5, excluded: 0 },
    co: { CO1: { students_considered: 5, students_crossed: 4, ratio: 0.8, direct: 3 } },
    po: { PO11: 3 },
  },
});

// ---------------------------------------------------------------------------

mkdirSync(out, { recursive: true });
const manifest = [];

// ---- G ---------------------------------------------------------------------
// Per-outcome instrument weightage, with each instrument banded before the levels
// are averaged. Both halves of the KTU-style method in one fixture.
//
// Three instruments, two outcomes, and the weightage differs BY OUTCOME:
//
//              Internal test   Assignment   End-semester
//   CO1              50            0             50
//   CO2              30           30             40
//
// Bands: ratio >= .5 -> 1, >= .6 -> 2, >= .75 -> 3.  Target 60%.
//
// Each instrument is banded on its own cohort ratio first:
//
//   CO1  test  pcts .8 .7 .5 .4  -> 2/4 = .50 -> level 1   (weight 50)
//   CO1  asgn  pcts 1. 1. 1. 1.  -> 4/4 = 1.0 -> level 3   (weight  0)
//   CO1  ESE   pcts .9 .8 .7 .6  -> 4/4 = 1.0 -> level 3   (weight 50)
//   CO1 direct = (50*1 + 50*3) / 100 = 2.0
//
//   CO2  test  pcts .6 .6 .3 .3  -> 2/4 = .50 -> level 1   (weight 30)
//   CO2  asgn  pcts .9 .8 .7 .2  -> 3/4 = .75 -> level 3   (weight 30)
//   CO2  ESE   pcts .7 .6 .6 .5  -> 3/4 = .75 -> level 3   (weight 40)
//   CO2 direct = (30*1 + 30*3 + 40*3) / 100 = 2.4
//
// The assignment is the case that discriminates. Every student scores full marks on its
// CO1 question, so it bands to 3 — and it must not move CO1, because the policy weights it
// zero there. Ignore the per-outcome weights and CO1 comes out 2.33; apply the assessment's
// scalar weight instead and it comes out differently again. Only 2.0 is right.
fixtures.push({
  dir: 'g-per-outcome-weightage',
  title: 'G — instrument weightage differs per outcome, levels averaged after banding',
  description:
    'The same three instruments count differently towards different outcomes — CO1 is 50/0/50 while CO2 is 30/30/40 — and each instrument is banded on its own before the levels are weight-averaged. An assignment weighted zero for CO1 scores full marks there and must leave CO1 untouched; that is the case that separates this from a single per-assessment weight.',
  policy: 'component-levels',
  spec: {
    framework: NBA_V4, cos: ['CO1', 'CO2'], outcomes: ['PO1', 'PO2'], credits: 3,
    articulation: { PO1: { CO1: 3, CO2: 2 }, PO2: { CO2: 3 } },
    assessments: [
      { id: 'T', name: 'Internal test', weight: 40, coWeights: { CO1: 50, CO2: 30 },
        questions: [{ label: 'T-CO1', max: 10, co: 'CO1' }, { label: 'T-CO2', max: 10, co: 'CO2' }] },
      { id: 'A', name: 'Assignment', weight: 10, coWeights: { CO1: 0, CO2: 30 },
        questions: [{ label: 'A-CO1', max: 10, co: 'CO1' }, { label: 'A-CO2', max: 10, co: 'CO2' }] },
      { id: 'E', name: 'End-semester examination', kind: 'see', weight: 50, coWeights: { CO1: 50, CO2: 40 },
        questions: [{ label: 'E-CO1', max: 10, co: 'CO1' }, { label: 'E-CO2', max: 10, co: 'CO2' }] },
    ],
    students: [
      { roll: 'S1', marks: { 'T:T-CO1': 8, 'T:T-CO2': 6, 'A:A-CO1': 10, 'A:A-CO2': 9, 'E:E-CO1': 9, 'E:E-CO2': 7 } },
      { roll: 'S2', marks: { 'T:T-CO1': 7, 'T:T-CO2': 6, 'A:A-CO1': 10, 'A:A-CO2': 8, 'E:E-CO1': 8, 'E:E-CO2': 6 } },
      { roll: 'S3', marks: { 'T:T-CO1': 5, 'T:T-CO2': 3, 'A:A-CO1': 10, 'A:A-CO2': 7, 'E:E-CO1': 7, 'E:E-CO2': 6 } },
      { roll: 'S4', marks: { 'T:T-CO1': 4, 'T:T-CO2': 3, 'A:A-CO1': 10, 'A:A-CO2': 2, 'E:E-CO1': 6, 'E:E-CO2': 5 } },
    ],
  },
  expected: {
    combination: 'component_levels',
    cohort: { considered: 4, excluded: 0 },
    co: {
      CO1: { students_considered: 4, direct: 2.0 },
      CO2: { students_considered: 4, direct: 2.4 },
    },
    component_levels: {
      CO1: { T: { level: 1, weight: 50 }, A: { level: 3, weight: 0 }, E: { level: 3, weight: 50 } },
      CO2: { T: { level: 1, weight: 30 }, A: { level: 3, weight: 30 }, E: { level: 3, weight: 40 } },
    },
  },
});

// ---- H ---------------------------------------------------------------------
// Each instrument measured against its own bar, one of them stated as a grade.
// Taken from a second college's workbook, which sets:
//
//   Internal exam       target 70% of marks     weight 20
//   Learning activity   target 80% of marks     weight 40
//   University exam     target grade C          weight 40
//
// The policy default target is 60%, matched by none of the three, so a run that ignores
// the per-instrument targets produces different levels throughout rather than failing.
//
//   Internal   .80 .75 .72 .55 .40   3 of 5 reach 70%  -> .60 -> level 2   (w 20)
//   Activity   .95 .90 .85 .82 .60   4 of 5 reach 80%  -> .80 -> level 3   (w 40)
//   University B C C P F             3 of 5 at C+      -> .60 -> level 2   (w 40)
//
//   direct = (20*2 + 40*3 + 40*2) / 100 = 240/100 = 2.4
//
// Grades resolve through the same mapping in both directions: C is 63, so a student's
// grade becomes a percentage and the target grade becomes the percentage to clear. B(73),
// C(63), C(63) reach it; P(52) and F(20) do not.
//
// Indirect is a 1-5 course-exit survey read with a floor of 0 — this college's convention,
// where the first sets the floor at 1. mean 4.3704 -> 4.3704/5*3 = 2.6222.
//
//   final = 0.8*2.4 + 0.2*2.6222 = 2.4444
fixtures.push({
  dir: 'h-per-instrument-targets',
  title: 'H — a different target per instrument, one of them a grade',
  description:
    'Three instruments with three different bars: 70% of marks, 80% of marks, and grade C. The policy default is 60% and matches none of them, so ignoring the per-instrument targets changes every level without erroring. The grade target resolves through the same scale that converts a student grade to a percentage, so both sides of the comparison agree by construction.',
  policy: 'per-instrument-targets',
  spec: {
    framework: NBA_V4, cos: ['CO1'], outcomes: ['PO1'], credits: 4,
    articulation: { PO1: { CO1: 3 } },
    assessments: [
      { id: 'INT', name: 'Internal exam', weight: 20, targetPct: 70,
        questions: [{ label: 'Q1', max: 100, co: 'CO1' }] },
      { id: 'ACT', name: 'Learning activity', weight: 40, targetPct: 80,
        questions: [{ label: 'LA1', max: 100, co: 'CO1' }] },
      { id: 'UNI', name: 'University examination', kind: 'see', weight: 40, targetGrade: 'C', max: 100 },
    ],
    students: [
      { roll: 'S1', marks: { 'INT:Q1': 80, 'ACT:LA1': 95 }, grades: { UNI: 'B' } },
      { roll: 'S2', marks: { 'INT:Q1': 75, 'ACT:LA1': 90 }, grades: { UNI: 'C' } },
      { roll: 'S3', marks: { 'INT:Q1': 72, 'ACT:LA1': 85 }, grades: { UNI: 'C' } },
      { roll: 'S4', marks: { 'INT:Q1': 55, 'ACT:LA1': 82 }, grades: { UNI: 'P' } },
      { roll: 'S5', marks: { 'INT:Q1': 40, 'ACT:LA1': 60 }, grades: { UNI: 'F' } },
    ],
    survey: { CO1: [5, 5, 5, 4, 4, 3] },
  },
  expected: {
    combination: 'component_levels',
    cohort: { considered: 5, excluded: 0 },
    co: { CO1: { students_considered: 5, direct: 2.4 } },
    component_levels: {
      CO1: {
        INT: { level: 2, weight: 20, target_pct: 70 },
        ACT: { level: 3, weight: 40, target_pct: 80 },
        UNI: { level: 2, weight: 40, target_pct: 63 },
      },
    },
  },
});

for (const f of fixtures) {
  const dir = join(out, f.dir);
  mkdirSync(dir, { recursive: true });

  const policy = merge(strip(loadPolicy(f.policy)), f.policy_overrides ?? {});
  const input = build(f.spec);

  writeFileSync(join(dir, 'input.json'), JSON.stringify(input, null, 2) + '\n');
  writeFileSync(join(dir, 'policy.json'), JSON.stringify(policy, null, 2) + '\n');
  writeFileSync(
    join(dir, 'expected.json'),
    JSON.stringify({ title: f.title, description: f.description, ...f.expected }, null, 2) + '\n',
  );

  manifest.push({ dir: f.dir, title: f.title, policy: f.policy });
  console.log(`  ${f.dir}`);
}

writeFileSync(
  join(out, 'index.json'),
  JSON.stringify(
    {
      _note:
        'Golden fixtures per SPEC §14.1. Synthetic data only — no real student ever appears here. Expected values are hand-computed; the arithmetic is written out in scripts/build-fixtures.mjs beside each fixture. Regenerate with `npm run fixtures`.',
      fixtures: manifest,
    },
    null,
    2,
  ) + '\n',
);

console.log(`\n${fixtures.length} fixtures written to fixtures/golden/`);
