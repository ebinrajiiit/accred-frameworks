# Contributing

Thank you for helping keep this registry accurate. Accuracy is the only thing it
has to offer.

## The one rule that matters

**Every change to a framework file must cite the official document it came
from.** A pull request that changes an outcome statement, a criterion or a
parameter without a `source_document`, a `source_url` and the clause or page
number will be closed, however obviously correct it looks.

The reason is narrow and practical: this text is reproduced verbatim in
accreditation submissions. A plausible-sounding paraphrase that nobody can trace
back to a manual is worse than a missing file, because it will be trusted.

## Proposing a framework change

1. **Open an issue first** for anything beyond a typo, naming the accrediting
   body, the version and what changed.
2. **Never edit a published version in place.** Frameworks are immutable once
   released. A revision is a *new* version directory with `supersedes` pointing
   at the old one, and the old one gains `superseded_by`. Historical evidence
   computed under the old version must stay reproducible.
3. **Fill in the provenance block completely** — `source_document`,
   `source_url`, `retrieved_on`, `verified_on`, and a `changelog` entry
   describing what moved and which outcomes it affects.
4. **Run the checks**: `npm test`. CI validates every framework file against its
   schema, enforces provenance, and fails on anything that looks like real data.
5. **Expect a second reviewer.** No framework change merges on one pair of eyes.

### Re-verifying without changing anything

Confirming a file is still correct is a real contribution. Update `verified_on`,
leave everything else alone, and say in the PR what you checked it against.

## Never commit

- Real student data of any kind — roll numbers, names, marks, grades
- Email addresses
- An institution's config pack, assessment policy or rubric
- Anything scraped from a system you do not have permission to publish

A config pack encodes an institution's own assessment rules. It belongs to that
institution, not to this project. CI fails on patterns that look like real roll
numbers or email addresses anywhere under `fixtures/`, but the gate is a
backstop, not a substitute for judgement.

**Fixtures are synthetic.** Invent the students. If a fixture happens to
resemble a real cohort, change it.

## Contributing to the engine

The engine is a pure function: `(input document, policy document) → result
document`. That is enforced in CI, not merely encouraged.

- No `fs`, no network, no `process.env`, no Prisma, no framework imports
- No `Date.now()` and no `Math.random()` — the clock is an input, because a run
  that cannot be reproduced cannot be defended to an evaluator
- No institution-specific rule anywhere. Thresholds, weights, bands and scales
  live in the policy document. If you find yourself typing a number like `0.6`
  into the engine, it belongs in a policy instead.
- Every behavioural change needs a test, and changes affecting computed values
  must diff against the golden fixtures

## Licensing of contributions

Code contributions are licensed under Apache-2.0; framework data and fixtures
under CC-BY-4.0. By opening a pull request you confirm you have the right to
contribute the material under those terms. See `NOTICE` for which paths are
which.
