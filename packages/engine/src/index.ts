/**
 * @attainment/engine — the pure attainment engine.
 *
 * Plain documents in, a plain result document out. No database, no filesystem, no clock.
 * Everything the spec calls a rule lives in the policy document; this package interprets it.
 *
 * ```ts
 * const result = computeOffering(input, policy, { computed_at: '2026-07-28T00:00:00Z' });
 * ```
 */

export { computeOffering } from './compute.js';
export { computeProgram, computeCoursePo, assertFrameworkMatch, frameworkLabel } from './po.js';

export { resolvePolicy, stripComments, type PolicyLayers } from './policy/resolve.js';
export { validatePolicy, assertValidPolicy } from './policy/validate.js';

export { computeInputHash, hashDocument, canonicalise } from './hash.js';
export { ENGINE_VERSION } from './version.js';

export { FrameworkMismatchError, InvalidInputError, InvalidPolicyError } from './errors.js';

export {
  WarningLog,
  SEE_MODE_STAMP,
  warn,
  type EngineWarning,
  type WarningCode,
  type WarningSeverity,
} from './warnings.js';

// Lower-level pieces, exported so the verifier (§19) and the web app's drill-down can reuse
// the same arithmetic rather than reimplementing it.
export {
  band,
  clampToScale,
  computeLevel,
  linearScaleToLevel,
  roundTo,
  type LevelComputation,
} from './level.js';
export {
  selectCohort,
  statusEffect,
  toCohortTrace,
  type CohortSelection,
  type ExclusionReason,
} from './cohort.js';
export {
  buildIndex,
  computeStudentCo,
  measureQuestionWise,
  resolveComponents,
  weightFor,
  type AssessmentCoMeasure,
  type Component,
  type ComponentKind,
  type ComponentMeasure,
  type MeasureFn,
  type OfferingIndex,
  type StudentCoResult,
} from './co.js';
export { resolveSee, effectiveSeeMode, type SeeResolution } from './see.js';
export { computeIndirect, type IndirectResult } from './indirect.js';

export type * from './types.js';
