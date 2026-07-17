import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test",
  testMatch: "extension.spec.js",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: {
    timeout: 10000
  },
  reporter: [["list"]],
  outputDir: "test-results",
  use: {
    trace: "retain-on-failure"
  },
  webServer: {
    command: "node scripts/serve-fixtures.mjs",
    url: "http://127.0.0.1:4173/health",
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe"
  }
});
