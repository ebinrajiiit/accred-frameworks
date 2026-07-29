/**
 * The orchestrator: one offering in, one result document out (spec §6).
 *
 * Reading order, which is also the order of the spec: check the framework, select the
 * cohort, resolve how SEE data is going to be handled, measure every student against every
 * CO, band the result, fold in the survey, propagate to POs, stamp everything.
 */

import {
  buildIndex,
  computeStudentCo,
  measureQuestionWise,
  resolveComponents,
  type AssessmentCoMeasure,
  type Component,
  type MeasureFn,
} from './co.js';
import { selectCohort, toCohortTrace } from './cohort.js';
import { computeIndirect } from './indirect.js';
import { clampToScale, computeLevel } from './level.js';
import { assertFrameworkMatch, computeCoursePo, frameworkLabel } from './po.js';
import { resolveSee } from './see.js';
import { computeInputHash } from './hash.js';
import { ENGINE_VERSION } from './version.js';
import { WarningLog } from './warnings.js';
import type {
  CoAttainment,
  CoTrace,
  ContributingAssessment,
  EngineContext,
  EngineInput,
  EngineResult,
  PolicyDocument,
  StudentCoTrace,
} from './types.js';

export function computeOffering(
  input: EngineInput,
  policy: PolicyDocument,
  ctx: EngineContext,
): EngineResult {
  // §4.1 — before anything else. Computing first and warning afterwards would put an
  // invalid number on screen, and numbers on screens get copied into submissions.
  assertFrameworkMatch(policy, input.framework, { offering_id: input.offering.id });

  const warnings = new WarningLog();
  const framework = input.framework;
  const label = frameworkLabel(framework);

  if (policy.framework.supersedes && policy.framework.version === policy.framework.supersedes) {
    warnings.push(
      'RETIRED_FRAMEWORK',
      `This run computes under ${label}, which has been superseded. Historical terms may ` +
        `legitimately use it; a current submission may not.`,
    );
  }

  const index = buildIndex(input, warnings);
  const cohort = selectCohort(input.enrollments, policy.cohort);
  const consideredIds = new Set(cohort.considered.map((e) => e.id));

  validateBlueprint(input, policy, warnings);
  validateArticulation(input, policy, warnings);

  const see = resolveSee(input, policy, consideredIds, warnings);

  let components = resolveComponents(input, policy, warnings);
  if (see.excluded || see.proxy) {
    // Under `excluded` SEE contributes nothing; under `threshold_proxy` it yields a level
    // directly rather than per-student percentages, so it cannot be blended here.
    components = components.filter((c) => c.kind !== 'see');
  }

  const measure: MeasureFn = (enrollmentId, coId, assessmentId): AssessmentCoMeasure => {
    if (see.measure && see.seeAssessmentIds.has(assessmentId)) {
      return see.measure(enrollmentId, coId, assessmentId);
    }
    return measureQuestionWise(index, policy, enrollmentId, coId, assessmentId);
  };

  const wkByCo = new Map<string, string[]>();
  if (input.co_wk_map && input.wk_indicators) {
    const codeById = new Map(input.wk_indicators.map((w) => [w.id, w.code]));
    for (const m of input.co_wk_map) {
      const code = codeById.get(m.wk_indicator_id);
      if (!code) continue;
      const list = wkByCo.get(m.course_outcome_id) ?? [];
      list.push(code);
      wkByCo.set(m.course_outcome_id, list);
    }
    for (const list of wkByCo.values()) list.sort();
  }

  const indirect = computeIndirect(input, policy, warnings);

  const coAttainments: CoAttainment[] = [];

  for (const co of [...input.course_outcomes].sort((a, b) =>
    (a.sequence ?? 0) - (b.sequence ?? 0) || a.code.localeCompare(b.code, undefined, { numeric: true }),
  )) {
    coAttainments.push(
      computeCourseOutcome({
        input,
        policy,
        ctx,
        co,
        components,
        measure,
        cohort,
        see,
        indirect,
        wkCodes: wkByCo.get(co.id),
        frameworkLabel: label,
        warnings,
      }),
    );
  }

  const poAttainments = computeCoursePo(
    coAttainments,
    input.articulation,
    input.outcomes,
    policy,
    framework,
    warnings,
    ctx.run_id,
  );

  const stamps: string[] = [];
  if (policy.reporting.stamp_framework_version !== false) stamps.push(`Framework: ${label}`);
  if (policy.reporting.stamp_policy_version) stamps.push(`Policy: ${policy.id} v${policy.version}`);
  if (policy.reporting.stamp_engine_version) stamps.push(`Engine: v${ENGINE_VERSION}`);
  if (policy.reporting.stamp_fallbacks_used) {
    if (see.stamp) stamps.push(see.stamp);
    if (warnings.all().some((w) => w.code === 'GRADE_DERIVED')) stamps.push('Grade-derived components');
    if (warnings.all().some((w) => w.code === 'INDIRECT_SUPPRESSED')) {
      stamps.push('Indirect attainment suppressed — insufficient survey responses');
    }
    if (cohort.considered.length > 0 && cohort.considered.length < policy.cohort.min_cohort_size) {
      stamps.push('Small cohort — indicative only');
      warnings.push(
        'SMALL_COHORT',
        `${cohort.considered.length} students is below the minimum cohort size of ` +
          `${policy.cohort.min_cohort_size}; results are indicative only.`,
        undefined,
        { considered: cohort.considered.length, minimum: policy.cohort.min_cohort_size },
      );
    }
  }

  const result: EngineResult = {
    engine_version: ENGINE_VERSION,
    policy_id: policy.id,
    policy_version: policy.version,
    framework,
    input_hash: computeInputHash(input, policy, framework),
    computed_at: ctx.computed_at,
    offering_id: input.offering.id,
    scale: policy.scale,
    see_mode: see.mode,
    stamps,
    cohort_summary: toCohortTrace(cohort.considered.length, cohort.reasons),
    co_attainments: coAttainments,
    po_attainments: poAttainments,
    warnings: warnings.all(),
  };
  if (ctx.computed_by) result.computed_by = ctx.computed_by;
  if (ctx.run_id) result.run_id = ctx.run_id;
  return result;
}

