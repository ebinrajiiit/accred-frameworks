/**
 * The engine contract: plain documents in, a plain document out.
 *
 * Nothing here imports Prisma or knows a database exists. `computeOffering(input, policy, ctx)`
 * must be callable from a test with hand-written JSON — that is what makes the arithmetic
 * auditable and what lets `fixtures/` pin behaviour without standing up Postgres (spec §6).
 */

import type { EngineWarning } from './warnings.js';

// ---------------------------------------------------------------------------
// Shared vocabulary (spec §5.1)
// ---------------------------------------------------------------------------

export type OutcomeKind = 'po' | 'pso' | 'so';

export type CourseType =
  | 'theory'
  | 'lab'
  | 'integrated'
  | 'project'
  | 'internship'
  | 'seminar'
  | 'mooc';

export type AssessmentKind = 'cie' | 'see' | 'lab' | 'project' | 'survey_linked';

/** How a student stood in relation to one assessment. */
export type MarkStatus = 'present' | 'absent' | 'malpractice' | 'exempt' | 'not_attempted';

/** How a student stands in relation to the offering as a whole. */
export type EnrollmentStatus = 'active' | 'dropped' | 'audit' | 'backlog' | 'transfer';

/** The affiliated-college problem (spec §4.5). */
export type SeeMode =
  | 'question_wise'
  | 'blueprint_uniform'
  | 'uniform_split'
  | 'threshold_proxy'
  | 'excluded';

export type SelectionRule = 'all' | 'best_n';

export type BloomLevel =
  | 'remember'
  | 'understand'
  | 'apply'
  | 'analyse'
  | 'evaluate'
  | 'create';

/**
 * Which accreditation framework version an outcome set belongs to (P3, §4.1).
 *
 * `code` names the family (`nba-ug-eng`, `abet-eac`), `version` the revision within it
 * (`gapc-v4.0`, `gapc-v3.0`). The pair is stamped on every run, because the number of POs
 * is a property of the version — NBA went from 12 to 11 — and a result is only readable
 * against the framework that produced it.
 */
export interface FrameworkBinding {
  code: string;
  version: string;
  /** PO count declared by the framework; checked against the outcome set when present. */
  outcome_count?: number;
  /** The version this one replaced, if any. Enables the "retired framework" warning. */
  supersedes?: string;
}

// ---------------------------------------------------------------------------
// Policy document (spec §7) — the entire rulebook, as data
// ---------------------------------------------------------------------------

/**
 * The framework this policy binds to. The engine refuses to run when the program's
 * outcome set belongs to a different one — see `FrameworkMismatchError`.
 */
export interface PolicyFramework extends FrameworkBinding {
  pso_count?: number;
  /** Require every CO to carry at least one Washington Accord knowledge indicator. */
  require_wk_mapping?: boolean;
}

/** Controls the v3 → v4 remapping workflow (§4.2). Consumed by `@attainment/frameworks`. */
export interface PolicyMigration {
  from_version: string;
  to_version: string;
  /** Auto-propose the mapping where the correspondence is unambiguous. */
  auto_map_unambiguous: boolean;
  /** Outcome codes that must never auto-map — retired POs needing a human decision. */
  require_human_decision_for: string[];
  require_rationale_on_change: boolean;
  /**
   * Keep false. Historical terms stay computed under the framework in force at the time;
   * restating them under the new one destroys the audit trail.
   */
  recompute_historical_terms: boolean;
}

/** Verifier mode (§19) — recompute someone else's numbers and report disagreements. */
export interface PolicyVerifier {
  /** Absolute difference on the attainment scale below which a value counts as a match. */
  tolerance: number;
  /** When the institution cannot state its own rule, try each method and report which fits. */
  attempt_policy_inference: boolean;
}

export interface Band {
  /** Inclusive lower bound, on the same 0..1 ratio scale the method produces. */
  at_least: number;
  level: number;
}

