import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const apiPort = 3102;
const webPort = 4174;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const studioOrigin = `http://127.0.0.1:${webPort}`;
const previewOrigin = `http://localhost:${apiPort}`;
const workspace = join(process.cwd(), "test-results", "strict-workspace");
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*strict*.spec.ts",
  outputDir: "test-results/strict-artifacts",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: studioOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm --dir server start",
      url: `${apiOrigin}/api/health`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        PORT: String(apiPort),
        HOST: "127.0.0.1",
        PRESET_STUDIO_WORKSPACE: workspace,
        PRESET_STUDIO_STATIC_ROOT: join(process.cwd(), "dist"),
        PRESET_STUDIO_PREVIEW_ORIGIN: previewOrigin,
        PRESET_STUDIO_PREVIEW_PARENT_ORIGINS: studioOrigin,
      },
    },
    {
      command: `pnpm exec vite --host 127.0.0.1 --port ${webPort}`,
      url: studioOrigin,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        PRESET_STUDIO_DEV_API_TARGET: apiOrigin,
      },
    },
  ],
  projects: [{
    name: "chromium-strict",
    use: {
      ...devices["Desktop Chrome"],
      ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
    },
  }],
});