// ---------------------------------------------------------------------------

interface CoArgs {
  input: EngineInput;
  policy: PolicyDocument;
  ctx: EngineContext;
  co: EngineInput['course_outcomes'][number];
  components: Component[];
  measure: MeasureFn;
  cohort: ReturnType<typeof selectCohort>;
  see: ReturnType<typeof resolveSee>;
  indirect: ReturnType<typeof computeIndirect>;
  wkCodes?: string[];
  frameworkLabel: string;
  warnings: WarningLog;
}

function computeCourseOutcome(args: CoArgs): CoAttainment {
  const { input, policy, ctx, co, components, measure, cohort, see, indirect, warnings } = args;

  const students: StudentCoTrace[] = [];
  const pcts: number[] = [];
  const ciePcts: number[] = [];
  const seePcts: number[] = [];
  const exclusions: Record<string, number> = {};
  const contributing = new Map<string, ContributingAssessment>();

  const ordered = [...cohort.considered].sort((a, b) =>
    a.roll_no.localeCompare(b.roll_no, undefined, { numeric: true }),
  );

  for (const enrollment of ordered) {
    const r = computeStudentCo(components, policy, enrollment.id, co.id, measure);

    const perAssessment: StudentCoTrace['per_assessment'] = [];
    let obtained = 0;
    let maximum = 0;

    for (const cm of r.components) {
      for (const m of cm.members) {
        const assessment = input.assessments.find((a) => a.id === m.assessment_id);
        if (!assessment) continue;

        if (m.selected) {
          obtained += m.obtained;
          maximum += m.maximum;
        }

        // An assessment contributes to a CO only if it measured it — either through tagged
        // questions, or through an apportioned SEE total, which has a maximum but no
        // question rows. Without this, every assessment in the course would be listed
        // against every CO.
        if (m.maximum <= 0 && m.questions.length === 0) continue;

        const existing = contributing.get(m.assessment_id);
        const entry: ContributingAssessment = existing ?? {
          assessment_id: m.assessment_id,
          name: assessment.name,
          kind: assessment.kind,
          weight: cm.component.weight,
          questions: [],
        };
        for (const q of m.questions) {
          if (!entry.questions.includes(q.label)) entry.questions.push(q.label);
        }
        if (m.dropped_by_best_n) entry.dropped_by_best_n = true;
        contributing.set(m.assessment_id, entry);

        const pa: StudentCoTrace['per_assessment'][number] = {
          assessment_id: m.assessment_id,
          obtained: m.obtained,
          maximum: m.maximum,
          questions: m.questions,
        };
        if (m.pct !== undefined) pa.pct = m.pct;
        perAssessment.push(pa);
      }
    }

    const trace: StudentCoTrace = {
      enrollment_id: enrollment.id,
      roll_no: enrollment.roll_no,
      obtained,
      maximum,
      per_assessment: perAssessment,
    };

    if (r.pct === undefined) {
      const reason =
        r.components.flatMap((c) => c.members).find((m) => m.skipped_reason)?.skipped_reason ??
        'no_data';
      trace.excluded_reason = reason;
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    } else {
      trace.pct = r.pct;
      trace.crossed = r.pct >= policy.direct.target_pct / 100;
      pcts.push(r.pct);
      if (r.pct_cie !== undefined) ciePcts.push(r.pct_cie);
      if (r.pct_see !== undefined) seePcts.push(r.pct_see);
    }

    students.push(trace);
  }

  const split = policy.direct.combination === 'split' || see.proxy !== undefined;
  if (see.proxy && policy.direct.combination !== 'split') {
    warnings.push(
      'COMBINATION_FORCED_SPLIT',
      'The pass-threshold proxy produces an end-semester level directly, so internal and ' +
        'end-semester attainment were combined as separate levels rather than as weighted components.',
    );
  }

  const overall = computeLevel(pcts, policy.direct, policy.scale);
  const cieOnly = split ? computeLevel(ciePcts.length > 0 ? ciePcts : pcts, policy.direct, policy.scale) : undefined;

  let direct: number | undefined;
  let directCie: number | undefined;
  let directSee: number | undefined;

  if (split) {
    directCie = cieOnly?.value;
    directSee = see.proxy
      ? see.proxy.level
      : computeLevel(seePcts, policy.direct, policy.scale)?.value;

    const parts: { w: number; v: number }[] = [];
    if (directCie !== undefined) parts.push({ w: policy.direct.cie_weight, v: directCie });
    if (directSee !== undefined) parts.push({ w: policy.direct.see_weight, v: directSee });
    const den = parts.reduce((a, b) => a + b.w, 0);
    if (den > 0) direct = parts.reduce((a, b) => a + b.w * b.v, 0) / den;
  } else {
    direct = overall?.value;
  }

  const ind = indirect.get(co.id);
  let final = direct;
  if (direct !== undefined && ind?.value !== undefined) {
    final = policy.weights.direct * direct + policy.weights.indirect * ind.value;
  } else if (direct === undefined && ind?.value !== undefined) {
    final = ind.value;
  }

  const measured = contributing.size > 0 && [...contributing.values()].some((c) => c.questions.length > 0);
  if (!measured && see.mode === 'question_wise') {
    // §12.9 — loudly, never a silent zero.
    warnings.push(
      'CO_NOT_ASSESSED',
      `${co.code} has no question mapped to it in any assessment, so no attainment could be ` +
        `computed. This is a blueprint gap, not an attainment of zero.`,
      { course_outcome_id: co.id },
    );
  } else {
    const assessedIn = contributing.size;
    if (assessedIn > 0 && assessedIn < policy.validation.min_assessments_per_co) {
      warnings.push(
        'CO_UNDER_ASSESSED',
        `${co.code} is assessed in ${assessedIn} assessment${assessedIn === 1 ? '' : 's'}, below the ` +
          `policy minimum of ${policy.validation.min_assessments_per_co}.`,
        { course_outcome_id: co.id },
        { assessed_in: assessedIn, minimum: policy.validation.min_assessments_per_co },
      );
    }
  }

  if (pcts.length === 0) {
    warnings.push(
      'EMPTY_COHORT',
      `${co.code} could not be computed for any student in the cohort.`,
      { course_outcome_id: co.id },
    );
  }

  if (policy.validation.require_wk_tag_per_co && (args.wkCodes?.length ?? 0) === 0) {
    warnings.push(
      'WK_TAG_MISSING',
      `${co.code} carries no Washington Accord knowledge indicator, which SAR 2025 CO-PO-WK ` +
        `mapping requires.`,
      { course_outcome_id: co.id },
    );
  }

  const trace: CoTrace = {
    formula: overall?.formula ?? policy.direct.method,
    framework: args.frameworkLabel,
    inputs: {
      target_pct: policy.direct.target_pct,
      bands: policy.direct.bands.map((b) => [b.at_least, b.level]),
      combination: split ? 'split' : policy.direct.combination,
      see_mode: see.mode,
      ...(split ? { cie_weight: policy.direct.cie_weight, see_weight: policy.direct.see_weight } : {}),
      ...(ind ? { indirect: { responses: ind.responses, suppressed: ind.suppressed, mapping: ind.mapping } } : {}),
      weights: policy.weights,
    },
    cohort: toCohortTrace(pcts.length, mergeReasons(cohort.reasons, exclusions)),
    contributing_assessments: [...contributing.values()].sort((a, b) =>
      a.assessment_id.localeCompare(b.assessment_id),
    ),
    students,
    drilldown_query: `co_attainment:run=${ctx.run_id ?? ''}:co=${co.id}`,
  };
  if (overall?.crossed !== undefined) trace.crossed = overall.crossed;
  if (overall?.ratio !== undefined) trace.ratio = overall.ratio;
  if (overall?.mean_pct !== undefined) trace.mean_pct = overall.mean_pct;
  if (direct !== undefined) trace.level = direct;
  if (see.proxy) trace.inputs.see_proxy = see.proxy;

  const out: CoAttainment = {
    course_outcome_id: co.id,
    code: co.code,
    students_considered: pcts.length,
    trace,
    warnings: warnings.forCourseOutcome(co.id),
  };
  if (direct !== undefined) out.direct_value = clampToScale(direct, policy.scale);
  if (ind?.value !== undefined) out.indirect_value = clampToScale(ind.value, policy.scale);
  if (final !== undefined) {
    out.final_value = clampToScale(final, policy.scale);
    out.level = out.final_value;
  }
  if (overall?.crossed !== undefined) out.students_crossed = overall.crossed;
  if (directCie !== undefined) out.direct_cie = directCie;
  if (directSee !== undefined) out.direct_see = directSee;
  if (args.wkCodes && args.wkCodes.length > 0) out.wk_codes = args.wkCodes;

  applyOverride(out, input, policy, warnings);
  return out;
}

