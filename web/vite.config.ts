import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    // Allow importing the shared types from the project root (outside web/).
    fs: { allow: [path.resolve(__dirname, '..')] },
    // The local backend serves /api. Target 127.0.0.1 (not "localhost") so the
    // proxy connects over IPv4 — on Windows "localhost" can resolve to IPv6 ::1
    // while the server listens on IPv4, producing "ECONNREFUSED ::1:5174".
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
        // Debug: log proxy failures (backend down/unreachable) and forwards so
        // it's obvious in the terminal when /api can't reach the server.
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error(
              `[proxy] ${req.method} ${req.url} -> ${err.message}. Is the [server] running on 5174?`,
            );
          });
          proxy.on('proxyReq', (_pr, req) => console.log(`[proxy] -> ${req.method} ${req.url}`));
        },
      },
    },
  },
});
