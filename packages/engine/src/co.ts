/**
 * Per-student CO percentages (spec §6.1–6.2).
 *
 * This is the layer everything else sits on, and it contains the two computations the spec
 * singles out as the ones most tools get wrong. Both are marked below. If you change this
 * file, re-read §6.1 and run `co.choice.test.ts` and `co.best-n.test.ts` before believing
 * anything.
 */

import {
  reasonForStatus,
  statusEffect,
  type ExclusionReason,
} from './cohort.js';
import type {
  AssessmentInput,
  AssessmentKind,
  ChoiceGroupInput,
  EngineInput,
  MarkInput,
  PolicyDocument,
  QuestionInput,
} from './types.js';
import { WarningLog } from './warnings.js';

/** Which side of the CIE/SEE divide an assessment falls on. */
export type ComponentKind = 'cie' | 'see';

export interface QuestionMeasure {
  question_id: string;
  label: string;
  score: number;
  max_marks: number;
  /** The question→CO weight `w(q,c)` — 1.0 for a single mapping, split when shared. */
  weight: number;
  attempted: boolean;
}

export interface AssessmentCoMeasure {
  assessment_id: string;
  obtained: number;
  maximum: number;
  /** Undefined when `maximum` is 0 — the CO was not measurable for this student here. */
  pct?: number;
  questions: QuestionMeasure[];
  /** Set when the student was absent/malpractice and the policy said to skip. */
  skipped_reason?: ExclusionReason;
}

/** A weighted contributor to the course-level percentage: a lone assessment, or a group. */
export interface Component {
  key: string;
  name: string;
  kind: ComponentKind;
  weight: number;
  members: AssessmentInput[];
  selection: { rule: 'all' | 'best_n'; n: number };
}

export interface ComponentMeasure {
  component: Component;
  pct?: number;
  members: (AssessmentCoMeasure & { selected: boolean; dropped_by_best_n: boolean })[];
}

export interface StudentCoResult {
  pct?: number;
  pct_cie?: number;
  pct_see?: number;
  components: ComponentMeasure[];
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

export interface OfferingIndex {
  assessments: Map<string, AssessmentInput>;
  /** Leaf questions only — parents are containers whose marks live on their children. */
  leavesByAssessment: Map<string, QuestionInput[]>;
  questionById: Map<string, QuestionInput>;
  /** question id → [{ co, weight }] */
  outcomeWeights: Map<string, { course_outcome_id: string; weight: number }[]>;
  /** `${enrollment_id}|${question_id}` → mark */
  marks: Map<string, MarkInput>;
  /** `${enrollment_id}|${assessment_id}` → status derived from that assessment's marks */
  assessmentStatus: Map<string, MarkInput['status']>;
  choiceGroups: Map<string, ChoiceGroupInput>;
  /** assessment id → choice group id → alternatives, ordered by sequence */
  choiceAlternatives: Map<string, Map<string, QuestionInput[]>>;
}

const markKey = (e: string, q: string) => `${e}|${q}`;

export function buildIndex(input: EngineInput, warnings: WarningLog): OfferingIndex {
  const assessments = new Map(input.assessments.map((a) => [a.id, a]));
  const questionById = new Map(input.questions.map((q) => [q.id, q]));

  const hasChildren = new Set<string>();
  for (const q of input.questions) if (q.parent_id) hasChildren.add(q.parent_id);

  const leavesByAssessment = new Map<string, QuestionInput[]>();
  for (const q of input.questions) {
    if (hasChildren.has(q.id)) continue; // a container, e.g. Q5 holding 5(a) and 5(b)
    const list = leavesByAssessment.get(q.assessment_id) ?? [];
    list.push(q);
    leavesByAssessment.set(q.assessment_id, list);
  }
  for (const list of leavesByAssessment.values()) {
    list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.label.localeCompare(b.label));
  }

