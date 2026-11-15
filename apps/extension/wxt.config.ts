import { defineConfig } from 'wxt';
import path from 'node:path';

export default defineConfig({
  modulesDir: 'wxt-modules',
  manifest: {
    name: 'LexiStream — Contextual Language Learning',
    description:
      'Lightweight, local-first interactive YouTube subtitles with contextual translations and FSRS vocabulary capture.',
    version: '0.1.0',
    permissions: ['storage'],
    host_permissions: ['*://*.youtube.com/*'],
  },
  vite: () => ({
    esbuild: {
      jsx: 'automatic',
      jsxImportSource: 'preact',
    },
    resolve: {
      alias: {
        '@lexistream/shared-types': path.resolve(
          __dirname,
          '../../packages/shared-types/src/index.ts',
        ),
        '@lexistream/language-core': path.resolve(
          __dirname,
          '../../packages/language-core/src/index.ts',
        ),
        '@lexistream/translation-providers': path.resolve(
          __dirname,
          '../../packages/translation-providers/src/index.ts',
        ),
        '@lexistream/vocabulary-engine': path.resolve(
          __dirname,
          '../../packages/vocabulary-engine/src/index.ts',
        ),
        '@lexistream/flashcard-engine': path.resolve(
          __dirname,
          '../../packages/flashcard-engine/src/index.ts',
        ),
      },
    },
  }),
});
