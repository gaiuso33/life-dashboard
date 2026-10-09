import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// viteSingleFile bundles everything into one dist/index.html, which is easy to
// open or share. Remove it later if you want a normal multi-file build.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
});
