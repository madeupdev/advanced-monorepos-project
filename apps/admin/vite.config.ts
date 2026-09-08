import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { readAdminDevelopmentConfig } from './config';

const { adminPort } = readAdminDevelopmentConfig();

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@madeup-video/contracts': fileURLToPath(
        new URL('../../libs/contracts/src/index.ts', import.meta.url),
      ),
      '@madeup-video/ui': fileURLToPath(
        new URL('../../libs/ui/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: adminPort,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: adminPort,
  },
  build: {
    outDir: '../../dist/apps/admin',
    emptyOutDir: true,
  },
});
