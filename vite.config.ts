import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));

function legalFilesPlugin(): Plugin {
  return {
    name: 'legal-files',
    apply: 'build',
    generateBundle() {
      for (const fileName of ['LICENSE', 'THIRD_PARTY_NOTICES.md']) {
        this.emitFile({
          type: 'asset',
          fileName,
          source: readFileSync(resolve(HERE, fileName), 'utf8'),
        });
      }
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the build runs from any path — the repo subdirectory
  // GitHub Pages serves a project site from (/<repo>/) as well as a domain root.
  // The app is a single page with no client-side routes, so there is nothing to
  // deep-link and no SPA fallback to configure.
  base: './',
  plugins: [react(), legalFilesPlugin()],
  server: { port: 5173 },
  build: {
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom/client', 'zustand'],
          'vendor-fflate': ['fflate'],
        },
      },
    },
    // Never base64-inline a font. The two smallest subsets (cyrillic-ext) fall
    // under the default 4 kB threshold, and inlining them would push bytes for
    // glyphs almost nothing renders into the render-blocking stylesheet —
    // exactly what the per-subset unicode-range split exists to avoid.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.woff2') ? false : undefined),
  },
});
