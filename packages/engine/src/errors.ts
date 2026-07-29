/**
 * The engine has exactly one class of fatal condition: it was asked to compute something
 * that would produce a number nobody should rely on. Everything else degrades into a
 * warning and a report stamp (P7).
 */

/**
 * The program's outcome set does not belong to the framework the policy binds to.
 *
 * This is deliberately fatal rather than a warning. Spec §4.1: NBA replaced its 12-PO
 * structure with 11 under GAPC v4.0, and a 12-PO computation presented for a post-2025
 * submission is invalid — not merely imprecise. A warning would be rendered somewhere on
 * a report and ignored; a throw cannot be.
 *
 * The fix is never to relax the check. It is either to migrate the program's articulation
 * matrix (see `@attainment/frameworks`) or to compute the term under the framework that
 * was actually in force at the time, which is what historical terms are supposed to do.
 */
export class FrameworkMismatchError extends Error {
  override readonly name = 'FrameworkMismatchError';

  constructor(
    readonly expected: { code: string; version: string },
    readonly actual: { code: string; version: string },
    readonly context?: { offering_id?: string; program_id?: string },
  ) {
    super(
      `Framework mismatch: policy binds to ${expected.code}/${expected.version} but the outcome set is ` +
        `${actual.code}/${actual.version}. Migrate the articulation matrix, or compute this term under ` +
        `the framework in force at the time. Refusing to compute.`,
    );
  }
}

/** The input document is malformed in a way that makes computation meaningless. */
export class InvalidInputError extends Error {
  override readonly name = 'InvalidInputError';

  constructor(
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** The policy document failed validation — see `validatePolicy` for the issue list. */
export class InvalidPolicyError extends Error {
  override readonly name = 'InvalidPolicyError';

  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(`${message}\n  - ${issues.join('\n  - ')}`);
  }
}
