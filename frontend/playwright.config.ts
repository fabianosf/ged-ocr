import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  webServer: {
    command: "npm run build && npm run preview -- --host 127.0.0.1 --port 5174",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5174",
    launchOptions: {
      executablePath: process.env.CHROME_BIN || undefined,
    },
  },
});
