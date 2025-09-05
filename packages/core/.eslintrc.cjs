module.exports = {
  root: false,
  extends: ['../../.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['import', '@typescript-eslint'],
  rules: {
    // Forbid deep imports into core src; enforce barrel usage
    'import/no-restricted-paths': [
      'error',
      { zones: [{ target: './', from: './packages/core/src' }] },
    ],
  },
};
