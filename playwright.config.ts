import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const port = 3101;
const studioOrigin = `http://127.0.0.1:${port}`;
const previewOrigin = `http://localhost:${port}`;
const workspace = join(process.cwd(), "test-results", "workspace");
const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/*strict*.spec.ts",
  outputDir: "test-results/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["line"], ["html", { open: "never" }]]
    : [["line"]],
  use: {
    baseURL: studioOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "pnpm --dir server start",
    url: `${studioOrigin}/api/health`,
    timeout: 30_000,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      HOST: "127.0.0.1",
      PRESET_STUDIO_WORKSPACE: workspace,
      PRESET_STUDIO_STATIC_ROOT: join(process.cwd(), "dist"),
      PRESET_STUDIO_PREVIEW_ORIGIN: previewOrigin,
      PRESET_STUDIO_PREVIEW_PARENT_ORIGINS: studioOrigin,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumExecutable ? { launchOptions: { executablePath: chromiumExecutable } } : {}),
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
