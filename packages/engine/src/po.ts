/**
 * CO → PO for one course (spec §6.6) and the program-level rollup (§6.7).
 *
 * The rollup is where accreditation is actually graded: a gap against target must open an
 * action plan, and the report is not exportable as complete until it has one.
 */

import { FrameworkMismatchError } from './errors.js';
import { clampToScale } from './level.js';
import type {
  ArticulationInput,
  CoAttainment,
  EngineContext,
  FrameworkBinding,
  OutcomeInput,
  PoAttainment,
  PolicyDocument,
  ProgramInput,
  ProgramOutcomeAttainment,
  ProgramResult,
} from './types.js';
import { computeInputHash } from './hash.js';
import { ENGINE_VERSION } from './version.js';
import { WarningLog } from './warnings.js';

export const frameworkLabel = (f: FrameworkBinding) => `${f.code}/${f.version}`;

/**
 * ```
 * PO(k,p) = Σ_{c: corr(c,p) > 0} final(c)·corr(c,p) / Σ_{c: corr(c,p) > 0} corr(c,p)
 * ```
 *
 * `scaled` multiplies each contribution by `corr/max_corr` first, which yields a lower and
 * more conservative number — a CO correlated 1 to a PO drags it down rather than counting
 * fully. `max` takes the strongest contributing CO. Both are in real use; which is right is
 * an institutional decision, so it is policy (§4.8).
 */