/** P6 — an override never replaces a value quietly. */
function applyOverride(
  co: CoAttainment,
  input: EngineInput,
  policy: PolicyDocument,
  warnings: WarningLog,
): void {
  const o = (input.overrides ?? []).find(
    (x) => x.entity_type === 'co_attainment' && x.entity_id === co.course_outcome_id,
  );
  if (!o) return;

  const original = co.final_value;
  co.overridden = { value: o.override_value, reason: o.reason, author_id: o.author_id };
  if (original !== undefined) co.overridden.original = original;
  co.final_value = o.override_value;
  co.level = o.override_value;

  if (policy.reporting.mark_overrides_visibly) {
    warnings.push(
      'OVERRIDE_APPLIED',
      `${co.code}: computed value ${original?.toFixed(2) ?? '—'} was manually overridden to ` +
        `${o.override_value.toFixed(2)}. Reason: ${o.reason}`,
      { course_outcome_id: co.course_outcome_id },
      { author_id: o.author_id, created_at: o.created_at },
    );
  }
}

function mergeReasons(
  a: Record<string, number>,
  b: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}

/**
 * Articulation-matrix rules from §10.3, checked at course scope.
 *
 * These are the checks that make sense per course: a CO evidencing no program outcome is a
 * gap in the matrix, and a CO claiming to evidence most of them is usually a matrix filled
 * in defensively rather than honestly. The "PO unmapped" check is program-scoped and lives
 * in `computeProgram`.
 */
