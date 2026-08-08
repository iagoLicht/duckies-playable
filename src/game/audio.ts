import { SIM } from '../sim/config';

import launchPullUrl from '../assets/sfx/clips/launch-pull.mp3';
import launchReleaseUrl from '../assets/sfx/clips/launch-release.mp3';
import duckBumpUrl from '../assets/sfx/clips/duck-bump.mp3';
import duckExplodeUrl from '../assets/sfx/clips/duck-explode.mp3';
import matchCollisionUrl from '../assets/sfx/clips/match-collision.mp3';
import mergeDoneUrl from '../assets/sfx/clips/merge-done.mp3';
import spawnSplooshUrl from '../assets/sfx/clips/spawn-sploosh.mp3';
import candyHitUrl from '../assets/sfx/clips/candy-hit.mp3';
import candySmashUrl from '../assets/sfx/clips/candy-smash.mp3';
import winWhooshUrl from '../assets/sfx/clips/win-whoosh.mp3';
import uiClickUrl from '../assets/sfx/clips/ui-click.mp3';
// merge-swirl.mp3 is staged but deliberately NOT imported: it is a 3.1s
// anticipation riser for a merge mechanic this game does not have, and Vite only
// inlines what is imported, so leaving it out costs the build nothing.

/**
 * The playable's whole sound layer: loading, autoplay unlock, per-clip gain and
 * pitch, voice limiting, and a master mute. View-side only — nothing in
 * `src/sim` may import this, and this imports only `SIM` (for the two physics
 * constants the speed→gain curve is normalised against).
 *
 * Web Audio rather than HTMLAudioElement: `duckBump` fires up to 6 times in a
 * 100 ms window (measured, see VOICES) and pooled <audio> elements do not
 * overlap reliably at that rate, nor can they be pitch-varied per shot.
 *
 * ── the clips ──────────────────────────────────────────────────────────────
 * All twelve are the studio's own sounds, extracted from ballblast's
 * inGame-audio.bank (see the pack's sfx/sfx-event-map.json). Every mapping below
 * follows that file's stated trigger unless the comment says otherwise; the
 * departures are named, because guessing an asset's purpose from its filename is
 * the mistake this project keeps having to undo.
 */

/** How the mix is levelled. */
type VoiceName =
  | 'launchPull' | 'launchRelease'
  | 'duckBump' | 'wallBump' | 'clamBump'
  | 'duckMatch' | 'duckExplode' | 'duckSettle'
  | 'crateHit' | 'crateSmash'
  | 'clamCrack' | 'pointWhoosh'
  | 'uiClick';

interface VoiceDef {
  url: string;
  /** linear gain — see the derivation table above VOICES */
  gain: number;
  /** shortest interval between two plays of THIS voice, ms */
  minGapMs: number;
  /** concurrent sources of this voice; further requests are dropped, not stolen */
  maxVoices: number;
  /** playbackRate is jittered by +/- this much per shot (0 = fixed pitch) */
  jitter: number;
}

