// Engine tests (crypto/net/security/config) run with zero extra config.
// UI tests import Ink (ESM-only), so we let babel transpile those ESM deps too
// via the transformIgnorePatterns allowlist below.
const esmDeps = [
  'ink',
  'ink-testing-library',
  'chalk',
  'ansi-escapes',
  'ansi-styles',
  'auto-bind',
  'cli-boxes',
  'cli-cursor',
  'cli-truncate',
  'code-excerpt',
  'convert-to-spaces',
  'emoji-regex',
  'environment',
  'escape-string-regexp',
  'indent-string',
  'is-in-ci',
  'is-fullwidth-code-point',
  'mimic-fn',
  'onetime',
  'patch-console',
  'restore-cursor',
  'signal-exit',
  'slice-ansi',
  'string-width',
  'strip-ansi',
  'type-fest',
  'widest-line',
  'wrap-ansi',
  'ws',
  'yoga-layout',
];

module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  transformIgnorePatterns: [`node_modules/(?!(${esmDeps.join('|')})/)`],
  // TS ESM source imports use ".js" specifiers; strip them so jest resolves the .ts source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Engine tests only. UI (Ink) render tests run via `bun run smoke` (node ESM)
  // because Ink 5's yoga-layout dep is ESM-only (top-level await + import.meta)
  // and cannot be transpiled to babel-jest's CJS. See scripts/smoke.mjs.
  testMatch: ['**/*.test.ts'],
};
