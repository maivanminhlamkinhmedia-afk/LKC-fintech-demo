import { defineConfig, devices } from '@playwright/test'

// Discovery is side-effect free. Only the explicit guarded staging wrapper may
// start the app, create fixtures or supply session credentials.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/cms-*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  reporter: [['./tests/e2e/safe-reporter.mjs']],
  outputDir: 'test-results',
  preserveOutput: 'never',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'off', video: 'off', screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } }],
})
