/**
 * Policy resolution across four scopes, narrowest wins (spec §7).
 *
 *     institution → program → course_type → course
 *
 * An institution sets 60% as the target; the physics department overrides the band table
 * for its lab courses; one course overrides the absent rule after a timetable clash. Each
 * layer states only what it changes, so reading a course's policy tells you what is unusual
 * about it rather than restating the whole rulebook.
 */

import type { PolicyDocument, PolicyPatch, PolicyScopeType } from '../types.js';

export interface PolicyLayers {
  institution: PolicyDocument;
  program?: PolicyPatch;
  course_type?: PolicyPatch;
  course?: PolicyPatch;
}

const PRECEDENCE: PolicyScopeType[] = ['institution', 'program', 'course_type', 'course'];

/**
 * Deep-merge the layers.
 *
 * Arrays are replaced wholesale rather than concatenated — a course overriding the band
 * table means *these* bands, not these bands appended to the institution's. Merging them
 * would produce a table nobody wrote.
 */
export function resolvePolicy(layers: PolicyLayers): PolicyDocument {
  let out: Record<string, unknown> = clone(layers.institution as unknown as Record<string, unknown>);
  const applied: string[] = ['institution'];

  for (const scope of PRECEDENCE.slice(1)) {
    const patch = layers[scope as keyof PolicyLayers] as PolicyPatch | undefined;
    if (!patch) continue;
    out = deepMerge(out, patch as unknown as Record<string, unknown>);
    applied.push(scope);
  }

  const resolved = out as unknown as PolicyDocument;

  // The narrowest layer that contributed anything owns the resulting scope and version, so
  // a run records which document it actually ran under.
  const narrowest = applied[applied.length - 1] as PolicyScopeType;
  const narrowestPatch =
    narrowest === 'institution' ? layers.institution : (layers[narrowest as keyof PolicyLayers] as PolicyPatch);

  resolved.scope = narrowestPatch.scope ?? { type: narrowest, ref: null };
  if (narrowestPatch.id) resolved.id = narrowestPatch.id;
  if (narrowestPatch.version) resolved.version = narrowestPatch.version;

  return resolved;
}

function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // Editor-facing annotations in the JSON documents; never part of the resolved policy.
    if (key.startsWith('_comment') || key === '$schema') continue;

    const existing = out[key];
    if (isPlainObject(value) && isPlainObject(existing)) {
      out[key] = deepMerge(existing, value);
    } else {
      out[key] = clone(value);
    }
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function clone<T>(v: T): T {
  if (Array.isArray(v)) return v.map(clone) as unknown as T;
  if (isPlainObject(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (k.startsWith('_comment') || k === '$schema') continue;
      out[k] = clone(val);
    }
    return out as unknown as T;
  }
  return v;
}

/** Strip the `_comment_*` annotations the shipped policy documents carry for humans. */
export function stripComments<T>(doc: T): T {
  return clone(doc);
}
