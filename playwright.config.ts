import { defineConfig } from '@playwright/test';

const CI = !!process.env.CI;
// In restricted environments point this at an installed Chromium; on CI the browser is installed by Playwright.
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  timeout: 90_000,
  workers: CI ? 2 : 3,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    serviceWorkers: 'block',
    launchOptions: { executablePath },
    trace: 'retain-on-failure',
  },
  // Build first with `npm run e2e` (it runs e2e/build.mjs). Both apps are served with the production security headers.
  webServer: [
    { command: 'node e2e/serve.mjs dist-e2e 4173', url: 'http://localhost:4173', reuseExistingServer: !CI },
    { command: 'node e2e/serve.mjs dist-e2e-cloud 4174', url: 'http://localhost:4174', reuseExistingServer: !CI, env: { CSP_EXTRA_CONNECT: 'http://localhost:4600' } },
    { command: 'node e2e/mock-server.mjs', url: 'http://localhost:4600/__admin/state', reuseExistingServer: !CI },
  ],
});
