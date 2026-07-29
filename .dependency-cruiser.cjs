/**
 * Import rules for the engine boundary (OSS-SPLIT §4).
 *
 * The engine's contract is that it is a pure function: `(input, policy) → result`. That
 * claim is worth nothing if it rests on discipline, because the pressure to reach for a
 * database handle or the system clock arrives gradually and always with a good reason. So it
 * is enforced here, and CI fails the build rather than a reviewer catching it.
 *
 * Rules apply to `packages/engine/src` only. Test code legitimately reads fixture files.
 */

const ENGINE_SRC = '^packages/engine/src';

module.exports = {
  forbidden: [
    {
      name: 'engine-no-io',
      severity: 'error',
      comment:
        'The engine must not touch the filesystem, the network, the process environment or a ' +
        'subprocess. An engine that reads anything is an engine whose results depend on where ' +
        'it ran, which makes an archived run impossible to reproduce and impossible to defend.',
      from: { path: ENGINE_SRC },
      to: {
        path:
          '^(node:)?(fs|fs/promises|path|os|http|https|net|dns|tls|dgram|child_process|worker_threads|cluster|process|readline|repl|v8|vm|perf_hooks)$',
      },
    },
    {
      name: 'engine-crypto-only-builtin',
      severity: 'error',
      comment:
        'node:crypto is the single Node builtin the engine may use, for SHA-256 of the ' +
        'canonicalised input document. It performs no I/O and is deterministic. Any other ' +
        'builtin needs the same argument made explicitly, in review.',
      from: { path: ENGINE_SRC },
      to: { path: '^node:(?!crypto$)' },
    },
    {
      name: 'engine-no-app-framework',
      severity: 'error',
      comment:
        'No Prisma, no Next, no React, no database client. These belong to the application in ' +
        'the private repository. If the engine imports one, the open package is no longer ' +
        'usable on its own and the split has quietly collapsed.',
      from: { path: ENGINE_SRC },
      to: {
        path: '^(@prisma|prisma|next|react|react-dom|pg|mysql2|mongodb|redis|ioredis|axios|node-fetch|undici)($|/)',
      },
    },
    {
      name: 'engine-self-contained',
      severity: 'error',
      comment:
        'The engine must not reach into sibling packages or up out of its own directory. It is ' +
        'published on its own, so anything it depends on must be a declared dependency.',
      from: { path: ENGINE_SRC },
      to: { path: '^(packages/(?!engine/)|fixtures/|frameworks/|scripts/|test/)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'A cycle in the engine means the order of evaluation decides the answer, which is the ' +
        'opposite of what a reproducible computation needs.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'An unreachable module is either dead code or a missing wire-up.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$'] },
      to: {},
    },
    {
      name: 'no-dev-dep-in-src',
      severity: 'error',
      comment:
        'Anything the published engine imports at runtime must be a real dependency, not a ' +
        'devDependency that happens to be installed here.',
      from: { path: ENGINE_SRC, pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)(node_modules|dist|coverage)(/|$)' },
    // tsPreCompilationDeps makes type-only imports visible, which matters: `import type
    // { PrismaClient }` is still a dependency on Prisma as far as this boundary is concerned.
    tsPreCompilationDeps: true,
    // No tsConfig on purpose. These rules match module specifiers, not resolved types, and
    // pointing at the engine's tsconfig makes its `extends` resolve against the working
    // directory rather than the file — which fails depending on where CI invokes this from.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.mjs', '.cjs', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
