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
  preview: {
    // `vite preview` is how builds get tested on real phones over the LAN, and
    // without this a phone quietly re-serves yesterday's cached artifact on
    // refresh (no Cache-Control means heuristic freshness) — a rebuilt test
    // build then "still has the bug" on the device. Never cache test serves.
    headers: { 'Cache-Control': 'no-store' },
    // …and the same test serves get tunnelled out to remote testers through
    // Cloudflare quick tunnels (cloudflared tunnel --url), whose random
    // *.trycloudflare.com hostnames vite would otherwise refuse
    allowedHosts: ['.trycloudflare.com'],
  },
});
