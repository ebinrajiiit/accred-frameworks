/**
 * The affiliated-college problem (spec §4.6).
 *
 * An autonomous institute marks its own end-semester exam and has question-wise SEE data.
 * An affiliated college receives a total from the university, sometimes only a letter grade.
 * Both must produce a usable number, and the reader must be able to tell which they are
 * looking at — hence a report stamp on every mode but the first (P7).
 */

import type { AssessmentCoMeasure } from './co.js';
import type {
  AssessmentInput,
  AssessmentTotalInput,
  EngineInput,
  PolicyDocument,
  SeeMode,
} from './types.js';
import { SEE_MODE_STAMP, WarningLog } from './warnings.js';
import { statusEffect, reasonForStatus } from './cohort.js';

export interface SeeResolution {
  mode: SeeMode;
  seeAssessmentIds: Set<string>;
  /** Replaces question-wise measurement for SEE assessments. Absent under `question_wise`. */
  measure?: (enrollmentId: string, coId: string, assessmentId: string) => AssessmentCoMeasure;
  /** `threshold_proxy` yields a level directly, identical for every CO. */
  proxy?: { level: number; ratio: number; considered: number; crossed: number };
  /** SEE contributes nothing — components are dropped before blending. */
  excluded: boolean;
  stamp?: string;
}

/** Offering-level mode wins: a college may get question-wise data for one course, totals for another. */
export function effectiveSeeMode(input: EngineInput, policy: PolicyDocument): SeeMode {
  return input.offering.see_mode ?? policy.direct.see_mode;
}

export function resolveSee(
  input: EngineInput,
  policy: PolicyDocument,
  consideredEnrollmentIds: Set<string>,
  warnings: WarningLog,
): SeeResolution {
  const mode = effectiveSeeMode(input, policy);
  const seeAssessments = input.assessments.filter((a) => a.kind === 'see');
  const seeAssessmentIds = new Set(seeAssessments.map((a) => a.id));
  const stamp = SEE_MODE_STAMP[mode] ?? undefined;

  if (stamp) {
    warnings.push('SEE_FALLBACK_USED', stamp, undefined, { see_mode: mode });
  }

  if (mode === 'question_wise') {
    return { mode, seeAssessmentIds, excluded: false };
  }
  if (mode === 'excluded') {
    return { mode, seeAssessmentIds, excluded: true, stamp };
  }

  if (seeAssessments.length === 0) {
    warnings.push(
      'SEE_DATA_MISSING',
      `SEE mode is "${mode}" but the offering has no end-semester assessment. CO attainment ` +
        `will be computed from internal assessments alone.`,
      undefined,
      { see_mode: mode },
    );
    return { mode, seeAssessmentIds, excluded: true, stamp };
  }

  const totals = indexTotals(input, seeAssessmentIds);
  const scoreOf = makeScoreResolver(input, policy, totals, warnings);

  if (mode === 'threshold_proxy') {
    return {
      mode,
      seeAssessmentIds,
      excluded: false,
      stamp,
      proxy: computeProxy(seeAssessments, consideredEnrollmentIds, scoreOf, policy, warnings),
    };
  }

  // blueprint_uniform and uniform_split both apportion the total across COs.
  const distribution = buildDistribution(input, policy, mode, warnings);

  const measure = (
    enrollmentId: string,
    coId: string,
    assessmentId: string,
  ): AssessmentCoMeasure => {
    const assessment = input.assessments.find((a) => a.id === assessmentId)!;
    const share = distribution.get(coId) ?? 0;

    if (share <= 0) {
      // This CO is not represented in the SEE paper at all.
      return { assessment_id: assessmentId, obtained: 0, maximum: 0, questions: [] };
    }

    const resolved = scoreOf(enrollmentId, assessment);
    if (resolved.effect === 'skip') {
      return {
        assessment_id: assessmentId,
        obtained: 0,
        maximum: 0,
        questions: [],
        skipped_reason: resolved.reason,
      };
    }

    const maximum = assessment.max_marks * share;
    const obtained = (resolved.score ?? 0) * share;
    const out: AssessmentCoMeasure = {
      assessment_id: assessmentId,
      obtained,
      maximum,
      questions: [],
    };
    if (maximum > 0) out.pct = obtained / maximum;
    return out;
  };

  return { mode, seeAssessmentIds, excluded: false, stamp, measure };
}

/**
 * The CO shares of the SEE paper, as fractions summing to 1.
 *
 * Worth being explicit about what apportionment can and cannot do: because both the
 * numerator and the denominator are scaled by the same share, `pct` comes out as
 * `total / max` for *every* CO the paper touches. Apportioning a total adds no information
 * about which outcomes a student actually demonstrated — it only decides which COs the SEE
 * result is allowed to speak to. That is precisely why these modes carry a report stamp and
 * `question_wise` does not.
 */
