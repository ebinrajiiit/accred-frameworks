import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/version.js';

describe('engine version', () => {
  it('matches package.json', () => {
    // ENGINE_VERSION is a literal rather than an import because the engine must not read
    // files at runtime. This test is what keeps the literal honest.
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    );
    expect(ENGINE_VERSION).toBe(pkg.version);
  });
});