export interface PolicyScale {
  kind: 'level' | 'percentage';
  min: number;
  max: number;
}

export interface PolicyDirect {
  method: 'target_ratio' | 'class_average' | 'percentage';
  /** Percentage a student must reach on a CO to count as having attained it. */
  target_pct: number;
  bands: Band[];
  /**
   * `weighted_components` — CIE and SEE are ordinary weighted assessments, blended
   *   before banding.
   * `split` — CIE and SEE are banded independently and combined as
   *   `cie_weight·level_cie + see_weight·level_see` (§6.3).
   */
  /**
   * How component results become one direct figure.
   *
   * `weighted_components` — average the percentages across instruments, then band once.
   * `split` — band internal and end-semester separately, then blend the two levels.
   * `component_levels` — band *each* instrument separately, then weight-average the levels.
   *
   * The third is not a variant of the first: banding before weighting and weighting before
   * banding give different numbers, and both are in live use. A cohort scoring 100% on one
   * instrument and 40% on another, equally weighted, is 70% banded once — or the average of
   * two separate bands. Which one an institution means is a policy question, not a detail.
   */
  combination: 'weighted_components' | 'split' | 'component_levels';
  cie_weight: number;
  see_weight: number;
  see_mode: SeeMode;
  /** Target on the SEE total, used only by `see_mode: threshold_proxy`. */
  see_threshold_proxy_pct?: number;
}

export interface PolicyCohort {
  /** `exclude` drops the student from the denominator; `zero` scores them 0. Outcome-changing (§4.9). */
  absent_handling: 'exclude' | 'zero';
  malpractice_handling: 'exclude' | 'zero';
  include_backlog_students: boolean;
  include_audit_students: boolean;
  dropped_handling: 'exclude' | 'include';
  /** Below this the result is stamped "small cohort — indicative only" but still computed. */
  min_cohort_size: number;
}

export interface PolicyAssessmentGroups {
  default_selection_rule: SelectionRule;
  best_n_ties: 'first' | 'last';
}

export interface PolicyIndirect {
  source: string;
  scale_min: number;
  scale_max: number;
  /** `linear` scales the mean rating onto the attainment scale; `threshold` bands the
   *  fraction of respondents rating at or above `threshold_rating`. */
  mapping: 'linear' | 'threshold';
  threshold_rating?: number;
  min_responses: number;
  min_response_rate?: number;
}

export interface PolicyPo {
  method: 'weighted_average' | 'scaled' | 'max';
  correlation_scale: { min: number; max: number };
  ignore_correlation_below: number;
}

export interface PolicyProgramIndirectSource {
  kind: string;
  weight: number;
}

export interface PolicyProgram {
  course_weighting: 'equal' | 'credits';
  indirect_sources: PolicyProgramIndirectSource[];
  weights: { direct: number; indirect: number };
  default_target: number;
  targets_by_outcome?: Record<string, number>;
  require_action_plan_when_gap_above: number;
}

export interface PolicyGradeScale {
  enabled: boolean;
  /** Letter grade → representative marks percentage (band midpoint by convention, §4.6). */
  mapping: Record<string, number>;
  /**
   * Grades from best to worst, when the institution's rule is stated as a grade rather than
   * as a percentage — "at or above C", not "at or above 65%".
   *
   * The two are not interchangeable in a report. Converting a grade rule to a percentage
   * means choosing a number that happens to fall between D and C, and then printing "target
   * 65%" where the institution's regulation says "grade C". An evaluator reading the first
   * cannot check it against the second.
   *
   * Order is the whole content: `["S","A+","A","B+","B","C+","C","D","P","F"]` says D beats
   * P, which no amount of alphabetics will tell you.
   */
  order?: string[];
}

export interface PolicyValidation {
  min_assessments_per_co: number;
  require_all_cos_assessed: boolean;
  require_justification_in_articulation: boolean;
  /** SAR 2025 expects CO-PO-WK mapping, so a missing WK tag is a reportable gap (§4.1). */
  require_wk_tag_per_co?: boolean;
  warn_co_mapped_to_more_than_n_pos: number;
  question_marks_must_total_assessment_max: boolean;
}

