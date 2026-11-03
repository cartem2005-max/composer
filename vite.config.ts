import { defineConfig, loadEnv, type Plugin } from 'vite';

// Локально /api/pick обслуживает та же функция, что и на Vercel, — чтобы проверять ИИ до выкладки.
function localApi(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      Object.assign(process.env, loadEnv('development', process.cwd(), ''));
      server.middlewares.use('/api/pick', async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body: unknown = {};
        try { body = JSON.parse(raw || '{}'); } catch { /* пустое тело — функция ответит 400 */ }
        const { default: handler } = await server.ssrLoadModule('/api/pick.ts');
        const shim = {
          status(code: number) { res.statusCode = code; return shim; },
          json(data: unknown) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); },
        };
        await handler({ method: req.method, headers: req.headers, body }, shim);
      });
    },
  };
}

export default defineConfig({
  plugins: [localApi()],
  // Файлы с ключами не отслеживаем: Блокнот держит их открытыми, и наблюдатель падал с EBUSY.
  server: { watch: { ignored: ['**/.env*', '**/env.local', '**/tests/report-*'] } },
  build: { rollupOptions: { input: 'index.html' } },
});
