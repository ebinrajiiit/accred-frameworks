# Accreditation Framework Registry

<!-- verification-badge -->
![verification: 4 UNVERIFIED](https://img.shields.io/badge/verification-4%20UNVERIFIED-critical)

4 of 4 framework files have never been checked against an official manual: `naac/binary-2025`, `nba/gapc-v3.0`, `nba/gapc-v4.0`, `nba/gapc-v4.0/wk-indicators`. They carry `verified_on: null` and a note saying what a verifier must confirm.
<!-- /verification-badge -->

Versioned, provenance-carrying definitions of accreditation frameworks — NBA, NAAC, ABET,
NIRF — with JSON Schemas and a pure attainment engine that computes outcome attainment from
them.

> **Status: pre-release, and everything in it is UNVERIFIED.**
>
> The schemas are in place and the registry is seeded with NBA GAPC v3.0 and v4.0. But no
> maintainer has yet checked those files clause by clause against an official NBA manual, so
> every one carries `verified_on: null` and a note saying what a verifier must do.
> `npm run staleness` exits non-zero because of this, on purpose. **Do not cut a release, and
> do not rely on this for a submission, until it passes.**
>
> Nothing is published to npm yet.

### Before the first release

- [ ] Verify `nba/gapc-v3.0`, `nba/gapc-v4.0` and its WK indicators against the official NBA
      manuals; replace each `source_url` with the document URL and set `verified_on`
- [ ] `npm run staleness` passes — it currently exits non-zero, correctly
- [x] Set the repository URL in `NOTICE` for CC-BY attribution
- [x] Name a maintainer in `MAINTENANCE.md` and a security contact in `SECURITY.md`

**This registry is vendor-neutral and free for anyone to use, including commercial products.**
That is deliberate. Accreditation frameworks are public documents, and every institution and
every tool in this space re-transcribes them separately, which means they are separately
wrong. There is no reason for that transcription to be a competitive asset. If you build a
competing OBE product, please use this — corrections from you make it better for everyone.

Maintained by [FACTS-H Lab](https://iiitkottayam.ac.in), IIIT Kottayam.
Maintainer: **Dr Ebin Deni Raj** — <ebindeniraj@iiitkottayam.ac.in>. See
[MAINTENANCE.md](MAINTENANCE.md) for the verification cadence and what happens if it lapses.

---

## Read this first

**[DISCLAIMER.md](DISCLAIMER.md)** — this is not an official source. The framework files are a
convenience transcription of published manuals, maintained in good faith by academics, and
are not endorsed by any accreditation body. Verify against the official manual before relying
on this for a submission. Outcome statements appear *verbatim* in a Self-Assessment Report, so
a transcription slip is a defect in your submission.

---

## What is here

```
frameworks/             the registry — one directory per body, per version
packages/schemas/       JSON Schemas for frameworks, policies and the engine contracts
packages/engine/        pure attainment engine — no I/O, no database, no institute specifics
fixtures/policies/      synthetic test policies (never an institution's real config pack)
fixtures/golden/        golden archetypes as real engine-input documents — SYNTHETIC ONLY
scripts/staleness.mjs   reports the oldest verification date across the registry
scripts/build-fixtures.mjs  regenerates the golden fixtures
```

### The engine

`(input document, policy document) → result document`. No filesystem, no network, no database,
no clock — timestamps are passed in, because a run that cannot be reproduced cannot be defended
to an evaluator. Every computed value carries a trace that resolves to one student's score on
one question.

Seven golden fixtures cover the cases that matter: question-wise and apportioned end-semester
data, a percentage scale with no PSOs, an entirely internal lab course, choice questions whose
alternatives test different outcomes, and a programme straddling the twelve-to-eleven cutover.
Their expected values are hand-computed — the arithmetic is written out in
`scripts/build-fixtures.mjs` — so the fixtures can catch a regression instead of enshrining one.

### Two shapes of framework, deliberately

Accreditation bodies do not all work the same way, and flattening them into one schema would
misrepresent at least one of them.

| Schema | Used by | Defines |
|---|---|---|
| `framework-outcomes` | NBA, ABET | **Outcomes** a graduate attains — programme outcomes, student outcomes |
| `framework-criteria` | NAAC, NIRF | **Criteria** an institution evidences, and which computed artefacts satisfy them |

NAAC post-February-2025 is Binary accreditation plus optional Maturity-Based Graded Levels;
CGPA grading is retired. It does not define its own outcome set — it *consumes* outcome
evidence produced under another framework. So a NAAC criterion declares `evidence_sources`
(`po_attainment`, `articulation_matrix`, `action_plan`, and so on), which is what lets an
evidence pack be assembled from data that already exists rather than re-keyed by hand. A
criterion that genuinely cannot be evidenced from attainment data declares `external`, because
honest coverage is more useful than claimed coverage.

### Provenance is mandatory

Every framework file carries `source_document`, `source_url`, `retrieved_on` and
`verified_on`, and CI rejects files without them. This is the registry's entire credibility:
an outcome statement nobody can trace back to a manual is worse than a missing one, because it
will be trusted.

Framework versions are **immutable**. A revision is a new version with `supersedes` pointing at
the old one; the old one is never edited or removed, so evidence computed under it stays
reproducible. NBA's move from twelve programme outcomes to eleven is exactly why.

### Staleness is visible, not silent

```bash
node scripts/staleness.mjs
```

Reports the **oldest** `verified_on` across the whole registry — not the newest, so one
freshly-checked file cannot make a neglected one look current. Past the threshold it exits
non-zero and the badge reads `UNMAINTAINED`. See [MAINTENANCE.md](MAINTENANCE.md) for who
maintains this, on what cadence, and what happens if that lapses.

---

## Using it

```bash
npm install
npm test        # schemas, registry files, engine, golden fixtures
npm run ci      # everything CI runs: typecheck, all four gates, tests
```

### The gates

The engine's contract — a pure function of its inputs, with no institution's rules baked in —
is enforced mechanically rather than by review, because the pressure to break it always arrives
gradually and with a good reason.

| Gate | Fails on |
|---|---|
| `gate:imports` | The engine importing `fs`, a network client, Prisma, Next, or reaching outside its own package. `node:crypto` is the single permitted builtin, for hashing the input document. |
| `gate:purity` | `Date.now()`, `Math.random()`, `process.env`, or a hardcoded threshold like `>= 0.65` in engine source. A run that reads the clock cannot be reproduced; a threshold in code is an institution's rule that has escaped the policy document. |
| `gate:privacy` | Anything under `fixtures/` resembling a real roll number, email address, phone number or Aadhaar number. Fixtures are synthetic — invent the students. |
| `gate:badge` | The README's verification badge disagreeing with the registry, so staleness cannot be hidden by forgetting to regenerate it. |

A separate CI job runs the engine's tests with **no database present and no service containers
declared**, because "computable on a laptop" is the claim that lets an institution audit a
number independently, and it is worth asserting rather than assuming.

Pin a version. Institutions and vendors should depend on an exact version of the data package
(calendar-versioned, `2026.07.0`) and of the schemas (semver). Nothing should float: a
framework revision landing mid-cycle should be a decision you make, not something that happens
to you.

---

## Licensing

Two licences, split by path — see [NOTICE](NOTICE) for the exact mapping.

- **Code** (`packages/**`, `scripts/**`) — [Apache-2.0](LICENSE). Chosen over MIT for its
  explicit patent grant, and because it is the licence commercial vendors are most comfortable
  adopting.
- **Data** (`frameworks/**`, `fixtures/**`) — [CC-BY-4.0](LICENSE-DATA). Chosen over CC0
  because attribution is the entire return on this contribution.

**No real data, ever.** No student data, roll numbers, marks, institutional rubrics or config
packs appear here, and none ever should. A config pack encodes an institution's own assessment
policy — it belongs to that institution. Fixtures are synthetic and CI fails on anything
resembling a real roll number or an email address.

## Contributing

Corrections to framework data are the most valuable contribution, and the most urgent. Read
[CONTRIBUTING.md](CONTRIBUTING.md) — the one rule is that **every change must cite the official
document it came from.**

Also: [SECURITY.md](SECURITY.md), [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md),
[CHANGELOG.md](CHANGELOG.md).
