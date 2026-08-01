// dist/index.html (everything inlined by vite) -> dist/duckies-pop-playable.html:
// a gzip self-extractor, the same technique as the reference examples (~45% smaller).
// The plain dist/index.html is kept as a no-DecompressionStream fallback deliverable.
import fs from 'node:fs';
import zlib from 'node:zlib';

const src = 'dist/index.html';
const out = 'dist/duckies-pop-playable.html';
const html = fs.readFileSync(src);
const b64 = zlib.gzipSync(html, { level: 9 }).toString('base64');

const wrapper =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">' +
  '<title>Duckies Pop</title><style>html,body{margin:0;height:100%;background:#f8dfe4}</style></head><body>' +
  '<script>(async()=>{const b="' + b64 + '";' +
  'const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);' +
  'const t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();' +
  'document.open();document.write(t);document.close();})();</script></body></html>';

fs.writeFileSync(out, wrapper);
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
console.log(`${src}: ${mb(html.length)}  ->  ${out}: ${mb(wrapper.length)}`);
const CEILING = 5_000_000; // decimal MB — the number ad networks actually use
if (wrapper.length > CEILING) {
  console.error(`FAIL: over the 5 MB ceiling`);
  process.exit(1);
}
