import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  resolve: {
    alias: {
      '@lexistream/shared-types': path.resolve(__dirname, 'packages/shared-types/src/index.ts'),
      '@lexistream/language-core': path.resolve(__dirname, 'packages/language-core/src/index.ts'),
      '@lexistream/translation-providers': path.resolve(__dirname, 'packages/translation-providers/src/index.ts'),
      '@lexistream/vocabulary-engine': path.resolve(__dirname, 'packages/vocabulary-engine/src/index.ts'),
      '@lexistream/flashcard-engine': path.resolve(__dirname, 'packages/flashcard-engine/src/index.ts'),
    },
  },
  test: {
    globals: false,
    environment: 'happy-dom',
    include: [
      'packages/**/*.test.ts',
      'apps/**/*.test.ts',
      'apps/**/*.test.tsx',
      'benchmarks/**/*.test.ts',
    ],
    setupFiles: ['./tests/setup-vitest.ts'],
  },
});
