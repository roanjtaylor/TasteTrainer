import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';

// public/embed-tester.html is plain static HTML outside the bundle, so it can't read
// import.meta.env. This serves/emits /embed-config.js carrying the same API base the
// app uses (empty in dev, where the /api proxy below applies).
function embedTesterConfig(): Plugin {
  let body = '';
  return {
    name: 'embed-tester-config',
    configResolved(config) {
      body = `window.__API_BASE__=${JSON.stringify(config.env.VITE_API_BASE_URL ?? '')};`;
    },
    configureServer(server) {
      server.middlewares.use('/embed-config.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(body);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'embed-config.js', source: body });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwind(), embedTesterConfig()],
  server: {
    port: 5173,
    // Auto-open the app in the default browser on `npm run dev` (once, on first
    // start — not on hot reloads). This is the UI; the backend on :5174 is API-only,
    // so the browser must land here on :5173.
    open: true,
    // Allow importing the shared types from the project root (outside web/).
    fs: { allow: [path.resolve(__dirname, '..')] },
    // The local backend serves /api. Target 127.0.0.1 (not "localhost") so the
    // proxy connects over IPv4 — on Windows "localhost" can resolve to IPv6 ::1
    // while the server listens on IPv4, producing "ECONNREFUSED ::1:5174".
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
    },
  },
});
