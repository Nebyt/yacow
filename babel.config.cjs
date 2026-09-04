// Used only by jest (via babel-jest). Runtime uses tsc output in dist/.
module.exports = {
  presets: [
    ['@babel/preset-env', { targets: { node: 'current' } }],
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ],
  // yoga-layout (Ink's layout engine) ships an ESM WASM loader using
  // `import.meta.url`; rewrite it so babel can transpile the dep to CJS for jest.
  plugins: ['babel-plugin-transform-import-meta'],
};
