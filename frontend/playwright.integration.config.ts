import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./integration",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  webServer: [
    {
      command: "GED_E2E_TEST_MODE=1 ../.venv/bin/python ../backend/tests/e2e_server.py",
      url: "http://127.0.0.1:8765/api/session/",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "BACKEND_URL=http://127.0.0.1:8765 npm run dev -- --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
      timeout: 120000,
    },
  ],
  use: {
    baseURL: "http://127.0.0.1:5175",
    launchOptions: { executablePath: process.env.CHROME_BIN || undefined },
  },
});
