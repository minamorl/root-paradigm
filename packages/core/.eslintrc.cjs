module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2022: true, node: true },
  overrides: [
    {
      files: ['*.test.ts', '*.property.test.ts'],
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly' },
    },
  ],
};
