import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PW = process.env.FRONTEND_PASSWORD || (() => {
  try { return fs.readFileSync('/data/home/oc-import/Stragy/opencode-app-data/password.txt', 'utf8').trim(); }
  catch { return ''; }
})();

export default defineConfig({
  testDir: __dirname,
  testMatch: 'frontend.e2e.spec.ts',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4300',
    httpCredentials: { username: 'opencode', password: PW },
    permissions: ['microphone'],
    trace: 'off',
    screenshot: 'off',
    viewport: { width: 1440, height: 900 },
    ...devices['Desktop Chrome'],
    // Fake mic lets the realtime probe reach the API (where credits are 503)
    // instead of stopping at getUserMedia in headless Chromium.
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 } },
  ],
});
