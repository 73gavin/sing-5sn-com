// Monophonic pitch detection (YIN, de Cheveigne & Kawahara 2002) plus a "held note"
// tracker that turns a noisy stream of frame estimates into sustained notes.
// No DOM or Web Audio here, so it runs under Node for tests.

import { freqToMidi } from './notes.js';

export function createDetector({ sampleRate, minFreq = 40, maxFreq = 1600, threshold = 0.15, minRms = 0.01 }) {
  let d = new Float32Array(0);

  return function detect(buf) {
    let sumSq = 0;
    for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
    const rms = Math.sqrt(sumSq / buf.length);
    if (rms < minRms) return { hz: null, clarity: 0, rms };

    const w = Math.floor(buf.length / 2);
    const tauMax = Math.min(w, Math.ceil(sampleRate / minFreq));
    const tauMin = Math.max(2, Math.floor(sampleRate / maxFreq));
    if (d.length < tauMax + 1) d = new Float32Array(tauMax + 1);

    // Difference function.
    for (let tau = 1; tau <= tauMax; tau++) {
      let s = 0;
      for (let i = 0; i < w; i++) {
        const x = buf[i] - buf[i + tau];
        s += x * x;
      }
      d[tau] = s;
    }
    // Cumulative mean normalized difference.
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    // First dip under the threshold, then slide to the bottom of that dip.
    let tau = tauMin;
    while (tau <= tauMax && d[tau] >= threshold) tau++;
    if (tau > tauMax) return { hz: null, clarity: 0, rms };
    while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;

    // Parabolic interpolation for sub-sample accuracy.
    let t = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const denom = a + c - 2 * b;
      if (denom !== 0) t = tau + (a - c) / (2 * denom);
    }
    return { hz: sampleRate / t, clarity: 1 - d[tau], rms };
  };
}

// Steadies the frame-by-frame pitch for display. A median over the last few frames drops
// one-frame spikes (octave errors), light exponential smoothing calms the wobble, and
// real note changes (over `snap` semitones) pass straight through. Short dropouts hold
// the last value. Returns a fractional MIDI number, or null after `holdMs` of silence.
export class PitchSmoother {
  constructor({ size = 5, alpha = 0.3, snap = 1.5, holdMs = 300 } = {}) {
    Object.assign(this, { size, alpha, snap, holdMs });
    this.recent = [];
    this.value = null;
    this.lastSeen = -Infinity;
  }

  feed(hz, now) {
    if (hz == null) {
      if (now - this.lastSeen > this.holdMs) {
        this.recent = [];
        this.value = null;
      }
      return this.value;
    }
    this.lastSeen = now;
    this.recent.push(freqToMidi(hz));
    if (this.recent.length > this.size) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const m = sorted[Math.floor(sorted.length / 2)];
    if (this.value == null || Math.abs(m - this.value) > this.snap) this.value = m;
    else this.value += (m - this.value) * this.alpha;
    return this.value;
  }
}

// Typical speaking pitch from a stream of frame estimates (fractional MIDI). Speech glides
// and phrase endings drop into creaky "vocal fry", so trim the outer 15% before taking the
// median. Returns null until there is enough voiced speech (about 1.5 s of frames).
export function speakingPitch(midis, minFrames = 30) {
  if (midis.length < minFrames) return null;
  const s = [...midis].sort((a, b) => a - b);
  const cut = Math.floor(s.length * 0.15);
  const mid = s.slice(cut, s.length - cut);
  return mid[Math.floor(mid.length / 2)];
}

// Tracks whether the singer is holding one note. Feed it every frame estimate.
// A hold survives short dropouts (breaths, consonants) up to `gapMs`, and ends when
// the pitch wanders more than `tolerance` semitones from the hold's running median.
export class NoteHold {
  constructor({ tolerance = 0.6, gapMs = 180 } = {}) {
    this.tolerance = tolerance;
    this.gapMs = gapMs;
    this.reset();
  }

  reset() {
    this.samples = []; // MIDI values (fractional) in the current hold
    this.start = null;
    this.lastSeen = null;
  }

  // Returns the current hold: { midi, exact, heldMs } or null.
  feed(hz, now) {
    if (hz == null) {
      if (this.lastSeen != null && now - this.lastSeen > this.gapMs) this.reset();
      return this.current(now);
    }
    const m = freqToMidi(hz);
    if (this.samples.length && Math.abs(m - this.median()) > this.tolerance) this.reset();
    if (!this.samples.length) this.start = now;
    this.samples.push(m);
    if (this.samples.length > 200) this.samples.shift();
    this.lastSeen = now;
    return this.current(now);
  }

  median() {
    const s = [...this.samples].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  current(now) {
    if (!this.samples.length) return null;
    const exact = this.median();
    return { midi: Math.round(exact), exact, heldMs: Math.min(now, this.lastSeen + this.gapMs) - this.start };
  }
}
