import { defineConfig } from '@playwright/test';

// E2E-тесты запускают собственный dev-сервер на порту 5181 и используют установленный Google Chrome.
// Браузеры Playwright не скачиваются. Запрос /api/pick в тестах всегда подменяется (page.route).
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  workers: 4,
  // 1 повтор: в src параллельно правятся файлы, и dev-сервер может перезагрузить страницу посреди теста.
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5181',
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
    acceptDownloads: true,
    locale: 'ru-RU',
    trace: 'off',
  },
  webServer: {
    command: 'npx vite --port 5181 --strictPort',
    port: 5181,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