export interface PolicyReporting {
  stamp_policy_version: boolean;
  stamp_framework_version?: boolean;
  stamp_engine_version: boolean;
  stamp_fallbacks_used: boolean;
  mark_overrides_visibly: boolean;
  block_export_when_gap_without_action: boolean;
}

export type PolicyScopeType = 'institution' | 'program' | 'course_type' | 'course';

export interface PolicyDocument {
  id: string;
  version: string;
  label?: string;
  scope: { type: PolicyScopeType; ref: string | null };
  effective_from?: string;
  framework: PolicyFramework;
  scale: PolicyScale;
  direct: PolicyDirect;
  cohort: PolicyCohort;
  assessment_groups: PolicyAssessmentGroups;
  indirect: PolicyIndirect;
  weights: { direct: number; indirect: number };
  po: PolicyPo;
  program: PolicyProgram;
  migration?: PolicyMigration;
  grade_scale: PolicyGradeScale;
  validation: PolicyValidation;
  reporting: PolicyReporting;
  verifier?: PolicyVerifier;
}

/** A policy fragment as stored at a narrower scope — merged over the base (§7). */
export type PolicyPatch = {
  id?: string;
  version?: string;
  label?: string;
  scope: { type: PolicyScopeType; ref: string | null };
  effective_from?: string;
} & DeepPartial<Omit<PolicyDocument, 'id' | 'version' | 'label' | 'scope' | 'effective_from'>>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

// ---------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------

export interface OfferingInput {
  id: string;
  term_id?: string;
  section?: string;
  course: {
    id: string;
    code: string;
    title: string;
    credits: number;
    type: CourseType;
  };
  /** Offering-level override of `policy.direct.see_mode` — an affiliated college may get
   *  question-wise data for one course and totals for another. */
  see_mode?: SeeMode;
}

export interface CourseOutcomeInput {
  id: string;
  code: string;
  statement?: string;
  bloom_level?: BloomLevel;
  sequence?: number;
}

export interface OutcomeInput {
  id: string;
  code: string;
  kind: OutcomeKind;
  statement?: string;
  sequence?: number;
}

export interface ArticulationInput {
  course_outcome_id: string;
  outcome_id: string;
  /** Correlation strength on `policy.po.correlation_scale`, conventionally 1/2/3. */
  correlation: number;
  justification?: string;
  /** Set when this cell came from a framework migration — the v3 PO code it replaced (§4.2). */
  migrated_from_outcome_code?: string;
  migration_rationale?: string;
}

/**
 * A Washington Accord knowledge indicator. A third mapping dimension alongside PO and PSO,
 * not a property of either (§4.1) — SAR 2025 expects CO-PO-WK.
 */
export interface WkIndicatorInput {
  id: string;
  code: string;
  statement?: string;
}

export interface CoWkMapInput {
  course_outcome_id: string;
  wk_indicator_id: string;
}

export interface AssessmentGroupInput {
  id: string;
  name: string;
  selection_rule?: SelectionRule;
  /** How many members to keep under `best_n`. */
  n?: number;
  /** The group's share of the course, replacing its members' individual weights. */
  weight_pct: number;
  /** Per-outcome overrides of `weight_pct`. See `AssessmentInput.outcome_weights`. */
  outcome_weights?: OutcomeWeightInput[];
}

/**
 * What one instrument is worth *for one course outcome*.
 *
 * Institutions weight instruments differently per CO, and the difference is not cosmetic. A
 * CO taught through coursework might be 30% internal test, 30% assignment, 40% end-semester,
 * while a CO assessed only by examination is 50/0/50 in the same course. Collapsing that to a
 * single per-assessment weight silently reweights every outcome to whatever the course
 * average happens to be.
 *
 * Omitted entirely, an assessment falls back to its scalar `weight_pct` for every CO, which
 * is what every policy written before this existed means.
 */
