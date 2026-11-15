import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    },
    actionTimeout: 10000,
    navigationTimeout: 20000,
  },
  webServer: {
    command: 'pnpm --filter @lexistream/web preview --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 60000,
  },
});
