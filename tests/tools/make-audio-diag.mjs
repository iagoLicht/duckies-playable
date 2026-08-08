#!/usr/bin/env node
/**
 * Produce a DIAGNOSTIC variant of a built artifact for on-device audio
 * debugging: dist/duckies_audio_diag.html is the shipped file plus a badge
 * overlay reporting what the device's audio stack is actually doing —
 * context state, audio-session category, decode and voice counts, errors.
 *
 *   node tests/tools/make-audio-diag.mjs [dist/duckies_timer_lose_rigged.html]
 *
 * Pure post-processing: the injected script patches AudioContext & co BEFORE
 * the game evaluates, so the product build stays free of diagnostic code.
 * The badge is for a human eye on a phone with no devtools — big text, live.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = process.argv[2] ?? 'dist/duckies_timer_lose_rigged.html';
const out = 'dist/duckies_audio_diag.html';

const DIAG = `<script>
(() => {
  const d = { ctx: 0, state: 'none', starts: 0, decodes: 0, fails: 0, kicked: 0, err: '' };
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:rgba(0,0,0,.75);'
    + 'color:#0f0;font:12px/1.5 monospace;padding:6px 8px;pointer-events:none;white-space:pre';
  const show = () => {
    // the artifact is a self-extractor: document.write replaces the whole DOM
    // after unpack, so the badge re-attaches itself instead of trusting any
    // one document's lifecycle (window globals like this interval survive)
    if (!box.isConnected && document.body) document.body.appendChild(box);
    const sess = navigator.audioSession ? navigator.audioSession.type : 'no-api';
    box.textContent = 'AUDIO ' + d.state + '  session:' + sess
      + '\\nctx:' + d.ctx + ' decoded:' + d.decodes + '/' + (d.decodes + d.fails)
      + ' voices:' + d.starts + ' kicks:' + d.kicked + (d.err ? '\\nERR ' + d.err : '');
  };
  setInterval(show, 300);
  window.addEventListener('error', (e) => { d.err = String(e.message).slice(0, 80); });
  const AC = window.AudioContext || window.webkitAudioContext;
  const Wrapped = class extends AC {
    constructor(...a) {
      super(...a);
      d.ctx++; d.state = this.state;
      this.addEventListener('statechange', () => { d.state = this.state; });
    }
  };
  if (window.AudioContext) window.AudioContext = Wrapped;
  if (window.webkitAudioContext) window.webkitAudioContext = Wrapped;
  const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) {
    // the unlock ritual starts a 1-frame silent source; count it apart
    if (this.buffer && this.buffer.length === 1) d.kicked++; else d.starts++;
    return st.apply(this, a);
  };
  const dec = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (...a) {
    return dec.apply(this, a).then(
      (b) => { d.decodes++; return b; },
      (e) => { d.fails++; d.err = 'decode: ' + e; throw e; },
    );
  };
})();
</script>`;

const html = readFileSync(src, 'utf8');
const marker = /<head[^>]*>/i;
if (!marker.test(html)) {
  console.error(`${src}: no <head> to inject after`);
  process.exit(1);
}
writeFileSync(out, html.replace(marker, (m) => m + DIAG));
console.log(`${src} + badge -> ${out}`);
