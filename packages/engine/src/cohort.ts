/**
 * Cohort rules — who is in the denominator (spec §4.10).
 *
 * These decisions move the numbers more than any formula does. Whether an absentee counts
 * as zero or is dropped from the denominator can swing a CO by a whole level, so every
 * exclusion is counted and named in the trace rather than quietly applied.
 */

import type { EnrollmentInput, MarkStatus, PolicyCohort, CohortTrace } from './types.js';

export type ExclusionReason =
  | 'dropped'
  | 'audit'
  | 'backlog'
  | 'absent'
  | 'malpractice'
  | 'exempt'
  | 'no_data';

export interface CohortSelection {
  /** Enrollments that participate in attainment at all. */
  considered: EnrollmentInput[];
  /** Excluded enrollment id → why. */
  excluded: Map<string, ExclusionReason>;
  reasons: Record<string, number>;
}

/**
 * Apply enrollment-level cohort rules.
 *
 * Assessment-level status (absent, malpractice) is handled later, per CO, because a student
 * absent for one assessment is still part of the cohort for the others (§12.3).
 */
export function selectCohort(
  enrollments: EnrollmentInput[],
  policy: PolicyCohort,
): CohortSelection {
  const considered: EnrollmentInput[] = [];
  const excluded = new Map<string, ExclusionReason>();

  for (const e of enrollments) {
    const reason = enrollmentExclusion(e, policy);
    if (reason) excluded.set(e.id, reason);
    else considered.push(e);
  }

  return { considered, excluded, reasons: tally(excluded.values()) };
}

function enrollmentExclusion(
  e: EnrollmentInput,
  policy: PolicyCohort,
): ExclusionReason | undefined {
  switch (e.status) {
    case 'dropped':
      // §12.4 — a student who left mid-term is not evidence of anything either way.
      return policy.dropped_handling === 'exclude' ? 'dropped' : undefined;
    case 'audit':
      // §12.5 — auditing carries no assessment obligation.
      return policy.include_audit_students ? undefined : 'audit';
    case 'backlog':
      // §12.6 — repeat students sitting with the current cohort. Configurable because
      // institutions genuinely disagree about whether they belong in this term's evidence.
      return policy.include_backlog_students ? undefined : 'backlog';
    case 'active':
    case 'transfer':
      return undefined;
  }
}

/**
 * How one assessment-level status affects a student's contribution to a CO.
 *
 * `count_zero` means the student stays in the denominator with a score of zero;
 * `skip` drops just this assessment, leaving their other assessments intact;
 * `use` is the ordinary path.
 */
export type StatusEffect = 'use' | 'skip' | 'count_zero';

export function statusEffect(
  status: MarkStatus | undefined,
  policy: PolicyCohort,
): StatusEffect {
  switch (status) {
    case undefined:
    case 'present':
      return 'use';
    case 'absent':
      return policy.absent_handling === 'zero' ? 'count_zero' : 'skip';
    case 'malpractice':
      // §12.7 — a malpractice score is void, not zero. Scoring it zero would assert the
      // student demonstrated nothing, which is a different claim from "this is not evidence".
      return policy.malpractice_handling === 'zero' ? 'count_zero' : 'skip';
    case 'exempt':
      // Fed by the Attendance Portal's detention status (§17).
      return 'skip';
    case 'not_attempted':
      return 'skip';
  }
}

export function reasonForStatus(status: MarkStatus | undefined): ExclusionReason {
  switch (status) {
    case 'absent':
      return 'absent';
    case 'malpractice':
      return 'malpractice';
    case 'exempt':
      return 'exempt';
    default:
      return 'no_data';
  }
}

export function tally(reasons: Iterable<ExclusionReason>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reasons) out[r] = (out[r] ?? 0) + 1;
  return out;
}

export function toCohortTrace(considered: number, reasons: Record<string, number>): CohortTrace {
  const excluded = Object.values(reasons).reduce((a, b) => a + b, 0);
  return { considered, excluded, exclusion_reasons: reasons };
}
