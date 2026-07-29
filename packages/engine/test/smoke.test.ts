import { describe, expect, it } from 'vitest';
import { computeOffering } from '../src/index.js';
import { CTX, coOf, hasWarning, poOf, policy, scenario } from './helpers.js';

/**
 * The end-to-end path, with numbers small enough to check by hand. If this fails, read the
 * arithmetic in the comments before suspecting the test.
 */
describe('computeOffering — worked example', () => {
  const input = scenario({
    cos: ['CO1', 'CO2'],
    outcomes: ['PO1'],
    articulation: { PO1: { CO1: 3, CO2: 1 } },
    assessments: [
      {
        id: 'A1',
        name: 'Mid-semester 1',
        weight: 100,
        questions: [
          { label: 'Q1', max: 10, co: 'CO1' },
          { label: 'Q2', max: 10, co: 'CO2' },
        ],
      },
    ],
    students: [
      { roll: 'R1', marks: { 'A1:Q1': 8, 'A1:Q2': 6 } },
      { roll: 'R2', marks: { 'A1:Q1': 7, 'A1:Q2': 6 } },
      { roll: 'R3', marks: { 'A1:Q1': 5, 'A1:Q2': 4 } },
      { roll: 'R4', marks: { 'A1:Q1': 9, 'A1:Q2': 3 } },
    ],
  });

  const p = policy({ validation: { min_assessments_per_co: 1 } });
  const result = computeOffering(input, p, CTX);

  it('bands CO1 from the fraction crossing the target', () => {
    // Percentages 0.8, 0.7, 0.5, 0.9 → three of four reach the 60% target → ratio 0.75.
    // Bands are 0.60→1, 0.70→2, 0.80→3, so 0.75 lands on level 2.
    const co1 = coOf(result, 'CO1');
    expect(co1.trace.ratio).toBeCloseTo(0.75, 10);
    expect(co1.students_considered).toBe(4);
    expect(co1.students_crossed).toBe(3);
    expect(co1.direct_value).toBe(2);
  });

  it('does not floor an under-performing CO at level 1', () => {
    // 0.6, 0.6, 0.4, 0.3 → two of four cross → ratio 0.5, below the lowest band.
    const co2 = coOf(result, 'CO2');
    expect(co2.trace.ratio).toBeCloseTo(0.5, 10);
    expect(co2.direct_value).toBe(0);
  });

  it('propagates CO levels to the PO through the articulation matrix', () => {
    // PO1 = (2·3 + 0·1) / (3 + 1) = 1.5
    expect(poOf(result, 'PO1').value).toBeCloseTo(1.5, 10);
  });

  it('falls back to direct attainment when no survey exists, and says so', () => {
    expect(hasWarning(result, 'INDIRECT_ABSENT')).toBe(true);
    expect(coOf(result, 'CO1').final_value).toBe(coOf(result, 'CO1').direct_value);
  });

  it('stamps the framework, policy and engine versions on the run', () => {
    expect(result.framework.version).toBe('gapc-v4.0');
    expect(result.stamps).toContain('Framework: nba-ug-eng/gapc-v4.0');
    expect(result.stamps.some((s) => s.startsWith('Policy: '))).toBe(true);
    expect(result.stamps.some((s) => s.startsWith('Engine: v'))).toBe(true);
  });

  it('traces a number down to one student’s answer to one question', () => {
    // P4: the drill-down has to reach an individual score, not stop at a class average.
    const co1 = coOf(result, 'CO1');
    const r4 = co1.trace.students.find((s) => s.roll_no === 'R4');
    expect(r4?.pct).toBeCloseTo(0.9, 10);
    const q1 = r4?.per_assessment[0]?.questions.find((q) => q.label === 'Q1');
    expect(q1).toMatchObject({ score: 9, max_marks: 10, weight: 1, attempted: true });
  });
});
