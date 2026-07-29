# @factsh/attainment-engine

Computes CO/PO/PSO attainment for outcome-based accreditation. A policy document and a set of
marks go in; a traceable result document comes out.

> **Pre-release, and the framework data it is usually run against is UNVERIFIED.**
> The engine's own arithmetic is covered by hand-computed golden fixtures. The *framework
> files* in this repository — the PO statements, their counts — have not yet been checked
> clause by clause against an official manual, and carry `verified_on: null`. Do not rely on
> output from those for a live submission until they pass. See
> [DISCLAIMER.md](https://github.com/ebinrajiiit/accred-frameworks/blob/main/DISCLAIMER.md).

## What it is

```ts
import { computeOffering, computeProgram } from '@factsh/attainment-engine';

// One course offering: marks in, CO and PO attainment out.
const result = computeOffering(input, policy, {
  computed_at: '2026-07-29T00:00:00.000Z', // passed in, never read from the clock
  computed_by: 'user-1',                   // optional
});

// A whole programme, from the offering results that fed it.
const rollup = computeProgram(programInput, policy, { computed_at: '2026-07-29T00:00:00.000Z' });
```

`result` carries every CO and PO value, the method that produced it, the cohort it was
computed over, warnings, and a `trace` on each number resolving back to the marks rows it came
from.

Also exported: `validatePolicy` (checks a policy document before you compute with it),
`computeInputHash` (the hash that makes a run reproducible), and `FrameworkMismatchError`.

## The properties it holds

**Pure.** No I/O, no database, no network, no `process.env`, no `Date.now()`, no
`Math.random()`. Timestamps and ids are arguments. A CI gate checks this on every commit,
because the moment the engine can read a clock it stops being reproducible.

**Rules are data.** No threshold, weight, band or scale is in the code. They live in the policy
document and the engine interprets it. There is no `const PO_COUNT = 11` — NBA already moved
12 → 11 once.

**Reproducible.** A run pins its policy version, framework version and an input hash.
Recomputing an archived run must produce an identical result, which is what makes a number
defensible a year later.

**Honest about degradation.** Where the end-semester paper is not available question-wise, the
result is stamped with which fallback was used. A fallback is never presented as a full
computation.

**A framework mismatch is fatal.** If a policy binds to one framework and the outcome set
belongs to another, the engine throws rather than warns. A 12-PO computation presented for a
post-2025 submission is exactly the failure that guard exists to prevent.

## Two details that decide whether the numbers are right

Both have named tests; if you are reviewing this engine, review these first.

- **Choice questions.** The per-student maximum sums only over *attempted* questions. A student
  who answered Q5 (CO2) and one who answered Q6 (CO3) each get their own per-CO denominator.
  A class-wide denominator is the single difference between a defensible number and a wrong
  one.
- **Best-of-N resolves per CO.** The "best two of three quizzes" can be a different two for CO1
  than for CO3.

## Licence

Apache-2.0. The framework *data* in the wider repository is CC-BY-4.0 — see
[NOTICE](https://github.com/ebinrajiiit/accred-frameworks/blob/main/NOTICE).
