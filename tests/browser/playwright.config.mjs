// Playwright config for tests/browser (not run on the PC this was written on; see pay.spec.mjs).
export default {
  testDir: ".",
  testMatch: /.*\.spec\.mjs$/,
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium", headless: true },
};
