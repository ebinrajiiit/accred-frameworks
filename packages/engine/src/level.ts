/**
 * Banding and the CO attainment level (spec §6.3).
 *
 * Every threshold here arrives from the policy document. There are no numeric literals in
 * this file beyond 0, 1 and 100, and that is the point of P2 — the difference between a
 * 60/70/80 institute and a 50/60/70 institute must be a config edit, never a code change.
 */

import type { Band, PolicyDirect, PolicyScale } from './types.js';

/**
 * Highest band whose `at_least` the value reaches; `scale.min` if it reaches none.
 *
 * Bands are sorted here rather than trusting document order — a hand-edited policy with
 * bands listed high-to-low must not silently produce a different answer.
 */
export function band(value: number, bands: Band[], scale: PolicyScale): number {
  const sorted = [...bands].sort((a, b) => a.at_least - b.at_least);
  let level = scale.min;
  for (const b of sorted) {
    if (value >= b.at_least) level = b.level;
  }
  return level;
}

/** Clamp a value onto the policy's scale. */
export function clampToScale(value: number, scale: PolicyScale): number {
  return Math.min(scale.max, Math.max(scale.min, value));
}

export interface LevelComputation {
  /** The value on the policy's scale — a level for `level` scales, a percentage otherwise. */
  value: number;
  /** Number of students with a defined percentage for this CO. */
  considered: number;
  /** Number reaching `target_pct`. Undefined for `class_average`, which has no crossing. */
  crossed?: number;
  ratio?: number;
  mean_pct?: number;
  formula: PolicyDirect['method'];
}

/**
 * Turn a set of per-student CO percentages into one class-level number (§6.3).
 *
 * `percentages` are fractions in 0..1, already resolved per student across assessments.
 * An empty set returns undefined rather than 0 — a CO nobody could be measured on is
 * unmeasured, not failed, and reporting it as 0 is how fabricated attainment starts.
 */
export function computeLevel(
  percentages: number[],
  direct: PolicyDirect,
  scale: PolicyScale,
): LevelComputation | undefined {
  const n = percentages.length;
  if (n === 0) return undefined;

  const target = direct.target_pct / 100;

  switch (direct.method) {
    case 'target_ratio': {
      const crossed = percentages.filter((p) => p >= target).length;
      const ratio = crossed / n;
      return {
        value: band(ratio, direct.bands, scale),
        considered: n,
        crossed,
        ratio,
        formula: 'target_ratio',
      };
    }

    case 'class_average': {
      const mean = percentages.reduce((a, b) => a + b, 0) / n;
      return {
        value: band(mean, direct.bands, scale),
        considered: n,
        mean_pct: mean,
        formula: 'class_average',
      };
    }

    case 'percentage': {
      // Reported raw rather than banded. Which quantity is reported follows the same
      // choice target_ratio would have made: the fraction crossing the target.
      const crossed = percentages.filter((p) => p >= target).length;
      const ratio = crossed / n;
      return {
        value: ratio * 100,
        considered: n,
        crossed,
        ratio,
        formula: 'percentage',
      };
    }
  }
}

/**
 * Map a mean survey rating onto the attainment scale (§6.4, `mapping: linear`).
 *
 * A rating of `scale_min` maps to the bottom of the attainment scale and `scale_max` to
 * the top, so a 1–5 survey and a 1–10 survey produce comparable numbers.
 */
export function linearScaleToLevel(
  meanRating: number,
  ratingMin: number,
  ratingMax: number,
  scale: PolicyScale,
): number {
  const span = ratingMax - ratingMin;
  if (span <= 0) return scale.min;
  const fraction = (meanRating - ratingMin) / span;
  return clampToScale(scale.min + fraction * (scale.max - scale.min), scale);
}

/** Round for display without letting rounding leak into stored values. */
export function roundTo(value: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(value * f) / f;
}
