/**
 * Scenario builders for the engine tests.
 *
 * The point of these is that a test should read like the situation it describes — "two
 * students, one answered Q5, the other answered Q6, the alternatives map to different COs" —
 * rather than like a hundred lines of object literals. If a test is hard to read, the edge
 * case it pins is hard to trust.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  AssessmentKind,
  EngineInput,
  EnrollmentStatus,
  FrameworkBinding,
  MarkStatus,
  PolicyDocument,
} from '../src/types.js';

/**
 * Test policies are synthetic and live in this repository under `fixtures/policies/`.
 *
 * They deliberately do NOT come from an institution config pack. A pack encodes a real
 * institution's assessment rules — its target, its bands, how it treats an absentee — which
 * belongs to that institution and is not ours to publish. Loading one here would also make
 * the open engine unbuildable without the private repository, which is precisely the boundary
 * this split exists to draw.
 */
const policyPath = (name: string) =>
  fileURLToPath(new URL(`../../../fixtures/policies/${name}.json`, import.meta.url));

const frameworkPath = (rel: string) =>
  fileURLToPath(new URL(`../../../frameworks/${rel}`, import.meta.url));

export function loadPolicy(name: string): PolicyDocument {
  return JSON.parse(readFileSync(policyPath(name), 'utf8'));
}

/** Read an outcome set straight from the published registry. */
export function loadOutcomeSet(rel: string): {
  framework: FrameworkBinding & { regime?: string };
  outcomes: { code: string; kind: string; sequence: number; statement: string }[];
} {
  return JSON.parse(readFileSync(frameworkPath(rel), 'utf8'));
}

/** Strip the `_comment_*` / `$…` annotations the shipped documents carry for humans. */
function stripAnnotations<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripAnnotations) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k.startsWith('_comment') || k.startsWith('$')) continue;
      out[k] = stripAnnotations(val);
    }
    return out as unknown as T;
  }
  return v;
}

/** The baseline synthetic policy, deep-merged with a patch. */
export function policy(patch: DeepPartialAny = {}): PolicyDocument {
  return deepMerge(stripAnnotations(loadPolicy('level-target-ratio')), patch);
}

/** Split CIE/SEE combination with an apportioned end-semester total. */
export function affiliatedPolicy(patch: DeepPartialAny = {}): PolicyDocument {
  return deepMerge(stripAnnotations(loadPolicy('split-blueprint')), patch);
}

/** Unbanded percentage scale, seven outcomes, no PSOs. */
export function percentagePolicy(patch: DeepPartialAny = {}): PolicyDocument {
  return deepMerge(stripAnnotations(loadPolicy('percentage-credit-weighted')), patch);
}

/** No end-semester component at all; absentees scored zero. */
export function internalOnlyPolicy(patch: DeepPartialAny = {}): PolicyDocument {
  return deepMerge(stripAnnotations(loadPolicy('internal-only')), patch);
}

type DeepPartialAny = Record<string, any>;

function deepMerge<T>(base: T, patch: DeepPartialAny): T {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return (patch ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    const existing = out[k];
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && existing && typeof existing === 'object'
        ? deepMerge(existing, v)
        : v;
  }
  return out as T;
}

// ---------------------------------------------------------------------------

export const NBA_V4: FrameworkBinding = {
  code: 'nba-ug-eng',
  version: 'gapc-v4.0',
  outcome_count: 11,
  supersedes: 'gapc-v3.0',
};

export const NBA_V3: FrameworkBinding = {
  code: 'nba-ug-eng',
  version: 'gapc-v3.0',
  outcome_count: 12,
};

/** A question. `co` is either a single CO code or a weight split across several. */
export interface QSpec {
  label: string;
  max: number;
  co?: string | Record<string, number>;
  /** Alternatives sharing a choice group id — "answer any N of these". */
  choice?: string;
  parent?: string;
  optional?: boolean;
}

export interface ASpec {
  id: string;
  name?: string;
  kind?: AssessmentKind;
  /** Defaults to the sum of its questions' marks. */
  max?: number;
  weight: number;
  group?: string;
  questions?: QSpec[];
}

export interface SSpec {
  roll: string;
  status?: EnrollmentStatus;
  /** `"A1:Q1"` → score, or `null` for "did not attempt" (an unanswered choice alternative). */
  marks?: Record<string, number | null>;
  /** Assessment id → status, for a student absent from one paper but present at others. */
  assessmentStatus?: Record<string, MarkStatus>;
  /** Assessment id → total, when only a total is held. */
  totals?: Record<string, number>;
  /** Assessment id → letter grade, when only a grade is held. */
  grades?: Record<string, string>;
}

