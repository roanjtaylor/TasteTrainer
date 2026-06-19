import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwind()],
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