export interface OutcomeWeightInput {
  course_outcome_id: string;
  weight_pct: number;
}

export interface AssessmentInput {
  id: string;
  name: string;
  kind: AssessmentKind;
  max_marks: number;
  /** Share of the course, or share within its group when `group_id` is set. */
  weight_pct: number;
  group_id?: string | null;
  /**
   * Overrides `policy.direct.target_pct` for this instrument alone.
   *
   * Institutions set the bar per instrument: an internal test at 70% and a learning
   * activity at 80% in the same course, because one is coursework with unlimited attempts
   * and the other is not.
   */
  target_pct?: number;
  /**
   * The target as a grade, for an instrument reported only as grades. Requires
   * `policy.grade_scale.order`. Takes precedence over `target_pct` where both are given.
   */
  target_grade?: string;
  /** Where the marks came from — drives the grade-derived stamp. */
  data_source?: 'question_wise' | 'totals' | 'grades' | 'co_wise';
  /**
   * Per-outcome overrides of `weight_pct`. A CO listed here uses the given weight; a CO
   * absent from the list falls back to `weight_pct`. Weights need not sum to 100 — they are
   * normalised per CO, so 50/50 and 30/30/40 both mean what they look like.
   */
  outcome_weights?: OutcomeWeightInput[];
}

export interface ChoiceGroupInput {
  id: string;
  assessment_id: string;
  /** "Answer any five of seven" → required = 5. */
  required: number;
  label?: string;
}

export interface QuestionInput {
  id: string;
  assessment_id: string;
  parent_id?: string | null;
  label: string;
  max_marks: number;
  /**
   * False for a component that carries marks but measures no outcome — attendance being the
   * usual one, worth ten of fifty internal marks in many schemes.
   *
   * Such a component is already excluded from attainment simply by having no CO mapping.
   * Declaring it says the omission is deliberate, which is the difference between a
   * blueprint that is finished and one that looks finished. Defaults to true.
   */
  counts_towards_outcomes?: boolean;
  bloom_level?: BloomLevel;
  choice_group?: string | null;
  is_optional?: boolean;
  sequence?: number;
}

export interface QuestionOutcomeInput {
  question_id: string;
  course_outcome_id: string;
  /** Weights for one question sum to 1 — a question split 0.6/0.4 across two COs (§12.2). */
  weight: number;
}

export interface EnrollmentInput {
  id: string;
  student_id: string;
  roll_no: string;
  display_name?: string;
  status: EnrollmentStatus;
}

export interface MarkInput {
  enrollment_id: string;
  question_id: string;
  score: number;
  /** False for an unanswered alternative in a choice group — this is what gives each
   *  student their own denominator (§6.1). */
  attempted: boolean;
  status?: MarkStatus;
}

export interface AssessmentTotalInput {
  enrollment_id: string;
  assessment_id: string;
  /** Omitted when only a grade is held. */
  total_score?: number;
  /** Letter grade, converted through `policy.grade_scale` (§4.6). */
  grade?: string;
  status?: MarkStatus;
}

/** The university's published paper blueprint, for `see_mode: blueprint_uniform`. */
export interface SeeBlueprintInput {
  assessment_id: string;
  distribution: { course_outcome_id: string; marks: number }[];
}

export interface SurveyInput {
  kind?: string;
  scale_min?: number;
  scale_max?: number;
  /** Denominator for `min_response_rate` — usually the enrolled count. */
  invited?: number;
  responses: { course_outcome_id: string; rating: number; respondent_token?: string }[];
}

/** A manual replacement of a computed value. Never silent (P5). */
export interface OverrideInput {
  entity_type: 'co_attainment' | 'po_attainment';
  entity_id: string;
  override_value: number;
  reason: string;
  author_id: string;
  created_at: string;
}

