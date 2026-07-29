/**
 * Policy validation.
 *
 * `schema.json` is the contract for editors and CI; this is the runtime check, and it
 * deliberately covers a narrower, sharper set: the things that silently produce a wrong
 * number rather than a type error. Weights that do not sum to 1 are the classic — nothing
 * crashes, every value is quietly scaled, and the report looks fine.
 */

import { InvalidPolicyError } from '../errors.js';
import type { PolicyDocument } from '../types.js';

const EPS = 1e-9;

export function validatePolicy(policy: PolicyDocument): string[] {
  const issues: string[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

  if (!policy.framework?.code || !policy.framework?.version) {
    issues.push('framework.code and framework.version are required — a run must pin its framework (P5).');
  }

  if (!policy.scale || policy.scale.max <= policy.scale.min) {
    issues.push('scale.max must exceed scale.min.');
  }

  const d = policy.direct;
  if (!d) {
    issues.push('direct block is required.');
  } else {
    if (d.target_pct < 0 || d.target_pct > 100) {
      issues.push(`direct.target_pct must be between 0 and 100, got ${d.target_pct}.`);
    }
    if (!Array.isArray(d.bands) || d.bands.length === 0) {
      if (d.method !== 'percentage') {
        issues.push('direct.bands must list at least one band unless direct.method is "percentage".');
      }
    } else {
      for (const b of d.bands) {
        if (b.at_least < 0 || b.at_least > 1) {
          issues.push(`direct.bands.at_least is a ratio in 0..1, got ${b.at_least}.`);
        }
        if (policy.scale && (b.level < policy.scale.min || b.level > policy.scale.max)) {
          issues.push(`Band level ${b.level} falls outside the scale ${policy.scale.min}..${policy.scale.max}.`);
        }
      }
      const sorted = [...d.bands].sort((a, b) => a.at_least - b.at_least);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i]!.level < sorted[i - 1]!.level) {
          issues.push(
            'direct.bands are not monotonic: a higher ratio maps to a lower level, which would make ' +
              'attainment fall as students improve.',
          );
          break;
        }
      }
    }
    if (d.combination === 'split' && !near(d.cie_weight + d.see_weight, 1)) {
      issues.push(
        `direct.cie_weight + direct.see_weight must be 1 under "split" combination, got ${d.cie_weight + d.see_weight}.`,
      );
    }
    if (d.combination === 'component_levels' && (!Array.isArray(d.bands) || d.bands.length === 0)) {
      issues.push(
        'direct.combination "component_levels" bands each instrument separately, so direct.bands ' +
          'must be defined — there is nothing to band with.',
      );
    }
    if (d.see_mode === 'threshold_proxy' && d.see_threshold_proxy_pct === undefined) {
      issues.push('direct.see_threshold_proxy_pct is required when see_mode is "threshold_proxy".');
    }
  }

  if (policy.weights && !near(policy.weights.direct + policy.weights.indirect, 1)) {
    issues.push(
      `weights.direct + weights.indirect must be 1, got ${policy.weights.direct + policy.weights.indirect}.`,
    );
  }

  if (policy.program) {
    const pw = policy.program.weights;
    if (pw && !near(pw.direct + pw.indirect, 1)) {
      issues.push(`program.weights.direct + program.weights.indirect must be 1, got ${pw.direct + pw.indirect}.`);
    }
    const sources = policy.program.indirect_sources ?? [];
    if (sources.length > 0) {
      const total = sources.reduce((a, b) => a + b.weight, 0);
      if (!near(total, 1)) {
        issues.push(`program.indirect_sources weights must sum to 1, got ${total}.`);
      }
    }
    for (const [code, target] of Object.entries(policy.program.targets_by_outcome ?? {})) {
      if (policy.scale && (target < policy.scale.min || target > policy.scale.max)) {
        issues.push(`Target for ${code} (${target}) falls outside the scale ${policy.scale.min}..${policy.scale.max}.`);
      }
    }
  }

  if (policy.indirect) {
    if (policy.indirect.scale_max <= policy.indirect.scale_min) {
      issues.push('indirect.scale_max must exceed indirect.scale_min.');
    }
    if (policy.indirect.mapping === 'threshold' && policy.indirect.threshold_rating === undefined) {
      issues.push('indirect.threshold_rating is required when indirect.mapping is "threshold".');
    }
    if (policy.indirect.min_responses < 1) {
      issues.push(
        'indirect.min_responses must be at least 1 — accepting zero responses would let an empty ' +
          'survey produce an attainment number.',
      );
    }
  }

  if (policy.po) {
    const cs = policy.po.correlation_scale;
    if (cs && cs.max < cs.min) issues.push('po.correlation_scale.max must be at least .min.');
  }

  if (policy.migration) {
    const m = policy.migration;
    if (!m.from_version || !m.to_version) {
      issues.push('migration.from_version and migration.to_version are both required.');
    }
    if (m.from_version === m.to_version) {
      issues.push('migration.from_version and migration.to_version must differ.');
    }
    if (m.recompute_historical_terms) {
      issues.push(
        'migration.recompute_historical_terms is true. Restating historical terms under the new ' +
          'framework destroys the audit trail; if this is genuinely intended, remove this check ' +
          'deliberately rather than by accident.',
      );
    }
  }

  if (policy.grade_scale?.enabled) {
    const values = Object.values(policy.grade_scale.mapping ?? {});
    if (values.length === 0) issues.push('grade_scale is enabled but its mapping is empty.');
    for (const [grade, pct] of Object.entries(policy.grade_scale.mapping ?? {})) {
      if (pct < 0 || pct > 100) issues.push(`grade_scale.mapping.${grade} must be a percentage, got ${pct}.`);
    }
  }

  return issues;
}

/** Throwing form, for the places where continuing would compute something meaningless. */
export function assertValidPolicy(policy: PolicyDocument): void {
  const issues = validatePolicy(policy);
  if (issues.length > 0) {
    throw new InvalidPolicyError(`Policy ${policy.id ?? '(unnamed)'} is not valid`, issues);
  }
}

export { EPS };
