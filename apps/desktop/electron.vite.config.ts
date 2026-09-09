import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// electron-vite runs the renderer with Vite `root` set to `src/renderer`, so Vite's
// filesystem search for a postcss.config.js starts (and stays) there — a
// postcss.config.js sitting in this package's own root would be silently ignored.
// See src/renderer/postcss.config.js, which is where Vite actually finds it, and
// which explicitly points at ../../tailwind.config.js so there is no ambiguity.
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') },
    },
    plugins: [react()],
  },
});
