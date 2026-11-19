import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Separate build for the custom Stragy frontend. The stock app (index.html ->
 * dist/client) is untouched; this emits dist/frontend/index.html.
 */
export default defineConfig({
  root: projectRoot,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'stragy-frontend-html-name',
      generateBundle(_options, bundle) {
        if (bundle['frontend.html']) {
          bundle['index.html'] = bundle['frontend.html'];
          bundle['index.html'].fileName = 'index.html';
          delete bundle['frontend.html'];
        }
      },
    },
  ],
  resolve: {
    preserveSymlinks: true,
    alias: { '@': path.resolve(projectRoot, '.') },
  },
  build: {
    outDir: 'dist/frontend',
    emptyOutDir: true,
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    reportCompressedSize: false,
    minify: 'terser' as const,
    rollupOptions: {
      input: path.resolve(projectRoot, 'frontend.html'),
    },
  },
});