  const outcomeWeights = new Map<string, { course_outcome_id: string; weight: number }[]>();
  for (const qo of input.question_outcomes) {
    const list = outcomeWeights.get(qo.question_id) ?? [];
    list.push({ course_outcome_id: qo.course_outcome_id, weight: qo.weight });
    outcomeWeights.set(qo.question_id, list);
  }
  for (const [qid, list] of outcomeWeights) {
    const total = list.reduce((a, b) => a + b.weight, 0);
    if (list.length > 0 && Math.abs(total - 1) > 1e-9) {
      warnings.push(
        'QUESTION_WEIGHTS_NOT_NORMALISED',
        `Question ${questionById.get(qid)?.label ?? qid} has CO weights summing to ${total.toFixed(3)}, not 1.`,
        { question_id: qid },
        { total },
      );
    }
  }

  const marks = new Map<string, MarkInput>();
  const assessmentStatus = new Map<string, MarkInput['status']>();
  for (const m of input.marks) {
    marks.set(markKey(m.enrollment_id, m.question_id), m);
    const q = questionById.get(m.question_id);
    if (!q) continue;
    if (m.score > q.max_marks) {
      warnings.push(
        'SCORE_EXCEEDS_MAX',
        `Score ${m.score} exceeds the ${q.max_marks} maximum for ${q.label}.`,
        { question_id: q.id, enrollment_id: m.enrollment_id },
      );
    }
    // A non-present status applies to the whole assessment, not one question: a student is
    // absent for a paper, not for Q3.
    if (m.status && m.status !== 'present') {
      assessmentStatus.set(markKey(m.enrollment_id, q.assessment_id), m.status);
    }
  }
  for (const t of input.assessment_totals ?? []) {
    if (t.status && t.status !== 'present') {
      assessmentStatus.set(markKey(t.enrollment_id, t.assessment_id), t.status);
    }
  }

  const choiceGroups = new Map((input.choice_groups ?? []).map((c) => [c.id, c]));
  const choiceAlternatives = new Map<string, Map<string, QuestionInput[]>>();
  for (const [aid, leaves] of leavesByAssessment) {
    const byGroup = new Map<string, QuestionInput[]>();
    for (const q of leaves) {
      if (!q.choice_group) continue;
      const list = byGroup.get(q.choice_group) ?? [];
      list.push(q);
      byGroup.set(q.choice_group, list);
    }
    if (byGroup.size > 0) choiceAlternatives.set(aid, byGroup);
  }

  return {
    assessments,
    leavesByAssessment,
    questionById,
    outcomeWeights,
    marks,
    assessmentStatus,
    choiceGroups,
    choiceAlternatives,
  };
}

export function weightFor(index: OfferingIndex, questionId: string, coId: string): number {
  const list = index.outcomeWeights.get(questionId);
  if (!list) return 0;
  let w = 0;
  for (const entry of list) if (entry.course_outcome_id === coId) w += entry.weight;
  return w;
}

// ---------------------------------------------------------------------------
// §6.1 — one student, one CO, one assessment
// ---------------------------------------------------------------------------

/**
 * ```
 * obtained(s,c,a) = Σ_{q ∈ attempted(s,a)}  score(s,q) · w(q,c)
 * maximum(s,c,a)  = Σ_{q ∈ attempted(s,a)}  maxmarks(q) · w(q,c)
 * ```
 *
 * ⚠️ **The choice-question detail.** Both sums run over *attempted* questions only. A
 * student who answered Q5 (CO2) and one who answered Q6 (CO3) are each measured against
 * their own denominator, which is the whole point — a class-wide denominator would charge
 * every student for questions they were never required to answer. This is the single
 * difference between a defensible number and a wrong one (§6.1, §12.1).
 */