/**
 * MEASURED LEVELS. Each clip's "punch" is the loudest RMS over a sliding window
 * of min(100 ms, clip length) — the level a one-shot actually reads at, which
 * whole-file RMS gets wrong for anything with a tail (candy-hit) and the 400 ms
 * EBU R128 gate cannot see at all for anything shorter than it (7 of the 12
 * clips return -70 LUFS). Windowing to the clip length is what keeps the 17 ms
 * ui-click from measuring 7.7 dB quieter than it sounds.
 *
 *   clip              punch dB   peak dBFS
 *   candy-hit           -9.51       0.0
 *   duck-bump           -9.73       0.0
 *   merge-done         -11.30       0.0
 *   win-whoosh         -12.21      -0.9
 *   candy-smash        -12.79      -0.5
 *   launch-release     -13.69      -0.1
 *   duck-explode       -14.57      -0.0
 *   match-collision    -17.35      -0.1
 *   launch-pull        -22.85      -1.1
 *   ui-click           -22.86      -5.6
 *   spawn-sploosh      -23.66      -0.7
 *
 * `gain` is then 10^((target - punch)/20) for a target picked by the sound's
 * ROLE in the mix, anchored so the payoff (duck-explode) sits at unity:
 *
 *   payoff        -14.6 dB  duckExplode
 *   goal beat     -15.6 dB  crateSmash, clamCrack
 *   score         -16.6 dB  pointWhoosh
 *   shot          -17.1 dB  launchRelease
 *   match         -17.6 dB  duckMatch
 *   support       -18.6 dB  crateHit
 *   aim           -19.6 dB  launchPull
 *   ui            -20.6 dB  uiClick
 *   settle        -21.6 dB  duckSettle
 *   tick          -21.6 dB  duckBump
 *   tick (clam)   -24.6 dB  clamBump
 *   tick (wall)   -26.6 dB  wallBump
 *
 * The three tick voices share ONE buffer at three levels: duck-on-duck is the
 * event the clip was authored for, so it keeps the loudest seat; the clam and
 * the tub wall are substitutions (see WALL/CLAM notes) and are pushed down until
 * they read as texture rather than as events in their own right.
 *
 * `minGapMs` and `maxVoices` come from the measured burst density of the driving
 * SimEvent over all 10 levels x 15 bot seeds (shots/event-density.mjs), in
 * events per 100 ms window: duckBumped 6 max / 3 at p99, wallHit 5, bumperHit 6,
 * duckPopped 4, duckMatched 4, duckStopped 2, barrelDamaged 2, barrelDestroyed 2,
 * clamOpened 3, pearlCollected 2.
 */
