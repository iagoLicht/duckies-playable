// dist/index.html (everything inlined by vite) -> dist/duckies-pop-playable.html:
// a gzip self-extractor, the same technique as the reference examples (~45% smaller).
// The plain dist/index.html is kept as a no-DecompressionStream fallback deliverable.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const src = 'dist/index.html';
const out = 'dist/duckies-pop-playable.html';

// The "single file" claim only holds if vite inlined everything — fail loudly if
// any asset escaped into dist/ as a sibling file.
const stray = fs.readdirSync('dist').filter((f) => f !== 'index.html' && f !== path.basename(out));
if (stray.length > 0) {
  console.error(`FAIL: build is not self-contained, stray files in dist/: ${stray.join(', ')}`);
  process.exit(1);
}

const html = fs.readFileSync(src);
const b64 = zlib.gzipSync(html, { level: 9 }).toString('base64');

// Payload is base64 (no "</script>" possible); the fallback message is plain ASCII.
const wrapper =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">' +
  '<title>Duckies Pop</title><style>html,body{margin:0;height:100%;background:#f8dfe4}</style></head><body>' +
  '<script>(async()=>{try{' +
  'if(!("DecompressionStream" in self))throw new Error("no DecompressionStream");' +
  'const b="' + b64 + '";' +
  'const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);' +
  'const t=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();' +
  'document.open();document.write(t);document.close();' +
  '}catch(e){document.body.innerHTML=' +
  '"<p style=\'font:16px sans-serif;padding:24px\'>This build needs a newer browser. Please use the uncompressed index.html.</p>";}' +
  '})();</script></body></html>';

const bytes = Buffer.byteLength(wrapper);
const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
console.log(`${src}: ${mb(html.length)}  ->  ${out}: ${mb(bytes)}`);

const CEILING = 5_000_000; // decimal MB — the number ad networks actually use
if (bytes > CEILING) {
  console.error(`FAIL: over the 5 MB ceiling`);
  process.exit(1); // nothing written — a failed build must not leave a fake deliverable
}
fs.writeFileSync(out, wrapper);
