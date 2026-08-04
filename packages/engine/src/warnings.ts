/**
 * Warnings and report stamps.
 *
 * P6 (degrade honestly): when the engine cannot compute something the normal way it
 * must say so in the result, in a form the report renders verbatim. Warnings are
 * therefore *typed data*, never prose assembled at the call site — the UI, the PDF
 * export and the SAR table all have to say the same thing about the same run.
 */

export type WarningCode =
  /** A course outcome has no question mapped to it in any assessment. Must be loud —
   *  silently scoring it 0 is how fabricated attainment gets into a SAR. (§12.9) */
  | 'CO_NOT_ASSESSED'
  /** A CO is assessed in fewer assessments than policy.validation.min_assessments_per_co. */
  | 'CO_UNDER_ASSESSED'
  /** Marks exist for a CO but every instrument is weighted 0 for it, so nothing combines. */
  | 'NO_WEIGHTED_COMPONENT'
  /** An instrument names a grade target the policy's grade scale cannot resolve. */
  | 'GRADE_TARGET_UNRESOLVED'
  /** A CO maps to no program outcome at all, so nothing it measures can reach a PO. (§10.3) */
  | 'CO_UNMAPPED'
  /** A CO maps to more POs than policy treats as plausible. (§10.3) */
  | 'CO_OVER_MAPPED'
  /** An articulation cell carries no written justification, which NBA asks for. (§10.3) */
  | 'ARTICULATION_JUSTIFICATION_MISSING'
  /**
   * A program outcome has no CO mapped to it across an entire program (§12.10).
   * Program-scoped only — one course is not expected to address every PO.
   */
  | 'PO_UNMAPPED'
  /** Cohort smaller than policy.cohort.min_cohort_size — computed, but indicative only. */
  | 'SMALL_COHORT'
  /** No student had usable data for this CO, so nothing could be computed. */
  | 'EMPTY_COHORT'
  /** Survey responses below policy.indirect.min_responses → indirect suppressed, final = direct. (§12.13) */
  | 'INDIRECT_SUPPRESSED'
  /** Survey response *rate* below policy.indirect.min_response_rate. */
  | 'INDIRECT_LOW_RESPONSE_RATE'
  /** No survey supplied at all, so final = direct. */
  | 'INDIRECT_ABSENT'
  /** SEE was not available question-wise; a fallback apportionment was used. (§4.5) */
  | 'SEE_FALLBACK_USED'
  /** SEE marks expected but no totals or questions found for the SEE assessment. */
  | 'SEE_DATA_MISSING'
  /** A component arrived as letter grades and was converted via policy.grade_scale. (§4.6) */
  | 'GRADE_DERIVED'
  /** threshold_proxy produces a level directly, so CIE/SEE cannot be blended as weighted
   *  components; the engine forced `split` combination and says so. */
  | 'COMBINATION_FORCED_SPLIT'
  /** An assessment group mixes CIE and SEE assessments; group kind taken from its first member. */
  | 'MIXED_GROUP_KIND'
  /** A recorded score exceeds the question's max marks. */
  | 'SCORE_EXCEEDS_MAX'
  /** Question→CO weights for a question do not sum to 1. */
  | 'QUESTION_WEIGHTS_NOT_NORMALISED'
  /** Question marks do not total the assessment max. */
  | 'ASSESSMENT_MARKS_MISMATCH'
  /** A best-of-N group has fewer assessments than N. */
  | 'BEST_N_UNDERFILLED'
  /** A manual override replaced a computed value. (P6) */
  | 'OVERRIDE_APPLIED'
  /** Program rollup: a PO's attainment is below its target and needs an action plan. (§6.7) */
  | 'GAP_REQUIRES_ACTION'
  /** Computing a current term under a framework version that has been superseded. (§4.1) */
  | 'RETIRED_FRAMEWORK'
  /** policy.validation.require_wk_tag_per_co is set but a CO carries no WK indicator. (§4.1) */
  | 'WK_TAG_MISSING'
  /** policy.program.targets_by_outcome names an outcome the bound framework does not define —
   *  e.g. a PO12 target left behind after the move to the 11-PO GAPC v4.0 set. */
  | 'TARGET_OUTCOME_UNKNOWN';

