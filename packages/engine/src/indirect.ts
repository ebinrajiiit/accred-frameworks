/**
 * Indirect attainment from the course exit survey (spec §6.4).
 *
 * The gate matters more than the formula. A CO with four responses on a class of sixty is
 * not evidence of anything, so below `min_responses` the engine declines to compute rather
 * than producing a number that looks like the others on the report (§12.13).
 */

import { band, linearScaleToLevel } from './level.js';
import type { EngineInput, PolicyDocument } from './types.js';
import { WarningLog } from './warnings.js';

export interface IndirectResult {
  value?: number;
  responses: number;
  mean_rating?: number;
  /** Fraction rating at or above `threshold_rating`, under `mapping: threshold`. */
  ratio?: number;
  suppressed: boolean;
  mapping: PolicyDocument['indirect']['mapping'];
}

export function computeIndirect(
  input: EngineInput,
  policy: PolicyDocument,
  warnings: WarningLog,
): Map<string, IndirectResult> {
  const out = new Map<string, IndirectResult>();
  const survey = input.survey;

  if (!survey || survey.responses.length === 0) {
    warnings.push(
      'INDIRECT_ABSENT',
      'No course exit survey responses were supplied; final attainment equals direct attainment.',
    );
    return out;
  }

  const ratingMin = survey.scale_min ?? policy.indirect.scale_min;
  const ratingMax = survey.scale_max ?? policy.indirect.scale_max;

  const byCo = new Map<string, number[]>();
  for (const r of survey.responses) {
    const list = byCo.get(r.course_outcome_id) ?? [];
    list.push(r.rating);
    byCo.set(r.course_outcome_id, list);
  }

  if (survey.invited && policy.indirect.min_response_rate) {
    const distinct = new Set(
      survey.responses.map((r) => r.respondent_token ?? `${r.course_outcome_id}:${r.rating}`),
    ).size;
    const rate = distinct / survey.invited;
    if (rate < policy.indirect.min_response_rate) {
      warnings.push(
        'INDIRECT_LOW_RESPONSE_RATE',
        `Survey response rate ${(rate * 100).toFixed(0)}% is below the ${(policy.indirect.min_response_rate * 100).toFixed(0)}% ` +
          `minimum; indirect attainment is reported but should be treated as weak evidence.`,
        undefined,
        { rate, minimum: policy.indirect.min_response_rate },
      );
    }
  }

  for (const co of input.course_outcomes) {
    const ratings = byCo.get(co.id) ?? [];
    const result: IndirectResult = {
      responses: ratings.length,
      suppressed: false,
      mapping: policy.indirect.mapping,
    };

    if (ratings.length < policy.indirect.min_responses) {
      result.suppressed = true;
      warnings.push(
        'INDIRECT_SUPPRESSED',
        `${co.code}: ${ratings.length} survey ${ratings.length === 1 ? 'response' : 'responses'} is below the ` +
          `minimum of ${policy.indirect.min_responses}; indirect attainment was not computed and ` +
          `final attainment equals direct attainment.`,
        { course_outcome_id: co.id },
        { responses: ratings.length, min_responses: policy.indirect.min_responses },
      );
      out.set(co.id, result);
      continue;
    }

    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    result.mean_rating = mean;

    if (policy.indirect.mapping === 'threshold') {
      const k = policy.indirect.threshold_rating ?? ratingMax;
      const ratio = ratings.filter((r) => r >= k).length / ratings.length;
      result.ratio = ratio;
      result.value = band(ratio, policy.direct.bands, policy.scale);
    } else {
      result.value = linearScaleToLevel(mean, ratingMin, ratingMax, policy.scale);
    }

    out.set(co.id, result);
  }

  return out;
}
