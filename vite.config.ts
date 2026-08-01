import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  // .skel is binary, .atlas is text — both must be importable as assets
  assetsInclude: ['**/*.skel', '**/*.atlas'],
  build: {
    target: 'es2020',
    // inline EVERY imported asset as a data: URI — this is what makes the single file possible
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    chunkSizeWarningLimit: 8192,
  },
  plugins: [viteSingleFile()],
});