export function measureQuestionWise(
  index: OfferingIndex,
  policy: PolicyDocument,
  enrollmentId: string,
  coId: string,
  assessmentId: string,
): AssessmentCoMeasure {
  const leaves = index.leavesByAssessment.get(assessmentId) ?? [];
  const status = index.assessmentStatus.get(markKey(enrollmentId, assessmentId));
  const effect = statusEffect(status, policy.cohort);

  if (effect === 'skip') {
    return {
      assessment_id: assessmentId,
      obtained: 0,
      maximum: 0,
      questions: [],
      skipped_reason: reasonForStatus(status),
    };
  }

  // `count_zero`: the student stays in the denominator scoring nothing. The denominator is
  // the nominal paper — a student who never sat the exam has no attempted set of their own.
  const countZero = effect === 'count_zero';
  const pool = countZero ? nominalPaper(index, assessmentId) : leaves;

  let obtained = 0;
  let maximum = 0;
  const questions: QuestionMeasure[] = [];

  for (const q of pool) {
    const w = weightFor(index, q.id, coId);
    if (w <= 0) continue;

    const mark = index.marks.get(markKey(enrollmentId, q.id));
    const attempted = countZero ? true : (mark?.attempted ?? false);
    if (!attempted) continue;

    const score = countZero ? 0 : (mark?.score ?? 0);
    obtained += score * w;
    maximum += q.max_marks * w;
    questions.push({
      question_id: q.id,
      label: q.label,
      score,
      max_marks: q.max_marks,
      weight: w,
      attempted: true,
    });
  }

  const measure: AssessmentCoMeasure = {
    assessment_id: assessmentId,
    obtained,
    maximum,
    questions,
  };
  if (maximum > 0) measure.pct = obtained / maximum;
  return measure;
}

/**
 * The paper a student *would* have faced: every compulsory leaf, plus the first `required`
 * alternatives of each choice group.
 *
 * Only used for `absent_handling: zero`, where there is no attempted set to work from. The
 * choice of "first by sequence" is arbitrary but deterministic and documented — any rule
 * here is a convention, and a stated convention beats a hidden one.
 */
function nominalPaper(index: OfferingIndex, assessmentId: string): QuestionInput[] {
  const leaves = index.leavesByAssessment.get(assessmentId) ?? [];
  const groups = index.choiceAlternatives.get(assessmentId);
  if (!groups || groups.size === 0) return leaves.filter((q) => !q.is_optional);

  const keep: QuestionInput[] = leaves.filter((q) => !q.choice_group && !q.is_optional);
  for (const [groupId, alternatives] of groups) {
    const required = index.choiceGroups.get(groupId)?.required ?? alternatives.length;
    keep.push(...alternatives.slice(0, required));
  }
  return keep;
}

// ---------------------------------------------------------------------------
// §6.2 — one student, one CO, the whole course
// ---------------------------------------------------------------------------

export function classifyAssessment(kind: AssessmentKind): ComponentKind {
  return kind === 'see' ? 'see' : 'cie';
}

/** Group assessments into weighted components, honouring group selection rules. */
export function resolveComponents(
  input: EngineInput,
  policy: PolicyDocument,
  warnings: WarningLog,
): Component[] {
  const groups = new Map((input.assessment_groups ?? []).map((g) => [g.id, g]));
  const membersByGroup = new Map<string, AssessmentInput[]>();
  const standalone: AssessmentInput[] = [];

  for (const a of input.assessments) {
    if (a.group_id && groups.has(a.group_id)) {
      const list = membersByGroup.get(a.group_id) ?? [];
      list.push(a);
      membersByGroup.set(a.group_id, list);
    } else {
      standalone.push(a);
    }
  }

  const components: Component[] = [];

  for (const a of standalone) {
    components.push({
      key: a.id,
      name: a.name,
      kind: classifyAssessment(a.kind),
      weight: a.weight_pct,
      members: [a],
      selection: { rule: 'all', n: 1 },
    });
  }

  for (const [groupId, group] of groups) {
    const members = membersByGroup.get(groupId) ?? [];
    if (members.length === 0) continue;

    const kinds = new Set(members.map((m) => classifyAssessment(m.kind)));
    if (kinds.size > 1) {
      warnings.push(
        'MIXED_GROUP_KIND',
        `Assessment group "${group.name}" mixes internal and end-semester assessments; ` +
          `treating the whole group as ${classifyAssessment(members[0]!.kind)}.`,
        undefined,
        { group_id: groupId },
      );
    }

    const rule = group.selection_rule ?? policy.assessment_groups.default_selection_rule;
    const n = group.n ?? members.length;
    if (rule === 'best_n' && n > members.length) {
      warnings.push(
        'BEST_N_UNDERFILLED',
        `Group "${group.name}" selects the best ${n} but only has ${members.length} assessments.`,
        undefined,
        { group_id: groupId, n, available: members.length },
      );
    }

    components.push({
      key: groupId,
      name: group.name,
      kind: classifyAssessment(members[0]!.kind),
      weight: group.weight_pct,
      members,
      selection: { rule, n: Math.min(n, members.length) },
    });
  }

  return components.sort((a, b) => a.key.localeCompare(b.key));
}