export interface EngineInput {
  offering: OfferingInput;
  /**
   * The framework the supplied outcome set belongs to. Checked against `policy.framework`
   * before anything is computed; a mismatch throws rather than warns (§4.1).
   */
  framework: FrameworkBinding;
  course_outcomes: CourseOutcomeInput[];
  outcomes: OutcomeInput[];
  articulation: ArticulationInput[];
  wk_indicators?: WkIndicatorInput[];
  co_wk_map?: CoWkMapInput[];
  assessment_groups?: AssessmentGroupInput[];
  assessments: AssessmentInput[];
  questions: QuestionInput[];
  question_outcomes: QuestionOutcomeInput[];
  choice_groups?: ChoiceGroupInput[];
  enrollments: EnrollmentInput[];
  marks: MarkInput[];
  assessment_totals?: AssessmentTotalInput[];
  see_blueprint?: SeeBlueprintInput;
  survey?: SurveyInput;
  overrides?: OverrideInput[];
}

// ---------------------------------------------------------------------------
// Trace (spec §6.8) — P3, every number resolves to raw marks rows
// ---------------------------------------------------------------------------

export interface ContributingAssessment {
  assessment_id: string;
  name: string;
  kind: AssessmentKind;
  /** Normalised weight actually applied, after group resolution and best-N selection. */
  weight: number;
  questions: string[];
  /** Excluded by best-N selection rather than absent from the blueprint. */
  dropped_by_best_n?: boolean;
}

export interface CohortTrace {
  considered: number;
  excluded: number;
  exclusion_reasons: Record<string, number>;
}

export interface CoTrace {
  formula: string;
  /** `code/version`, e.g. `nba-ug-eng/gapc-v4.0` — a value is only readable against its framework. */
  framework: string;
  inputs: Record<string, unknown>;
  cohort: CohortTrace;
  crossed?: number;
  ratio?: number;
  mean_pct?: number;
  level?: number;
  contributing_assessments: ContributingAssessment[];
  /** Per-student CO percentages, the layer above raw marks. Sorted by roll number so the
   *  trace is stable across runs. */
  students: StudentCoTrace[];
  /** Opaque handle the UI turns into a drill-down route. */
  drilldown_query: string;
}

export interface StudentCoTrace {
  enrollment_id: string;
  roll_no: string;
  /** Undefined when the CO could not be measured for this student (maximum = 0). */
  pct?: number;
  obtained: number;
  maximum: number;
  crossed?: boolean;
  excluded_reason?: string;
  per_assessment: {
    assessment_id: string;
    obtained: number;
    maximum: number;
    pct?: number;
    /** The individual answers behind the numbers — the bottom of the drill-down. */
    questions: {
      question_id: string;
      label: string;
      score: number;
      max_marks: number;
      weight: number;
      attempted: boolean;
    }[];
  }[];
}

export interface PoTrace {
  formula: string;
  framework: string;
  inputs: Record<string, unknown>;
  contributions: {
    course_outcome_id: string;
    code: string;
    correlation: number;
    final_value: number;
    /** The CO's share of this PO's value, after the method is applied. */
    weighted_value: number;
  }[];
  drilldown_query: string;
}

// ---------------------------------------------------------------------------
// Engine output
// ---------------------------------------------------------------------------

/**
 * What one instrument reached for one outcome, before the instruments were combined.
 *
 * Reported whatever the combination, because it is the line an evaluator asks about: "your
 * end-semester result for CO3 is 2, your assignment is 3 — how did you get 2.4?" Under
 * `component_levels` these are the numbers actually averaged; under the others they are
 * diagnostic, and they cost nothing to compute.
 */
export interface ComponentLevel {
  component_key: string;
  name: string;
  kind: 'cie' | 'see';
  /** The weight used for *this* outcome, which may differ from the component's scalar. */
  weight: number;
  /** The bar this instrument was measured against — its own where it has one. */
  target_pct: number;
  students: number;
  /** Undefined when nothing was measurable for this outcome in this instrument. */
  level?: number;
}

