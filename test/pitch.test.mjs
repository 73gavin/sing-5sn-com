// Run: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetector, NoteHold } from '../public/js/pitch.js';
import { midiToFreq, midiToName, nearestNote, guessVoiceType } from '../public/js/notes.js';

const SR = 48000;
const N = 4096;

// A voice-like tone: fundamental plus decaying harmonics, optional noise.
function tone(hz, { harmonics = 6, noise = 0, amp = 0.3 } = {}) {
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let h = 1; h <= harmonics; h++) s += Math.sin((2 * Math.PI * hz * h * i) / SR) / h;
    buf[i] = amp * s + noise * (Math.random() * 2 - 1);
  }
  return buf;
}

test('note names', () => {
  assert.equal(midiToName(60), 'C4');
  assert.equal(midiToName(69), 'A4');
  assert.equal(midiToName(40), 'E2');
  assert.equal(nearestNote(440).name, 'A4');
  assert.ok(Math.abs(nearestNote(452).cents - 47) < 2);
});

test('detects pitch across the vocal range within 10 cents', () => {
  const detect = createDetector({ sampleRate: SR });
  for (let midi = 36; midi <= 90; midi++) {
    const hz = midiToFreq(midi);
    const r = detect(tone(hz, { noise: 0.02 }));
    assert.ok(r.hz, `no pitch for ${midiToName(midi)}`);
    const cents = 1200 * Math.log2(r.hz / hz);
    assert.ok(Math.abs(cents) < 10, `${midiToName(midi)}: off by ${cents.toFixed(1)} cents`);
  }
});

test('silence and noise give no pitch', () => {
  const detect = createDetector({ sampleRate: SR });
  assert.equal(detect(new Float32Array(N)).hz, null);
  const noise = new Float32Array(N).map(() => 0.3 * (Math.random() * 2 - 1));
  assert.equal(detect(noise).hz, null);
});

test('NoteHold tracks a held note and survives a short gap', () => {
  const hold = new NoteHold();
  let t = 0, h;
  for (; t < 600; t += 40) h = hold.feed(midiToFreq(57.1), t);
  assert.equal(h.midi, 57);
  hold.feed(null, t); hold.feed(null, t + 100);
  h = hold.feed(midiToFreq(57), t + 140);
  assert.ok(h.heldMs >= 700, `held ${h.heldMs}`);
  h = hold.feed(midiToFreq(60), t + 180);
  assert.equal(h.midi, 60);
  assert.equal(h.heldMs, 0);
});

test('PitchSmoother drops octave spikes, follows note changes, holds short gaps', async () => {
  const { PitchSmoother } = await import('../public/js/pitch.js');
  const s = new PitchSmoother();
  let t = 0, v;
  for (let i = 0; i < 10; i++) v = s.feed(midiToFreq(57 + (i % 2 ? 0.1 : -0.1)), (t += 45));
  assert.ok(Math.abs(v - 57) < 0.1, `wobble smoothed: ${v}`);
  v = s.feed(midiToFreq(69), (t += 45)); // one-frame octave error
  assert.ok(Math.abs(v - 57) < 0.2, `spike ignored: ${v}`);
  for (let i = 0; i < 4; i++) v = s.feed(midiToFreq(60), (t += 45));
  assert.ok(Math.abs(v - 60) < 0.05, `followed change: ${v}`);
  assert.equal(s.feed(null, (t += 200)), v);
  assert.equal(s.feed(null, (t += 200)), null);
});

test('voice type guess', () => {
  assert.equal(guessVoiceType(45, 67), 'Baritone');
  assert.equal(guessVoiceType(60, 83), 'Soprano');
  assert.equal(guessVoiceType(41, 62), 'Bass');
});

test('report: accuracy and prompt text from a result', async () => {
  const { accuracyOf, resultsText, aiPrompt } = await import('../public/js/report.js');
  const n = (name, hz, sungHz, rating, direction) => ({ name, hz, sungHz, rating, direction });
  const r = {
    schema: 'voice-range/v1', date: '2026-10-10T00:43:51Z',
    home: { name: 'G2', hz: 98 }, comfortable: null, full: { low: { name: 'F2', hz: 87.3 }, high: { name: 'A3', hz: 220 }, semitones: 16 },
    light: null, lightVoice: 'declined', voiceTypeGuess: 'Bass',
    notes: [n('F2', 87.3, 83.8, 'easy', 'down'), n('A3', 220, 225.5, 'strained', 'up')],
  };
  const a = accuracyOf(r);
  assert.equal(a.down, -71);
  assert.equal(a.up, 43);
  const text = resultsText(r);
  assert.match(text, /going up 43 cents sharp/);
  assert.match(text, /going down 71 cents flat/);
  assert.match(text, /offered but not tried/);
  assert.match(aiPrompt([r, r]), /briefly compare/);
});

test('speakingPitch: median of speech, ignoring fry and spikes', async () => {
  const { speakingPitch } = await import('../public/js/pitch.js');
  assert.equal(speakingPitch([43, 44]), null);
  // Gliding speech around G2 (43), some fry far below, a few octave errors above.
  const frames = [];
  for (let i = 0; i < 60; i++) frames.push(43 + 2 * Math.sin(i / 4));
  for (let i = 0; i < 8; i++) frames.push(28);
  for (let i = 0; i < 4; i++) frames.push(55);
  assert.ok(Math.abs(speakingPitch(frames) - 43) < 1, `got ${speakingPitch(frames)}`);
});
