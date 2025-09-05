import { defineConfig } from 'vitest/config';
import { join } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      // Allow external code to import the workspace package by name during tests
      '@minamorl/root-core': join(__dirname, 'src', 'index.ts'),
    },
  },
  server: {
    fs: {
      // allow importing files from repo root (outside this package)
      allow: [join(__dirname, '..', '..')],
    },
  },
});
