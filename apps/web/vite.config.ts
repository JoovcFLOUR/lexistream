import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
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
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        youtubeFixture: path.resolve(__dirname, 'youtube-fixture.html'),
      },
    },
  },
});
