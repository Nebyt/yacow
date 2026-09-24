// Engine tests (crypto/net/security/config/wallet) run on jest.
// UI render tests use OpenTUI's test renderer via `bun run smoke`.
module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': 'babel-jest',
  },
  // TS ESM source imports use ".js" specifiers; strip them so jest resolves the .ts source.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/*.test.ts'],
};
