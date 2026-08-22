import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@madeup-video/contracts': fileURLToPath(
        new URL('../../libs/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3200,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 3200,
  },
  build: {
    outDir: '../../dist/apps/admin',
    emptyOutDir: true,
  },
});