export type MeasureFn = (
  enrollmentId: string,
  coId: string,
  assessmentId: string,
) => AssessmentCoMeasure;

/**
 * ```
 * pct(s,c) = Σ_a W(a)·pct(s,c,a) / Σ_a W(a)     over assessments where pct is defined
 * ```
 *
 * ⚠️ **The best-of-N detail.** Selection runs *inside this function*, which is called once
 * per (student, CO). So "best two of three quizzes" can keep a different two for CO1 than
 * for CO3 — a student may have done well on the CO1 questions of quiz 1 and the CO3
 * questions of quiz 2. Hoisting the selection out to a per-student decision would be
 * cheaper and wrong (§12.8).
 */
export function computeStudentCo(
  components: Component[],
  policy: PolicyDocument,
  enrollmentId: string,
  coId: string,
  measure: MeasureFn,
): StudentCoResult {
  const measured: ComponentMeasure[] = [];

  for (const component of components) {
    const raw = component.members.map((m) => measure(enrollmentId, coId, m.id));
    const defined = raw.filter((r) => r.pct !== undefined);

    let selected = defined;
    const droppedIds = new Set<string>();

    if (component.selection.rule === 'best_n' && defined.length > component.selection.n) {
      const order = [...defined];
      const tieRule = policy.assessment_groups.best_n_ties;
      order.sort((a, b) => {
        const diff = (b.pct ?? 0) - (a.pct ?? 0);
        if (Math.abs(diff) > 1e-12) return diff;
        // Deterministic tie-break: 'first' favours the earlier assessment.
        const ia = defined.indexOf(a);
        const ib = defined.indexOf(b);
        return tieRule === 'first' ? ia - ib : ib - ia;
      });
      selected = order.slice(0, component.selection.n);
      for (const d of order.slice(component.selection.n)) droppedIds.add(d.assessment_id);
    }

    const weightOf = (assessmentId: string) =>
      component.members.find((m) => m.id === assessmentId)?.weight_pct ?? 0;

    let num = 0;
    let den = 0;
    for (const s of selected) {
      // Members carrying no explicit weight share the component equally.
      const w = weightOf(s.assessment_id) || 1;
      num += w * (s.pct ?? 0);
      den += w;
    }

    const cm: ComponentMeasure = {
      component,
      members: raw.map((r) => ({
        ...r,
        selected: selected.includes(r),
        dropped_by_best_n: droppedIds.has(r.assessment_id),
      })),
    };
    if (den > 0) cm.pct = num / den;
    measured.push(cm);
  }

  const blend = (subset: ComponentMeasure[]): number | undefined => {
    let num = 0;
    let den = 0;
    for (const c of subset) {
      if (c.pct === undefined) continue;
      num += c.component.weight * c.pct;
      den += c.component.weight;
    }
    return den > 0 ? num / den : undefined;
  };

  const result: StudentCoResult = { components: measured };

  if (policy.direct.combination === 'split') {
    // CIE and SEE are banded independently and blended at the level stage (§6.3).
    result.pct_cie = blend(measured.filter((c) => c.component.kind === 'cie'));
    result.pct_see = blend(measured.filter((c) => c.component.kind === 'see'));
    result.pct = blend(measured);
  } else {
    result.pct = blend(measured);
  }

  return result;
}
