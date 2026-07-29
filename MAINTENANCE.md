# Maintenance policy

This document exists because of one question: **who maintains this registry in
three years, when the next GAPC version lands?**

A registry that goes stale silently is worse than one that never existed —
institutions and vendors will have pinned to it mid-cycle and will believe it is
current. So the commitment is written down, and the failure mode is designed for.

## Who

| Role | Who | Responsibility |
|---|---|---|
| Maintainer | **Dr Ebin Deni Raj**, FACTS-H Lab, IIIT Kottayam — <ebindeniraj@iiitkottayam.ac.in> | Owns the registry. Reviews and merges framework changes. Named, not collective. |
| Contributors | Rotating student cohort, FACTS-H Lab | Transcribe and cross-check framework files against official manuals. |
| Reviewers | Any contributor other than the author | No framework change is merged on a single pair of eyes. |

## Cadence

- **Every framework file is re-verified once per semester** against its
  `source_url`, and `verified_on` is updated whether or not anything changed.
  Confirming a file is still correct is as much a maintenance act as fixing one.
- **The README carries a staleness badge** derived from the *oldest*
  `verified_on` across the registry. It is deliberately the oldest and not the
  newest: one freshly-checked file must not make a neglected one look current.
- **Corrections to framework data are acknowledged within 14 days.** An
  incorrect outcome statement propagates into Self-Assessment Reports, so it is
  treated as the most serious class of defect here.
- **Schema changes follow semver**; the data package follows calendar versioning
  (`2026.07.0`). A breaking schema change is a major bump and is announced in
  `CHANGELOG.md` before release.

## What is maintained

**In scope.** The framework definitions under `frameworks/`, the JSON Schemas
under `packages/schemas/`, the attainment engine under `packages/engine/`, and
the synthetic golden fixtures.

**Out of scope.** Anything institution-specific: config packs, assessment
policies, report templates, importers. Those belong to the institutions that
author them and are not published here.

## If maintenance lapses

Stating this openly is part of the commitment. If no verification pass has
happened for **two consecutive semesters**:

1. The README badge turns red and states the registry is unmaintained.
2. An `UNMAINTAINED` notice is added at the top of the README naming the date of
   the last verification pass.
3. Published versions are **not** unpublished. Existing pins keep working, and
   historical evidence computed under an older framework version stays
   reproducible — which is the whole reason superseded versions are never
   deleted.
4. Open issues are labelled `unmaintained` rather than closed, so anyone
   evaluating adoption sees the real state.

Handing the registry to another institution or maintainer is an acceptable and
expected outcome. Silence is not.

## Succession

The maintainer names a successor before leaving the lab. If that is not
possible, the lab head becomes the interim maintainer and the lapse procedure
above applies until a new maintainer is named.