function validateArticulation(
  input: EngineInput,
  policy: PolicyDocument,
  warnings: WarningLog,
): void {
  const byCo = new Map<string, number>();
  const threshold = policy.po.ignore_correlation_below;

  for (const a of input.articulation) {
    if (a.correlation <= 0 || a.correlation < threshold) continue;
    byCo.set(a.course_outcome_id, (byCo.get(a.course_outcome_id) ?? 0) + 1);
  }

  for (const co of input.course_outcomes) {
    const count = byCo.get(co.id) ?? 0;

    if (count === 0) {
      warnings.push(
        'CO_UNMAPPED',
        `${co.code} is not mapped to any program outcome, so nothing it measures can reach a ` +
          `PO. Every CO must map to at least one.`,
        { course_outcome_id: co.id },
      );
      continue;
    }

    const limit = policy.validation.warn_co_mapped_to_more_than_n_pos;
    if (limit > 0 && count > limit) {
      warnings.push(
        'CO_OVER_MAPPED',
        `${co.code} is mapped to ${count} program outcomes, above the ${limit} the policy treats ` +
          `as plausible. A CO that appears to evidence everything usually evidences nothing in ` +
          `particular.`,
        { course_outcome_id: co.id },
        { mapped_to: count, limit },
      );
    }
  }

  if (policy.validation.require_justification_in_articulation) {
    for (const a of input.articulation) {
      if (a.correlation <= 0) continue;
      if (a.justification?.trim()) continue;
      warnings.push(
        'ARTICULATION_JUSTIFICATION_MISSING',
        `The mapping from ${labelOfCo(input, a.course_outcome_id)} to ` +
          `${labelOfOutcome(input, a.outcome_id)} carries no written justification, which NBA asks for.`,
        { course_outcome_id: a.course_outcome_id, outcome_id: a.outcome_id },
      );
    }
  }
}