function buildDistribution(
  input: EngineInput,
  policy: PolicyDocument,
  mode: SeeMode,
  warnings: WarningLog,
): Map<string, number> {
  const out = new Map<string, number>();

  if (mode === 'blueprint_uniform') {
    const blueprint = input.see_blueprint;
    if (blueprint && blueprint.distribution.length > 0) {
      const total = blueprint.distribution.reduce((a, b) => a + b.marks, 0);
      if (total > 0) {
        for (const d of blueprint.distribution) out.set(d.course_outcome_id, d.marks / total);
        return out;
      }
    }
    // §12.11 — no blueprint published after all. Fall back one further step, and say so.
    warnings.push(
      'SEE_FALLBACK_USED',
      'No usable SEE blueprint was supplied; the total was apportioned uniformly instead.',
      undefined,
      { requested_mode: 'blueprint_uniform', applied_mode: 'uniform_split' },
    );
  }

  const cos = input.course_outcomes;
  if (cos.length === 0) return out;
  const share = 1 / cos.length;
  for (const co of cos) out.set(co.id, share);
  return out;
}

interface ResolvedScore {
  score?: number;
  effect: 'use' | 'skip' | 'count_zero';
  reason?: ReturnType<typeof reasonForStatus>;
}

function indexTotals(
  input: EngineInput,
  seeAssessmentIds: Set<string>,
): Map<string, AssessmentTotalInput> {
  const map = new Map<string, AssessmentTotalInput>();
  for (const t of input.assessment_totals ?? []) {
    if (!seeAssessmentIds.has(t.assessment_id)) continue;
    map.set(`${t.enrollment_id}|${t.assessment_id}`, t);
  }
  return map;
}

/**
 * Resolve a student's SEE total, converting from a letter grade where that is all the
 * university released (§4.7, §12.12).
 */
function makeScoreResolver(
  input: EngineInput,
  policy: PolicyDocument,
  totals: Map<string, AssessmentTotalInput>,
  warnings: WarningLog,
) {
  let gradeDerivedReported = false;

  return function scoreOf(enrollmentId: string, assessment: AssessmentInput): ResolvedScore {
    const row = totals.get(`${enrollmentId}|${assessment.id}`);
    const effect = statusEffect(row?.status, policy.cohort);
    if (effect === 'skip') return { effect, reason: reasonForStatus(row?.status) };
    if (effect === 'count_zero') return { effect, score: 0 };

    if (row?.total_score !== undefined) return { effect: 'use', score: row.total_score };

    if (row?.grade !== undefined) {
      if (!policy.grade_scale.enabled) {
        warnings.push(
          'SEE_DATA_MISSING',
          `Only a letter grade is held for this end-semester result, but policy.grade_scale ` +
            `is disabled, so it cannot be used.`,
          { enrollment_id: enrollmentId, assessment_id: assessment.id },
        );
        return { effect: 'skip', reason: 'no_data' };
      }
      const pct = policy.grade_scale.mapping[row.grade];
      if (pct === undefined) {
        warnings.push(
          'SEE_DATA_MISSING',
          `Grade "${row.grade}" is not present in policy.grade_scale.mapping.`,
          { enrollment_id: enrollmentId, assessment_id: assessment.id },
        );
        return { effect: 'skip', reason: 'no_data' };
      }
      if (!gradeDerivedReported) {
        gradeDerivedReported = true;
        warnings.push(
          'GRADE_DERIVED',
          'End-semester results arrived as letter grades and were converted to representative ' +
            'marks; affected outcomes are grade-derived.',
          undefined,
          { assessment_id: assessment.id },
        );
      }
      return { effect: 'use', score: (pct / 100) * assessment.max_marks };
    }

    return { effect: 'skip', reason: 'no_data' };
  };
}

/**
 * `threshold_proxy` (§4.6): attainment from the fraction of students crossing a target on
 * the SEE total, applied identically to every CO.
 *
 * This is the weakest of the fallbacks — it says nothing about individual outcomes — but it
 * is what some affiliated colleges can actually evidence, and a stamped weak number beats an
 * invented strong one.
 */
function computeProxy(
  seeAssessments: AssessmentInput[],
  consideredEnrollmentIds: Set<string>,
  scoreOf: (enrollmentId: string, assessment: AssessmentInput) => ResolvedScore,
  policy: PolicyDocument,
  warnings: WarningLog,
): SeeResolution['proxy'] {
  const targetPct = policy.direct.see_threshold_proxy_pct ?? policy.direct.target_pct;
  const target = targetPct / 100;

  let considered = 0;
  let crossed = 0;

  for (const enrollmentId of consideredEnrollmentIds) {
    let num = 0;
    let den = 0;
    for (const a of seeAssessments) {
      const r = scoreOf(enrollmentId, a);
      if (r.effect === 'skip' || r.score === undefined) continue;
      num += r.score;
      den += a.max_marks;
    }
    if (den <= 0) continue;
    considered += 1;
    if (num / den >= target) crossed += 1;
  }

  if (considered === 0) {
    warnings.push(
      'SEE_DATA_MISSING',
      'No end-semester totals were available, so the pass-threshold proxy could not be computed.',
    );
    return undefined;
  }

  const ratio = crossed / considered;
  const bands = [...policy.direct.bands].sort((a, b) => a.at_least - b.at_least);
  let level = policy.scale.min;
  for (const b of bands) if (ratio >= b.at_least) level = b.level;

  return { level, ratio, considered, crossed };
}
