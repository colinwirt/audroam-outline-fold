import { defineConfig, devices } from '@playwright/test';

/**
 * Real-browser stability gate (0.2.16+). Default: serves the locally built
 * site/ (npm run build:site:e2e) under the Pages prefix /audroam-outline-fold/.
 * Set E2E_BASE_URL (e.g. https://colinwirt.github.io/audroam-outline-fold/) to
 * run the same specs against a deployed Pages site.
 */
const PORT = Number(process.env.E2E_PORT || 4599);
const external = process.env.E2E_BASE_URL;
const baseURL = external
  ? external.endsWith('/') ? external : external + '/'
  : `http://127.0.0.1:${PORT}/audroam-outline-fold/`;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: external ? './e2e/wait-for-deploy.ts' : undefined,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: {
    baseURL,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1400, height: 900 } },
    },
  ],
  webServer: external
    ? undefined
    : {
        command: `node scripts/serve-site.mjs --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      },
});