const labelOfCo = (input: EngineInput, id: string) =>
  input.course_outcomes.find((c) => c.id === id)?.code ?? id;
const labelOfOutcome = (input: EngineInput, id: string) =>
  input.outcomes.find((o) => o.id === id)?.code ?? id;

/** Authoring-time rules, checked at run time too so a stale blueprint cannot hide (§10.6). */
function validateBlueprint(
  input: EngineInput,
  policy: PolicyDocument,
  warnings: WarningLog,
): void {
  if (!policy.validation.question_marks_must_total_assessment_max) return;

  const hasChildren = new Set(input.questions.filter((q) => q.parent_id).map((q) => q.parent_id!));
  for (const a of input.assessments) {
    if (a.kind === 'see' && input.offering.see_mode && input.offering.see_mode !== 'question_wise') {
      continue; // no question structure is expected for an apportioned paper
    }
    const leaves = input.questions.filter((q) => q.assessment_id === a.id && !hasChildren.has(q.id));
    if (leaves.length === 0) continue;

    // Count the paper a student actually sits, not every question printed on it. "Answer any
    // five of seven" prints 70 marks and is scored out of 50; summing all the alternatives
    // would warn on almost every Indian question paper, and a warning that fires constantly
    // is one nobody reads.
    let total = 0;
    const seenChoiceGroups = new Set<string>();
    for (const q of leaves) {
      if (!q.choice_group) {
        if (!q.is_optional) total += q.max_marks;
        continue;
      }
      if (seenChoiceGroups.has(q.choice_group)) continue;
      seenChoiceGroups.add(q.choice_group);

      const alternatives = leaves
        .filter((x) => x.choice_group === q.choice_group)
        .sort((x, y) => (x.sequence ?? 0) - (y.sequence ?? 0));
      const required =
        (input.choice_groups ?? []).find((c) => c.id === q.choice_group)?.required ??
        alternatives.length;
      total += alternatives.slice(0, required).reduce((sum, x) => sum + x.max_marks, 0);
    }

    if (Math.abs(total - a.max_marks) > 1e-9) {
      warnings.push(
        'ASSESSMENT_MARKS_MISMATCH',
        `"${a.name}" is scored out of ${total} once choice questions are resolved, but the ` +
          `assessment maximum is ${a.max_marks}.`,
        { assessment_id: a.id },
        { question_total: total, assessment_max: a.max_marks },
      );
    }
  }
}
