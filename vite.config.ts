import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(() => {
  return {
    root: projectRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      preserveSymlinks: true,
      alias: {
        '@': path.resolve(projectRoot, '.'),
      },
    },
    build: {
      outDir: 'dist/client',
      target: 'esnext',
      sourcemap: false,
      chunkSizeWarningLimit: 2000,
      reportCompressedSize: false,
      minify: 'terser' as const,
      rollupOptions: {
        output: {
          manualChunks: {
            charts: ['recharts'],
            validation: ['zod'],
          },
        },
      },
    },
    server: {
      fs: { strict: true, allow: [projectRoot] },
      hmr: process.env.DISABLE_HMR !== 'true',
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
