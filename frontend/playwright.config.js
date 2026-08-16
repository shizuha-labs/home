import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for Shizuha Home E2E tests
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI. Spoken Live is one real call — never two.
  workers: process.env.CI || process.env.SHIZUHA_LIVE_SPOKEN_E2E === '1' ? 1 : undefined,

  // Reporter to use
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  // Shared settings for all the projects below
  use: {
    // Live operator QA talks to production. In-cluster specs still default
    // to the in-cluster nginx name.
    baseURL: process.env.BASE_URL
      || (process.env.SHIZUHA_LIVE_E2E === '1' ? 'https://shizuha.com' : 'http://shizuha-nginx'),

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Video recording
    video: 'on-first-retry',

    // Per-action timeout (15 seconds)
    actionTimeout: 15000,

    // Navigation timeout
    navigationTimeout: 30000,
  },

  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Uncomment to test on more browsers
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  // Spoken Live conversations need a longer wall clock than typed smoke.
  timeout: process.env.SHIZUHA_LIVE_SPOKEN_E2E === '1' ? 20 * 60 * 1000 : 60000,
  globalTimeout: process.env.SHIZUHA_LIVE_SPOKEN_E2E === '1' ? 45 * 60 * 1000 : 10 * 60 * 1000,

  // Expect timeout
  expect: {
    timeout: 10000
  },
})
