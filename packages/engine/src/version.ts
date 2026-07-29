/**
 * The engine's own semver, stamped onto every run (spec §13, P4).
 *
 * An archived run records the engine version that produced it, so a result computed
 * two years ago can be explained even after the formulas have moved on. Bump this
 * whenever a change could alter a computed value for unchanged input.
 *
 * Kept in sync with package.json by a test in `version.test.ts` — this is a literal
 * rather than an import because the engine must not read files at runtime.
 */
export const ENGINE_VERSION = '0.3.0';
