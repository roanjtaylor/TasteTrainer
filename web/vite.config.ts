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
    // The local backend serves /api.
    proxy: {
      '/api': 'http://localhost:5174',
    },
  },
});
