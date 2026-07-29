# Changelog

Schemas follow [semantic versioning](https://semver.org): a breaking schema
change is a major bump. The framework **data** package follows calendar
versioning (`YYYY.MM.PATCH`). Institutions and vendors pin a version; nothing
floats.

Framework files are never edited in place. A revision is a new version that
`supersedes` the old one, and the old one stays published so evidence computed
under it remains reproducible.

## [Unreleased]

### Added
- Repository scaffold: dual licensing (Apache-2.0 for code, CC-BY-4.0 for data),
  `NOTICE` mapping paths to licences, disclaimer, contribution rules and a
  maintenance commitment with a stated lapse procedure.
- JSON Schemas: `framework-outcomes`, `framework-criteria`,
  `framework-knowledge-indicators`, `attainment-policy`, `engine-input`,
  `engine-output`.
- Registry seeded with NBA only: `nba/gapc-v3.0` (12 programme outcomes),
  `nba/gapc-v4.0` (11 outcomes) and its Washington Accord knowledge indicators,
  with the v3→v4 changelog and per-outcome correspondence.
- `scripts/staleness.mjs` — reports the oldest verification date across the
  registry, and reports never-verified files separately.

### Changed
- `verified_on` is nullable across every framework schema, and a null now
  requires a `verification_note`. It was previously mandatory, which would have
  forced a date to be invented for a file nobody had checked — corrupting the
  one field the registry's credibility rests on. Unverified is now a state the
  format can express, and the staleness check fails on it.

### Notes
- **Everything currently in the registry is UNVERIFIED.** The NBA files are
  transcribed from well-established published sources and the structure is
  right, but no maintainer has checked them clause by clause against an official
  NBA manual, and `source_url` points at the body's website rather than a
  specific document. `scripts/staleness.mjs` exits non-zero because of this,
  deliberately. Do not cut a release until it passes.
- `framework-criteria` is deliberately separate from `framework-outcomes`.
  Outcome-based bodies (NBA, ABET) define outcomes a graduate attains;
  criterion-based bodies (NAAC post-2025, NIRF) define criteria an institution
  evidences and *consume* outcome data rather than defining it. Forcing both
  into one schema would misrepresent at least one of them.
- Knowledge indicators have their own file and schema because SAR 2025 expects a
  CO-PO-WK mapping — WK is a third mapping dimension, not a field on a PO.
- NAAC, NIRF and ABET are listed in `frameworks/index.json` under `planned`,
  each with the reason it is blocked. NBA first, deliberately: settle the shape
  on the framework understood best before transcribing ones nobody here has
  worked with.