const VOICES: Record<VoiceName, VoiceDef> = {
  // event map: "grab/pull a floating duck to aim". View-side; there is no sim
  // event for a grab and none is needed.
  launchPull: { url: launchPullUrl, gain: 1.45, minGapMs: 120, maxVoices: 1, jitter: 0 },
  // event map: "release: the duck fires" -> duckLaunched
  launchRelease: { url: launchReleaseUrl, gain: 0.68, minGapMs: 0, maxVoices: 2, jitter: 0 },
  // event map: "duck-duck bounce (different colour / collision)" -> duckBumped.
  // 50 ms == 3 fixed steps: the shortest gap at which two bounces are separate
  // events on the sim's own clock rather than one contact resolved across
  // substeps. Thins only the p99+ pile-ups (6/100 ms) and leaves the p90 pair.
  // "pitch-varied" is the event map's own note on this sound.
  duckBump: { url: duckBumpUrl, gain: 0.26, minGapMs: 50, maxVoices: 4, jitter: 0.14 },
  // SUBSTITUTION, flagged: the pack ships NO wall clip and the event map has no
  // wall entry at all. A silent ricochet off the tub reads as a bug in a game
  // whose own tutorial video is about wall bounces, so the studio's bump sample
  // stands in, pitched down and 5 dB under the clam so it sits as texture.
  wallBump: { url: duckBumpUrl, gain: 0.143, minGapMs: 50, maxVoices: 3, jitter: 0.1 },
  // SUBSTITUTION, flagged: event map "InGame_Sfx_Entities_Bumper_Hit" (springy
  // pinball ping) is priority `nice` and no clip was extracted for it, so the
  // bump sample stands in here too, 3 dB under the duck-on-duck tick.
  clamBump: { url: duckBumpUrl, gain: 0.181, minGapMs: 50, maxVoices: 3, jitter: 0.12 },
  // event map: "same-colour match forms (collide + flag)" -> duckMatched.
  // A contact match flags BOTH ducks on the same tick, so 140 ms collapses the
  // pair into the one sound it actually is while still letting the two genuinely
  // separate matches per second (measured max) through.
  duckMatch: { url: matchCollisionUrl, gain: 0.97, minGapMs: 140, maxVoices: 2, jitter: 0 },
  // event map: "a matched duck explodes (fuse end)" -> duckPopped
  // Loosest gate of the lot, on purpose: this is the payoff, and a chain
  // generation that dooms four ducks pops them on the same tick. 40 ms lets
  // three of those four layer into one bigger bang (pitch-jittered, so they do
  // not phase) instead of collapsing to a single pop. At 70 ms the browser probe
  // was dropping a third of all explosions, which undersold every chain.
  duckExplode: { url: duckExplodeUrl, gain: 1.0, minGapMs: 40, maxVoices: 5, jitter: 0.08 },
  // event map: "a duck settles / respawns into the pool" -> duckStopped, which
  // is the FMOD entry's reading too ("fired duck lands and is added into the
  // water cluster").
  duckSettle: { url: spawnSplooshUrl, gain: 1.27, minGapMs: 90, maxVoices: 3, jitter: 0.06 },
  // event map: "candy jar hit" -> barrelBumped (and barrelDamaged when a blast,
  // which touches nothing, takes a stage). Our crate is this game's destructible
  // goal entity, i.e. the candy's role. It rides the contact rather than the
  // damage now, so it plays on every touch — scaled by impactGain, and the
  // minGap/maxVoices below stop a cluster of crates from stacking clicks.
  crateHit: { url: candyHitUrl, gain: 0.35, minGapMs: 120, maxVoices: 2, jitter: 0.06 },
  // event map: "candy (goal) is smashed" -> barrelDestroyed
  crateSmash: { url: candySmashUrl, gain: 0.72, minGapMs: 90, maxVoices: 3, jitter: 0.06 },
  // SUBSTITUTION, flagged: merge-done is "4-match -> Fire Ducky spawns", and
  // this game has no merge. Its FMOD entry describes the character we want
  // though — "resolution stinger… pop + confirm ding" — and the clam cracking
  // open to spill a pearl is this game's equivalent reward beat.
  clamCrack: { url: mergeDoneUrl, gain: 0.61, minGapMs: 140, maxVoices: 2, jitter: 0 },
  // event map: "win / score celebration on the end-card". Its SOURCE file is
  // sfx_ui_pointWhoosh_01.wav — a points-fly-to-the-counter whoosh — so it plays
  // on pearlCollected (the pearl landing on the HUD counter, which is literally
  // that) as well as on levelCleared.
  pointWhoosh: { url: winWhooshUrl, gain: 0.60, minGapMs: 90, maxVoices: 3, jitter: 0 },
  // event map: "UI / CTA tap". No buttons exist yet (the CTA and mute chips are
  // a later change), so its only current trigger is a REFUSED release — standing
  // in for the event map's InGame_Sfx_Duckies_Pull_CantPull, which is priority
  // `nice` and shipped no clip.
  uiClick: { url: uiClickUrl, gain: 1.30, minGapMs: 80, maxVoices: 2, jitter: 0 },
};

/**
 * Master level. The hottest single voice peaks at gain x peak = 1.45 x -1.1 dBFS
 * = 1.28, so 0.6 puts even that at 0.77 with room for a second voice on top; the
 * limiter below catches the chain-reaction pile-ups that go past it.
 */
const MASTER_GAIN = 0.6;

/**
 * Runaway guard, not a mixing decision. After the per-voice gates the worst
 * measured second of play attempts ~74 plays, and with the longest mapped clip
 * at 1.33 s real concurrency stays well under this; it exists so that a bug in a
 * caller can never open unbounded voices.
 */
const MAX_TOTAL_VOICES = 12;

