import { defineConfig } from "@playwright/test";

const port = process.env.TEST_PORT || "3000";
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  globalTeardown: "./e2e/global-teardown.ts",
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    screenshot: "only-on-failure",
    video: "on-first-retry",
    trace: "on-first-retry",
  },
  webServer: {
    command: `PORT=${port} NODE_ENV=test pnpm run dev`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
