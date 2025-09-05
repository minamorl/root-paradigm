module.exports = {
  root: true,
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['import'],
  rules: {
    // Forbid deep imports into core src; enforce barrel usage
    'import/no-restricted-paths': [
      'error',
      { zones: [{ target: './', from: './packages/core/src' }] },
    ],
  },
  ignorePatterns: ['packages/core/**/dist/**', 'node_modules/**'],
};

