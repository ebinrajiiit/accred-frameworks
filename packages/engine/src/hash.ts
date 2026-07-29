/**
 * Deterministic input hashing (P5).
 *
 * A run pins policy version, framework version and the hash of its inputs. Two things
 * follow, and both are requirements rather than niceties:
 *
 *  - Recomputing an archived run must reproduce it byte for byte, so the hash must not
 *    depend on anything incidental — row order out of Postgres, key order in JSON, the
 *    presence of an explicitly-undefined field.
 *  - Editing a blueprint's CO mapping after marks are entered must change the hash, so
 *    the stored run can be detected as stale rather than silently served (§12.16).
 *
 * `node:crypto` is the only Node builtin the engine touches. It performs no I/O.
 */

import { createHash } from 'node:crypto';

/**
 * Canonical JSON: object keys sorted, `undefined` dropped, and arrays sorted by their own
 * canonical form.
 *
 * Sorting arrays is the unusual choice and it is deliberate. The input document's arrays
 * are *sets* — the marks for an offering have no meaningful order — so a hash that changed
 * when Postgres returned rows in a different order would make reproducibility checks fire
 * constantly and train everyone to ignore them. It also gives the order-invariance property
 * test something real to assert against.
 */
export function canonicalise(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';

  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) return 'null';
    // -0 and 0 must hash identically; JSON.stringify(-0) is "0" but Object.is distinguishes them.
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (t === 'boolean' || t === 'string') return JSON.stringify(value);
  if (t === 'bigint') return JSON.stringify((value as bigint).toString());

  if (Array.isArray(value)) {
    const parts = value.map(canonicalise);
    parts.sort();
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalise(obj[k])}`);
    return `{${parts.join(',')}}`;
  }

  // Functions and symbols cannot appear in a document that came from JSON.
  return 'null';
}

/** SHA-256 of the canonical form, hex encoded. */
export function hashDocument(value: unknown): string {
  return createHash('sha256').update(canonicalise(value), 'utf8').digest('hex');
}

/**
 * The hash stored on a run.
 *
 * Policy and framework are folded in alongside the input: the same marks under a different
 * target percentage are a different run, and a stored run whose policy has since been
 * edited must not look current (§12.19).
 */
export function computeInputHash(input: unknown, policy: unknown, framework: unknown): string {
  return hashDocument({ input, policy, framework });
}