export interface ScenarioSpec {
  framework?: FrameworkBinding;
  cos: string[];
  /** Outcome code → CO code → correlation. */
  articulation?: Record<string, Record<string, number>>;
  outcomes?: string[];
  assessments: ASpec[];
  groups?: { id: string; name?: string; rule?: 'all' | 'best_n'; n?: number; weight: number }[];
  choiceGroups?: { id: string; assessment: string; required: number }[];
  students: SSpec[];
  seeMode?: EngineInput['offering']['see_mode'];
  seeBlueprint?: Record<string, number>;
  survey?: { responses: Record<string, number[]>; invited?: number; min?: number; max?: number };
  credits?: number;
}

/**
 * Build an `EngineInput` from a compact description.
 *
 * Ids are derived from labels (`A1:Q3`, `co:CO2`) so failures name something recognisable
 * rather than a uuid.
 */
export function scenario(spec: ScenarioSpec): EngineInput {
  const coId = (code: string) => `co:${code}`;
  const outcomeId = (code: string) => `outcome:${code}`;
  const qId = (aid: string, label: string) => `${aid}:${label}`;

  const outcomeCodes = spec.outcomes ?? Object.keys(spec.articulation ?? {});

  const questions: EngineInput['questions'] = [];
  const questionOutcomes: EngineInput['question_outcomes'] = [];
  const assessments: EngineInput['assessments'] = [];

  for (const a of spec.assessments) {
    const qs = a.questions ?? [];
    for (const [i, q] of qs.entries()) {
      const id = qId(a.id, q.label);
      questions.push({
        id,
        assessment_id: a.id,
        label: q.label,
        max_marks: q.max,
        sequence: i + 1,
        ...(q.parent ? { parent_id: qId(a.id, q.parent) } : {}),
        ...(q.choice ? { choice_group: q.choice } : {}),
        ...(q.optional ? { is_optional: true } : {}),
      });

      if (q.co === undefined) continue;
      if (typeof q.co === 'string') {
        questionOutcomes.push({ question_id: id, course_outcome_id: coId(q.co), weight: 1 });
      } else {
        for (const [code, w] of Object.entries(q.co)) {
          questionOutcomes.push({ question_id: id, course_outcome_id: coId(code), weight: w });
        }
      }
    }

    assessments.push({
      id: a.id,
      name: a.name ?? a.id,
      kind: a.kind ?? 'cie',
      max_marks: a.max ?? qs.filter((q) => !qs.some((c) => c.parent === q.label)).reduce((s, q) => s + q.max, 0),
      weight_pct: a.weight,
      ...(a.group ? { group_id: a.group } : {}),
    });
  }

  const enrollments: EngineInput['enrollments'] = spec.students.map((s) => ({
    id: `en:${s.roll}`,
    student_id: `st:${s.roll}`,
    roll_no: s.roll,
    status: s.status ?? 'active',
  }));

  const marks: EngineInput['marks'] = [];
  const totals: EngineInput['assessment_totals'] = [];

  for (const s of spec.students) {
    const enrollmentId = `en:${s.roll}`;
    for (const [key, score] of Object.entries(s.marks ?? {})) {
      const [aid, label] = key.split(':');
      const status = s.assessmentStatus?.[aid!];
      marks.push({
        enrollment_id: enrollmentId,
        question_id: qId(aid!, label!),
        score: score ?? 0,
        attempted: score !== null,
        ...(status ? { status } : {}),
      });
    }
    for (const [aid, total] of Object.entries(s.totals ?? {})) {
      totals.push({
        enrollment_id: enrollmentId,
        assessment_id: aid,
        total_score: total,
        ...(s.assessmentStatus?.[aid] ? { status: s.assessmentStatus[aid] } : {}),
      });
    }
    for (const [aid, grade] of Object.entries(s.grades ?? {})) {
      totals.push({ enrollment_id: enrollmentId, assessment_id: aid, grade });
    }
    // An assessment a student was absent from may have no mark rows at all; record the
    // status so the cohort rules can see it.
    for (const [aid, status] of Object.entries(s.assessmentStatus ?? {})) {
      const hasMarks = marks.some(
        (m) => m.enrollment_id === enrollmentId && m.question_id.startsWith(`${aid}:`),
      );
      const hasTotal = totals.some((t) => t.enrollment_id === enrollmentId && t.assessment_id === aid);
      if (!hasMarks && !hasTotal) {
        totals.push({ enrollment_id: enrollmentId, assessment_id: aid, status });
      }
    }
  }

  const articulation: EngineInput['articulation'] = [];
  for (const [outcome, cells] of Object.entries(spec.articulation ?? {})) {
    for (const [co, correlation] of Object.entries(cells)) {
      articulation.push({
        course_outcome_id: coId(co),
        outcome_id: outcomeId(outcome),
        correlation,
        justification: `${co} contributes to ${outcome}.`,
      });
    }
  }

  const input: EngineInput = {
    offering: {
      id: 'offering:1',
      term_id: 'term:1',
      section: 'A',
      course: {
        id: 'course:1',
        code: 'CS201',
        title: 'Data Structures',
        credits: spec.credits ?? 4,
        type: 'theory',
      },
      ...(spec.seeMode ? { see_mode: spec.seeMode } : {}),
    },
    framework: spec.framework ?? NBA_V4,
    course_outcomes: spec.cos.map((code, i) => ({
      id: coId(code),
      code,
      statement: `${code} statement`,
      sequence: i + 1,
    })),
    outcomes: outcomeCodes.map((code, i) => ({
      id: outcomeId(code),
      code,
      kind: code.startsWith('PSO') ? ('pso' as const) : ('po' as const),
      sequence: i + 1,
    })),
    articulation,
    assessments,
    questions,
    question_outcomes: questionOutcomes,
    enrollments,
    marks,
    assessment_totals: totals,
    ...(spec.groups
      ? {
          assessment_groups: spec.groups.map((g) => ({
            id: g.id,
            name: g.name ?? g.id,
            weight_pct: g.weight,
            ...(g.rule ? { selection_rule: g.rule } : {}),
            ...(g.n !== undefined ? { n: g.n } : {}),
          })),
        }
      : {}),
    ...(spec.choiceGroups
      ? {
          choice_groups: spec.choiceGroups.map((c) => ({
            id: c.id,
            assessment_id: c.assessment,
            required: c.required,
          })),
        }
      : {}),
  };

  if (spec.seeBlueprint) {
    const seeAssessment = assessments.find((a) => a.kind === 'see');
    input.see_blueprint = {
      assessment_id: seeAssessment?.id ?? 'SEE',
      distribution: Object.entries(spec.seeBlueprint).map(([code, m]) => ({
        course_outcome_id: coId(code),
        marks: m,
      })),
    };
  }

  if (spec.survey) {
    input.survey = {
      kind: 'course_exit',
      ...(spec.survey.min !== undefined ? { scale_min: spec.survey.min } : {}),
      ...(spec.survey.max !== undefined ? { scale_max: spec.survey.max } : {}),
      ...(spec.survey.invited !== undefined ? { invited: spec.survey.invited } : {}),
      responses: Object.entries(spec.survey.responses).flatMap(([code, ratings]) =>
        ratings.map((rating, i) => ({
          course_outcome_id: coId(code),
          rating,
          respondent_token: `r${i}`,
        })),
      ),
    };
  }

  return input;
}

export const CTX = { computed_at: '2026-07-28T00:00:00.000Z', run_id: 'run:test' };

/** Generate `n` students whose scores follow a function of their index. */
export function students(
  n: number,
  fn: (i: number) => SSpec['marks'],
  opts: { prefix?: string } = {},
): SSpec[] {
  const prefix = opts.prefix ?? '2023BCS';
  return Array.from({ length: n }, (_, i) => ({
    roll: `${prefix}${String(i + 1).padStart(4, '0')}`,
    marks: fn(i),
  }));
}

export function coOf(result: { co_attainments: { code: string }[] }, code: string) {
  const co = result.co_attainments.find((c) => c.code === code);
  if (!co) throw new Error(`No CO ${code} in result; have ${result.co_attainments.map((c) => c.code).join(', ')}`);
  return co;
}

export function poOf(result: { po_attainments: { code: string }[] }, code: string) {
  const po = result.po_attainments.find((p) => p.code === code);
  if (!po) throw new Error(`No outcome ${code} in result`);
  return po;
}

export function hasWarning(
  result: { warnings: { code: string }[] },
  code: string,
): boolean {
  return result.warnings.some((w) => w.code === code);
}
