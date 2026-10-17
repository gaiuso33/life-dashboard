import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import type { Plugin, ResolvedConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Gives public/sw.js a different build id on every build. A browser only installs a new service worker when the file's
 * bytes change, so without this an update to the app alone is never noticed by phones that already have it installed.
 * Vercel's commit id is used when there is one (so the same commit always gets the same id); otherwise the build time.
 */
function stampServiceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    closeBundle() {
      const file = path.resolve(config.root, config.build.outDir, 'sw.js');
      if (!fs.existsSync(file)) return;
      const id = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 12) || Date.now().toString(36);
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('__BUILD_ID__', id));
    },
  };
}

// viteSingleFile bundles everything into one dist/index.html, which is easy to
// open or share. Remove it later if you want a normal multi-file build.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile(), stampServiceWorker()],
});