export interface CoAttainment {
  course_outcome_id: string;
  code: string;
  /** Direct attainment on `policy.scale`. Undefined when nothing could be computed. */
  direct_value?: number;
  indirect_value?: number;
  final_value?: number;
  /** Banded level; equals the value when `scale.kind === 'percentage'`. */
  level?: number;
  students_considered: number;
  students_crossed?: number;
  /** WK indicator codes mapped to this CO — the third column of the SAR CO-PO-WK table. */
  wk_codes?: string[];
  /** Present only under `combination: split`. */
  direct_cie?: number;
  direct_see?: number;
  /** Per-instrument levels and the per-outcome weight each carried. */
  component_levels?: ComponentLevel[];
  overridden?: { value: number; original?: number; reason: string; author_id: string };
  trace: CoTrace;
  warnings: EngineWarning[];
}

export interface PoAttainment {
  outcome_id: string;
  code: string;
  kind: OutcomeKind;
  value?: number;
  level?: number;
  method: PolicyPo['method'];
  trace: PoTrace;
  warnings: EngineWarning[];
}

export interface EngineContext {
  /** Passed in, never read from the clock — the engine is pure (P4). */
  computed_at: string;
  computed_by?: string;
  run_id?: string;
}

export interface EngineResult {
  engine_version: string;
  policy_id: string;
  policy_version: string;
  /** Pinned alongside the policy version — a run is only reproducible against both (P5). */
  framework: FrameworkBinding;
  /** Hash of the canonicalised input; recomputation with the same hash must be identical. */
  input_hash: string;
  computed_at: string;
  computed_by?: string;
  run_id?: string;
  offering_id: string;
  scale: PolicyScale;
  see_mode: SeeMode;
  /** Report stamps: fallbacks used, grade-derived components, small cohort (P6). */
  stamps: string[];
  cohort_summary: CohortTrace;
  co_attainments: CoAttainment[];
  po_attainments: PoAttainment[];
  warnings: EngineWarning[];
}

// ---------------------------------------------------------------------------
// Program rollup (spec §6.7)
// ---------------------------------------------------------------------------

export interface ProgramCourseResult {
  offering_id: string;
  course_id: string;
  course_code: string;
  credits: number;
  po_attainments: PoAttainment[];
}

export interface ProgramIndirectInput {
  kind: string;
  /** Already reduced to the attainment scale, per outcome code. */
  values: Record<string, number>;
}

export interface ProgramInput {
  program_id: string;
  regulation_id?: string;
  term_id?: string;
  /**
   * All courses in one rollup must share this framework. A program spanning the v3→v4
   * cutover produces *two* rollups rendered as two series — never one blended number
   * across 12-PO and 11-PO terms (§12.21).
   */
  framework: FrameworkBinding;
  outcomes: OutcomeInput[];
  courses: ProgramCourseResult[];
  indirect?: ProgramIndirectInput[];
}

export interface ProgramOutcomeAttainment {
  outcome_id: string;
  code: string;
  kind: OutcomeKind;
  direct_value?: number;
  indirect_value?: number;
  final_value?: number;
  target_value: number;
  /** target − final. Positive means a shortfall that must open an action plan (§6.7). */
  gap?: number;
  requires_action_plan: boolean;
  trace: {
    formula: string;
    inputs: Record<string, unknown>;
    contributions: {
      offering_id: string;
      course_code: string;
      weight: number;
      value: number;
    }[];
    indirect_contributions?: { kind: string; weight: number; value: number }[];
    drilldown_query: string;
  };
  warnings: EngineWarning[];
}

export interface ProgramResult {
  engine_version: string;
  policy_id: string;
  policy_version: string;
  framework: FrameworkBinding;
  input_hash: string;
  computed_at: string;
  program_id: string;
  regulation_id?: string;
  term_id?: string;
  scale: PolicyScale;
  stamps: string[];
  outcomes: ProgramOutcomeAttainment[];
  warnings: EngineWarning[];
}