export function computeCoursePo(
  coAttainments: CoAttainment[],
  articulation: ArticulationInput[],
  outcomes: OutcomeInput[],
  policy: PolicyDocument,
  framework: FrameworkBinding,
  warnings: WarningLog,
  runId?: string,
): PoAttainment[] {
  const finalByCo = new Map<string, number>();
  const codeByCo = new Map<string, string>();
  for (const co of coAttainments) {
    if (co.final_value !== undefined) finalByCo.set(co.course_outcome_id, co.final_value);
    codeByCo.set(co.course_outcome_id, co.code);
  }

  const maxCorr = policy.po.correlation_scale.max || 1;
  const out: PoAttainment[] = [];

  for (const outcome of outcomes) {
    const cells = articulation.filter(
      (a) =>
        a.outcome_id === outcome.id &&
        a.correlation > 0 &&
        a.correlation >= policy.po.ignore_correlation_below,
    );

    const trace: PoAttainment['trace'] = {
      formula: policy.po.method,
      framework: frameworkLabel(framework),
      inputs: {
        method: policy.po.method,
        correlation_scale: policy.po.correlation_scale,
        ignore_correlation_below: policy.po.ignore_correlation_below,
      },
      contributions: [],
      drilldown_query: `po_attainment:run=${runId ?? ''}:outcome=${outcome.id}`,
    };

    const contributing = cells
      .map((cell) => ({ cell, final: finalByCo.get(cell.course_outcome_id) }))
      .filter((c): c is { cell: ArticulationInput; final: number } => c.final !== undefined);

    // No PO_UNMAPPED warning here, deliberately. A single course is not supposed to address
    // all eleven POs — most address four or five — so warning per course would fire half a
    // dozen times on every report and train everyone to ignore the warnings panel. §12.10 is
    // about a PO unmapped across an *entire program*, and that check lives in
    // `computeProgram`. The course-level checks are the reverse direction (§10.3): a CO that
    // maps to no PO, and a CO that maps to implausibly many.

    let value: number | undefined;

    if (contributing.length > 0) {
      if (policy.po.method === 'max') {
        value = Math.max(...contributing.map((c) => c.final));
        for (const c of contributing) {
          trace.contributions.push({
            course_outcome_id: c.cell.course_outcome_id,
            code: codeByCo.get(c.cell.course_outcome_id) ?? '',
            correlation: c.cell.correlation,
            final_value: c.final,
            weighted_value: c.final,
          });
        }
      } else {
        let num = 0;
        let den = 0;
        for (const c of contributing) {
          const adjusted =
            policy.po.method === 'scaled' ? c.final * (c.cell.correlation / maxCorr) : c.final;
          num += adjusted * c.cell.correlation;
          den += c.cell.correlation;
          trace.contributions.push({
            course_outcome_id: c.cell.course_outcome_id,
            code: codeByCo.get(c.cell.course_outcome_id) ?? '',
            correlation: c.cell.correlation,
            final_value: c.final,
            weighted_value: adjusted,
          });
        }
        value = den > 0 ? num / den : undefined;
      }
    }

    trace.contributions.sort((a, b) => a.code.localeCompare(b.code));

    const po: PoAttainment = {
      outcome_id: outcome.id,
      code: outcome.code,
      kind: outcome.kind,
      method: policy.po.method,
      trace,
      warnings: warnings.all().filter((w) => w.subject?.outcome_id === outcome.id),
    };
    if (value !== undefined) {
      po.value = clampToScale(value, policy.scale);
      po.level = po.value;
    }
    out.push(po);
  }

  return out.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

/**
 * Program-level rollup (§6.7).
 *
 * ```
 * direct_PO(p) = Σ_k PO(k,p)·cw(k) / Σ_k cw(k)      cw = 1 or credits
 * final_PO(p)  = wd'·direct_PO(p) + wi'·indirect_PO(p)
 * gap(p)       = target(p) − final_PO(p)
 * ```
 *
 * Every course in one rollup must share a framework version. A program spanning the v3→v4
 * cutover produces two rollups rendered as two series — averaging a 12-PO term with an
 * 11-PO term would produce a number describing no framework at all (§12.21).
 */
export function computeProgram(
  input: ProgramInput,
  policy: PolicyDocument,
  ctx: EngineContext,
): ProgramResult {
  assertFrameworkMatch(policy, input.framework, { program_id: input.program_id });

  const warnings = new WarningLog();
  const label = frameworkLabel(input.framework);

  const knownCodes = new Set(input.outcomes.map((o) => o.code));
  for (const code of Object.keys(policy.program.targets_by_outcome ?? {})) {
    if (!knownCodes.has(code)) {
      // A PO12 target left behind after the move to the 11-PO set is a policy that has not
      // been migrated, and quietly ignoring it hides that.
      warnings.push(
        'TARGET_OUTCOME_UNKNOWN',
        `policy.program.targets_by_outcome names ${code}, which ${label} does not define.`,
        { outcome_code: code },
        { framework: label },
      );
    }
  }

  const indirectByCode = new Map<string, { value: number; sources: { kind: string; weight: number; value: number }[] }>();
  if (input.indirect && input.indirect.length > 0) {
    const weights = new Map(policy.program.indirect_sources.map((s) => [s.kind, s.weight]));
    for (const outcome of input.outcomes) {
      let num = 0;
      let den = 0;
      const sources: { kind: string; weight: number; value: number }[] = [];
      for (const src of input.indirect) {
        const v = src.values[outcome.code];
        if (v === undefined) continue;
        const w = weights.get(src.kind) ?? 0;
        if (w <= 0) continue;
        num += w * v;
        den += w;
        sources.push({ kind: src.kind, weight: w, value: v });
      }
      if (den > 0) indirectByCode.set(outcome.code, { value: num / den, sources });
    }
  }

  const outcomes: ProgramOutcomeAttainment[] = input.outcomes.map((outcome) => {
    const contributions: { offering_id: string; course_code: string; weight: number; value: number }[] = [];

    let num = 0;
    let den = 0;
    for (const course of input.courses) {
      const po = course.po_attainments.find((p) => p.outcome_id === outcome.id);
      if (!po || po.value === undefined) continue;
      const weight = policy.program.course_weighting === 'credits' ? course.credits : 1;
      if (weight <= 0) continue;
      num += weight * po.value;
      den += weight;
      contributions.push({
        offering_id: course.offering_id,
        course_code: course.course_code,
        weight,
        value: po.value,
      });
    }
    contributions.sort((a, b) => a.course_code.localeCompare(b.course_code));

    const direct = den > 0 ? num / den : undefined;
    const indirect = indirectByCode.get(outcome.code);
    const target = policy.program.targets_by_outcome?.[outcome.code] ?? policy.program.default_target;

    let final: number | undefined;
    if (direct !== undefined && indirect !== undefined) {
      final = policy.program.weights.direct * direct + policy.program.weights.indirect * indirect.value;
    } else if (direct !== undefined) {
      final = direct;
    } else if (indirect !== undefined) {
      final = indirect.value;
    }

    const entry: ProgramOutcomeAttainment = {
      outcome_id: outcome.id,
      code: outcome.code,
      kind: outcome.kind,
      target_value: target,
      requires_action_plan: false,
      trace: {
        formula: 'program_rollup',
        inputs: {
          framework: label,
          course_weighting: policy.program.course_weighting,
          weights: policy.program.weights,
          target,
        },
        contributions,
        drilldown_query: `program_attainment:program=${input.program_id}:outcome=${outcome.id}`,
      },
      warnings: [],
    };

    if (direct !== undefined) entry.direct_value = clampToScale(direct, policy.scale);
    if (indirect !== undefined) {
      entry.indirect_value = clampToScale(indirect.value, policy.scale);
      entry.trace.indirect_contributions = indirect.sources;
    }
    if (final !== undefined) {
      entry.final_value = clampToScale(final, policy.scale);
      const gap = target - entry.final_value;
      entry.gap = gap;
      if (gap > policy.program.require_action_plan_when_gap_above) {
        entry.requires_action_plan = true;
        warnings.push(
          'GAP_REQUIRES_ACTION',
          `${outcome.code} attained ${entry.final_value.toFixed(2)} against a target of ${target.toFixed(2)}. ` +
            `An action plan is required before this report can be exported as complete.`,
          { outcome_id: outcome.id, outcome_code: outcome.code },
          { gap, target, attained: entry.final_value },
        );
      }
    } else {
      warnings.push(
        'PO_UNMAPPED',
        `${outcome.code} could not be computed at program level — no course contributed a value.`,
        { outcome_id: outcome.id, outcome_code: outcome.code },
      );
    }

    entry.warnings = warnings.all().filter((w) => w.subject?.outcome_id === outcome.id);
    return entry;
  });

  const stamps: string[] = [];
  if (policy.reporting.stamp_framework_version !== false) stamps.push(`Framework: ${label}`);

  const result: ProgramResult = {
    engine_version: ENGINE_VERSION,
    policy_id: policy.id,
    policy_version: policy.version,
    framework: input.framework,
    input_hash: computeInputHash(input, policy, input.framework),
    computed_at: ctx.computed_at,
    program_id: input.program_id,
    scale: policy.scale,
    stamps,
    outcomes: outcomes.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    warnings: warnings.all(),
  };
  if (input.regulation_id) result.regulation_id = input.regulation_id;
  if (input.term_id) result.term_id = input.term_id;
  return result;
}

/**
 * The guard from §4.1, applied before anything is computed.
 *
 * Fatal by design — see `FrameworkMismatchError`. A 12-PO number presented for a post-2025
 * submission is invalid rather than imprecise, and a warning on a report gets ignored.
 */
export function assertFrameworkMatch(
  policy: PolicyDocument,
  actual: FrameworkBinding,
  context?: { offering_id?: string; program_id?: string },
): void {
  const expected = policy.framework;
  if (expected.code === actual.code && expected.version === actual.version) return;
  throw new FrameworkMismatchError(
    { code: expected.code, version: expected.version },
    { code: actual.code, version: actual.version },
    context,
  );
}