/**
 * How late a play request may still be honoured while the audio layer is
 * finishing its cold start, because the unlock gesture IS the player's first
 * grab: `launchPull` is requested on the very event that builds the audio
 * graph, so without this the first pull of the session is always silent (it
 * was, until the browser probe caught it).
 *
 * MEASURED in headless Chromium: `new AudioContext()` 327 ms, fetching the 11
 * clips 206 ms, decodeAudioData 54 ms — 587 ms total, against the 250 ms this
 * constant started at. Fetching AND decoding now happen at construction (see
 * the constructor), so the gesture pays only context creation + resume:
 * ~330 ms. 600 ms covers that with margin on a slower device, and covers the
 * engines that only honour the resume at the gesture's END (see play's
 * statechange hold). A pull sound arriving a third of a second into a drag
 * that lasts far longer is still the pull; silence is not.
 */
const LATE_PLAY_MS = 600;

/** ramp on the mute toggle, long enough not to click, short enough to feel instant */
const MUTE_RAMP = 0.02;

type Ctor = new () => AudioContext;
type OfflineCtor = new (channels: number, length: number, rate: number) => OfflineAudioContext;

export class Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /**
   * The DOM-level unlock net: ONLY events that actually carry user activation
   * (HTML spec's activation-triggering list; WebKit's User Activation post).
   * A touch grants activation at touchEND, a mouse at mouseDOWN, pointerup
   * covers the rest; `click` rides along because Howler has shipped it for a
   * decade. touchstart and a touch's pointerdown are deliberately absent:
   * they carry NO activation, and a resume() fired from one is parked on a
   * promise that never settles (WebAudio spec issue #1759) — which is exactly
   * how an iPhone ends up wedged on 'suspended' while the unlock ritual
   * appears to run fine. Measured on an iPhone 17 Pro Max doing just that.
   */
  private static readonly UNLOCK_EVENTS = ['touchend', 'pointerup', 'mousedown', 'click', 'keydown'] as const;
  private readonly tryUnlock = (): void => this.unlock();
  /** whether the unlock net is currently listening */
  private armed = false;
  /** decoded once per URL, so the three tick voices share one buffer */
  private buffers = new Map<string, AudioBuffer>();
  /** raw bytes, pulled at construction — see prefetch */
  private readonly fetched: Promise<Map<string, ArrayBuffer>>;
  private ready: Promise<void> | null = null;
  /** voice -> ctx.currentTime of its last accepted play, for the min-gap gate */
  private lastAt = new Map<VoiceName, number>();
  private live = new Map<VoiceName, number>();
  private liveTotal = 0;
  /** every source currently connected — so stopAll can reach them and nothing leaks */
  private sources = new Set<AudioBufferSourceNode>();
  private _muted = false;
  /** dev/probe counters: how many plays each voice accepted and dropped */
  readonly played = new Map<VoiceName, number>();
  readonly dropped = new Map<VoiceName, number>();

  constructor() {
    // iOS routes Web Audio through the RINGER category by default, so the
    // silent switch mutes the whole game while the visuals play on — "sound
    // doesn't work on my iPhone" with nothing else wrong, since most phones
    // live on silent. The AudioSession API (Safari 16.4+) files the page
    // under 'playback' — a game's actual category, the one video players and
    // the real Duckies Pop app use — which the switch does not silence.
    // Browsers without the API skip this and behave as before.
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    this.fetched = this.prefetch();
    // Decode at BOOT, on an OfflineAudioContext — decoding is plain CPU work
    // with no autoplay-policy involvement, and the buffers it yields play on
    // any later context. Decoded on the unlock gesture instead, the whole cold
    // start used to land inside the first level's opening shots: the probes
    // measured an entire first flight silent (launch, bumps, explosions all
    // requested while decode was in flight and expired past LATE_PLAY_MS) on a
    // fast desktop, several shots' worth on a weak phone. 48 kHz to match the
    // common device rate, so most playback is not resampled at all.
    const w = window as unknown as {
      OfflineAudioContext?: OfflineCtor; webkitOfflineAudioContext?: OfflineCtor;
    };
    const OAC = w.OfflineAudioContext ?? w.webkitOfflineAudioContext;
    if (OAC) this.ready = this.decodeAll(new OAC(1, 1, 48000));
    this.arm();
    // WebKit parks a context on its non-standard 'interrupted' state for a
    // phone call or a tab-away and does not reliably lift it on return
    // (Phaser #5390, WebKit bug 263627) — so every return to the foreground
    // pokes the context, and re-arms the gesture net in case the poke itself
    // is refused and a fresh gesture has to finish the job.
    const poke = (): void => {
      if (!this.ctx || this.ctx.state === 'running') return;
      this.arm();
      void this.ctx.resume().catch(() => {});
    };
    window.addEventListener('focus', poke);
    document.addEventListener('visibilitychange', poke);
  }

  /**
   * Raise the unlock net: listen for the next activation-carrying gesture.
   * Capture phase on the document, like every production unlocker — first to
   * see the event and immune to anything a game handler does with it.
   */
  private arm(): void {
    if (this.armed) return;
    this.armed = true;
    // passive: the unlock never calls preventDefault, and a NON-passive
    // document-level touchend measurably wedges Chromium's injected-input
    // path (CDP dispatchTouchEvent never acks — the touch harnesses hung on
    // it); passive costs nothing and sidesteps that whole class
    for (const ev of Audio.UNLOCK_EVENTS) {
      document.addEventListener(ev, this.tryUnlock, { capture: true, passive: true });
    }
  }

  /**
   * Verified running: take the net down. Racing further resume() calls into
   * WebKit is how unresolvable promises pile up, so retrying stops the moment
   * the context is genuinely running — every production library removes its
   * unlock listeners here. statechange re-arms if the context is ever parked.
   */
  private disarm(): void {
    if (!this.armed) return;
    this.armed = false;
    for (const ev of Audio.UNLOCK_EVENTS) {
      document.removeEventListener(ev, this.tryUnlock, { capture: true });
    }
  }

  /**
   * Pull the clip bytes at construction, feeding the boot-time decode above —
   * plain fetches, nothing the autoplay policy cares about. Keeping the 206 ms
   * of fetching (measured, dev server) off the unlock gesture is what lets the
   * gesture pay for nothing but context creation. In the shipped single file
   * these are data: URIs and it is near-free.
   */
  private async prefetch(): Promise<Map<string, ArrayBuffer>> {
    const out = new Map<string, ArrayBuffer>();
    const urls = [...new Set(Object.values(VOICES).map((v) => v.url))];
    await Promise.all(urls.map(async (url) => {
      try {
        out.set(url, await (await fetch(url)).arrayBuffer());
      } catch {
        // an unreachable clip must not take the ad down, or print an error the
        // screenshot harness would fail on — that voice is simply silent
        console.warn(`sfx: could not fetch ${url.slice(0, 48)}`);
      }
    }));
    return out;
  }

  get muted(): boolean {
    return this._muted;
  }

  /** true once the context exists and every clip has decoded */
  get loaded(): boolean {
    return this.ctx !== null && this.buffers.size > 0;
  }

  get state(): string {
    return this.ctx?.state ?? 'locked';
  }

  /**
   * Autoplay policy: a LIVE context created before a user gesture starts
   * suspended and Chrome complains in the console, so the live graph is not
   * built until the first activation-carrying gesture reaches the net above
   * (the boot-time decode uses an offline context, which the policy does not
   * care about). Runs once per gesture while the context is anything but
   * running: builds the graph the first time, afterwards resumes and re-kicks
   * — the gesture that finally carries the activation is not knowable in
   * advance, so each candidate gets the full ritual. Never throws: a browser
   * with no Web Audio just runs the ad silent.
   */
  private unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'running') {
        this.disarm(); // already through — stop retrying into the engine
        return;
      }
      void this.ctx.resume().catch(() => {});
      this.kick(this.ctx);
      return;
    }
    const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try {
      ctx = new AC();
    } catch {
      return; // no context available: silent, but the ad keeps running
    }
    this.ctx = ctx;
    // the net's whole lifecycle in one place: down while running, up while
    // parked ('suspended' and WebKit's 'interrupted' alike), for the life of
    // the page — an interruption mid-session re-arms it automatically
    ctx.addEventListener('statechange', () => {
      if (ctx.state === 'running') this.disarm();
      else this.arm();
    });
    const master = ctx.createGain();
    master.gain.value = this._muted ? 0 : MASTER_GAIN;
    // A chain generation can stack an explode over three tick voices; summed
    // that goes past 1.0 and the destination hard-clips. A limiter with a fast
    // attack and a 6 dB soft knee rides those pile-ups down without touching a
    // single hit, which is why the master can stay at a usable level.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.15;
    master.connect(limiter);
    limiter.connect(ctx.destination);
    this.master = master;
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
    this.kick(ctx);
    // the clips decoded at construction (offline context); this fallback only
    // runs on an engine that shipped Web Audio without OfflineAudioContext
    this.ready ??= this.decodeAll(ctx);
  }

  /**
   * The classic iOS unlock incantation: START A SOURCE inside the gesture.
   * Real WebKit does not treat resume() alone as proof the page means to make
   * sound — a context can report 'running' with the hardware route still shut,
   * and every later play() is silently swallowed. One sample of silence
   * straight to the destination, started within the gesture handler, is what
   * actually opens the route. Costless and inaudible everywhere else.
   */
  private kick(ctx: AudioContext): void {
    try {
      const s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, 22050);
      s.connect(ctx.destination);
      s.start(0);
    } catch {
      // a browser that refuses the kick loses nothing but the ritual
    }
  }

  private async decodeAll(ctx: BaseAudioContext): Promise<void> {
    const bytes = await this.fetched;
    await Promise.all([...bytes].map(async ([url, buf]) => {
      try {
        this.buffers.set(url, await ctx.decodeAudioData(buf));
      } catch {
        // One unplayable clip must not take the rest of the mix (or the ad) with
        // it, and must not print an error — the screenshot harness fails on those.
        console.warn(`sfx: could not decode ${url.slice(0, 48)}`);
      }
    }));
  }

  /** Master mute. Survives level loads because the scene keeps one Audio. */
  setMuted(muted: boolean): void {
    this._muted = muted;
    const g = this.master;
    if (!g || !this.ctx) return;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(g.gain.value, t);
    g.gain.linearRampToValueAtTime(muted ? 0 : MASTER_GAIN, t + MUTE_RAMP);
  }

  /**
   * Fire one voice. Silently does nothing before the first gesture, which is the
   * whole autoplay story: the ad is quiet until the player touches it and needs
   * no "tap for sound" affordance.
   *
   * `gain` and `rate` multiply the voice's own values — callers use them to
   * scale an impact by its speed.
   */
  play(name: VoiceName, opts: { gain?: number; rate?: number } = {}): void {
    this.playHeld(name, opts, performance.now(), false);
  }

  /**
   * play() plus the hold bookkeeping. `asked` is when the ORIGINAL request was
   * made and travels through every replay unchanged, so the LATE_PLAY grace
   * genuinely expires — re-stamping it per replay is how the page WEDGED: a
   * clip whose fetch failed leaves its buffer missing for ever while `ready`
   * is already resolved, so hold → replay → hold again was a synchronous
   * microtask loop with a forever-fresh deadline, and the main thread never
   * ran another frame (caught live under the debugger, stuck in play()).
   * `replay` marks a request coming back from its own hold: a replay that
   * STILL finds no buffer means the clip is never coming — drop it, once,
   * with the warning the prefetch already printed.
   */
  private playHeld(
    name: VoiceName, opts: { gain?: number; rate?: number }, asked: number, replay: boolean,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const def = VOICES[name];
    const buf = this.buffers.get(def.url);
    if (!buf) {
      // still decoding: hold the request briefly rather than lose the first
      // grab. ONE hold per request — see the doc above for why a second one
      // must not happen.
      const ready = this.ready;
      if (!ready || replay) return;
      void ready.then(() => {
        if (performance.now() - asked < LATE_PLAY_MS) this.playHeld(name, opts, asked, true);
      });
      return;
    }
    if (ctx.state !== 'running') {
      // The graph exists but the browser has not let it run yet: the context
      // was created inside this very gesture and resume() resolves async — or
      // the engine is one that only honours the resume at the gesture's END
      // (per spec a touch-backed pointerdown carries no user activation; the
      // pointerup does). Same deal as the decode hold above: the sound plays
      // if the context starts inside the grace, and is dropped as stale past
      // it. Without this, every source started on a suspended context would
      // pile up and fire as one burst at the moment it finally resumes.
      // Re-arming here cannot loop — statechange only fires on a real state
      // transition — and the original `asked` still bounds the total wait.
      ctx.addEventListener('statechange', () => {
        if (performance.now() - asked < LATE_PLAY_MS) this.playHeld(name, opts, asked, true);
      }, { once: true });
      return;
    }
    const now = ctx.currentTime;
    const last = this.lastAt.get(name);
    const liveHere = this.live.get(name) ?? 0;
    if (
      (last !== undefined && (now - last) * 1000 < def.minGapMs)
      || liveHere >= def.maxVoices
      || this.liveTotal >= MAX_TOTAL_VOICES
    ) {
      // drop the NEWEST rather than steal the oldest: these are one-shots, and
      // cutting a tail short is more audible than losing one tick of a burst
      this.dropped.set(name, (this.dropped.get(name) ?? 0) + 1);
      return;
    }
    this.lastAt.set(name, now);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const jitter = def.jitter > 0 ? 1 + (Math.random() * 2 - 1) * def.jitter : 1;
    src.playbackRate.value = jitter * (opts.rate ?? 1);
    const g = ctx.createGain();
    g.gain.value = def.gain * (opts.gain ?? 1);
    src.connect(g);
    g.connect(this.master!);
    this.live.set(name, liveHere + 1);
    this.liveTotal++;
    this.sources.add(src);
    src.onended = (): void => {
      // an AudioBufferSourceNode is single-use; disconnecting both ends here is
      // what keeps a long session from accumulating dead nodes on the master
      src.disconnect();
      g.disconnect();
      this.sources.delete(src);
      this.live.set(name, Math.max(0, (this.live.get(name) ?? 1) - 1));
      this.liveTotal = Math.max(0, this.liveTotal - 1);
    };
    src.start();
    this.played.set(name, (this.played.get(name) ?? 0) + 1);
  }

  /**
   * Cut everything now. Called on a level swap so no tail from the old board
   * bleeds over the new one; `onended` still runs for each stopped source, so
   * the voice counters and the node graph unwind exactly as they would normally.
   */
  stopAll(): void {
    for (const src of [...this.sources]) {
      try {
        src.stop();
      } catch {
        // already ended between the snapshot and here — onended has done the work
      }
    }
  }
}

/**
 * Impact loudness from impact speed, shared by every bump voice.
 *
 * Normalised against LAUNCH_SPEED because that IS the top of the range: a duck
 * fired at 2700 px/s into a resting duck closes at ~2700, and the measured p90
 * of duckBumped is 2610 and of wallHit 2293. Floor at 0.35 rather than 0 so a
 * gentle nudge still ticks instead of vanishing — measured p10 is 227 px/s,
 * which lands at 0.40.
 */
export function impactGain(speed: number): number {
  const t = Math.min(1, Math.max(0, speed / SIM.LAUNCH_SPEED));
  return 0.35 + 0.65 * t;
}
