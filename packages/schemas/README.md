# @facts-h/accred-schemas

JSON Schemas for accreditation frameworks, attainment policies, and the attainment engine's
input and output contracts.

> **Pre-release.** The schemas are stable in shape; the framework *data* published alongside
> them is UNVERIFIED against official manuals. See
> [DISCLAIMER.md](https://github.com/ebinrajiiit/accred-frameworks/blob/main/DISCLAIMER.md).

## The schemas

| Import | What it describes |
| --- | --- |
| `@facts-h/accred-schemas/framework-outcomes` | A framework defining outcomes a *graduate* attains — NBA GAPC, ABET EAC. |
| `@facts-h/accred-schemas/framework-criteria` | A framework defining criteria an *institution* evidences — NAAC, NIRF. |
| `@facts-h/accred-schemas/framework-knowledge-indicators` | Washington Accord knowledge indicators (WK1–WK9). |
| `@facts-h/accred-schemas/attainment-policy` | The rulebook: targets, bands, weights, cohort handling, end-semester mode. |
| `@facts-h/accred-schemas/engine-input` | What the engine consumes. |
| `@facts-h/accred-schemas/engine-output` | What it returns, including the trace on every value. |

```ts
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import outcomes from '@facts-h/accred-schemas/framework-outcomes' with { type: 'json' };

const validate = addFormats(new Ajv({ strict: false })).compile(outcomes);
```

## Why outcomes and criteria are separate schemas

NAAC does not define its own outcome set. It consumes outcome evidence produced under some
other framework — a programme accredited under NBA GAPC v4.0 supplies its CO/PO attainment as
evidence towards NAAC criteria. Modelling NAAC as an outcome set would invent eleven NAAC
outcomes that do not exist, and would make one programme appear accredited twice on the same
axis.

The `evidence_sources` block on a criterion makes that consumption explicit and
machine-checkable: a criterion declares which computed artefacts satisfy it, and — just as
usefully — declares `external` where none can.

## Provenance is required, not optional

Every framework file must carry `source_document`, `source_url`, `retrieved_on` and
`verified_on`. `verified_on: null` is permitted, but then `verification_note` is required and
must say what state the transcription is in and what a verifier has to confirm. A framework
file that cannot say where it came from is not usable as accreditation evidence.

## Licence

Apache-2.0.
