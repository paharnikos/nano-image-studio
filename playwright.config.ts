import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { baseURL: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '3100'}`, viewport: { width: 1600, height: 1000 }, launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/google-chrome', args: ['--no-sandbox'] }, screenshot: 'only-on-failure' },
  webServer: { command: `npm run ${process.env.PLAYWRIGHT_PRODUCTION ? "start" : "dev"} -- -H 127.0.0.1 -p ${process.env.PLAYWRIGHT_PORT || '3100'}`, url: `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT || '3100'}`, reuseExistingServer: !process.env.CI, timeout: 120000 },
});