export type WarningSeverity = 'info' | 'warn' | 'error';

export interface EngineWarning {
  code: WarningCode;
  severity: WarningSeverity;
  /** Human-readable, already resolved — reports render this verbatim. */
  message: string;
  /** What the warning is about, so the UI can link to it. */
  subject?: {
    course_outcome_id?: string;
    outcome_id?: string;
    /** Used when the outcome is named but not resolvable — e.g. a stale PO12 target. */
    outcome_code?: string;
    wk_indicator_id?: string;
    assessment_id?: string;
    question_id?: string;
    enrollment_id?: string;
  };
  /** Structured detail for anything that wants the numbers rather than the sentence. */
  detail?: Record<string, unknown>;
}

const SEVERITY: Record<WarningCode, WarningSeverity> = {
  CO_NOT_ASSESSED: 'error',
  CO_UNDER_ASSESSED: 'warn',
  NO_WEIGHTED_COMPONENT: 'error',
  GRADE_TARGET_UNRESOLVED: 'warn',
  CO_UNMAPPED: 'error',
  CO_OVER_MAPPED: 'warn',
  ARTICULATION_JUSTIFICATION_MISSING: 'info',
  PO_UNMAPPED: 'warn',
  SMALL_COHORT: 'warn',
  EMPTY_COHORT: 'error',
  INDIRECT_SUPPRESSED: 'warn',
  INDIRECT_LOW_RESPONSE_RATE: 'warn',
  INDIRECT_ABSENT: 'info',
  SEE_FALLBACK_USED: 'warn',
  SEE_DATA_MISSING: 'error',
  GRADE_DERIVED: 'warn',
  COMBINATION_FORCED_SPLIT: 'warn',
  MIXED_GROUP_KIND: 'warn',
  SCORE_EXCEEDS_MAX: 'error',
  QUESTION_WEIGHTS_NOT_NORMALISED: 'warn',
  ASSESSMENT_MARKS_MISMATCH: 'warn',
  BEST_N_UNDERFILLED: 'warn',
  OVERRIDE_APPLIED: 'warn',
  GAP_REQUIRES_ACTION: 'warn',
  RETIRED_FRAMEWORK: 'warn',
  WK_TAG_MISSING: 'warn',
  TARGET_OUTCOME_UNKNOWN: 'warn',
};

export function warn(
  code: WarningCode,
  message: string,
  subject?: EngineWarning['subject'],
  detail?: Record<string, unknown>,
): EngineWarning {
  const w: EngineWarning = { code, severity: SEVERITY[code], message };
  if (subject) w.subject = subject;
  if (detail) w.detail = detail;
  return w;
}

/**
 * Report stamps for the SEE-availability modes (§4.5).
 *
 * Every export carries the stamp of any fallback used, so a reader can tell a full
 * computation from an apportioned one without reading the policy.
 */
export const SEE_MODE_STAMP: Record<string, string | null> = {
  question_wise: null,
  blueprint_uniform: 'SEE apportioned by published blueprint',
  uniform_split: 'SEE apportioned uniformly',
  threshold_proxy: 'SEE by pass-threshold proxy',
  excluded: 'SEE excluded',
};

/** Collector that keeps warnings unique and in insertion order. */
export class WarningLog {
  private readonly seen = new Set<string>();
  private readonly items: EngineWarning[] = [];

  add(w: EngineWarning): void {
    const key = `${w.code}|${JSON.stringify(w.subject ?? null)}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.items.push(w);
  }

  push(
    code: WarningCode,
    message: string,
    subject?: EngineWarning['subject'],
    detail?: Record<string, unknown>,
  ): void {
    this.add(warn(code, message, subject, detail));
  }

  all(): EngineWarning[] {
    return [...this.items];
  }

  /** Warnings scoped to one course outcome, for the per-CO row of a report. */
  forCourseOutcome(id: string): EngineWarning[] {
    return this.items.filter((w) => w.subject?.course_outcome_id === id);
  }

  hasErrors(): boolean {
    return this.items.some((w) => w.severity === 'error');
  }
}
