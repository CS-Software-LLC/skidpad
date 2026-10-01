import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./browser",
  testMatch: /.*\.spec\.ts/,
  timeout: 120_000,
  fullyParallel: false,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Environments that ship their own Chromium (no CDN access) can
        // point at it; CI uses the Playwright-managed build.
        ...(process.env.SKIDPAD_CHROMIUM_PATH
          ? { launchOptions: { executablePath: process.env.SKIDPAD_CHROMIUM_PATH } }
          : {}),
      },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
