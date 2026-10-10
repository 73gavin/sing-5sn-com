// Note math. MIDI numbers are the common currency: 60 = C4 (middle C), 69 = A4 (440 Hz).
// One MIDI step is a semitone (a frequency ratio of 2^(1/12), about 5.9%).

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const freqToMidi = (hz) => 69 + 12 * Math.log2(hz / 440);
export const midiToFreq = (midi) => 440 * 2 ** ((midi - 69) / 12);
export const isBlackKey = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

export function midiToName(midi) {
  const m = Math.round(midi);
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// Nearest note and how far off it is, in cents (100 cents = 1 semitone).
export function nearestNote(hz) {
  const exact = freqToMidi(hz);
  const midi = Math.round(exact);
  return { midi, name: midiToName(midi), cents: (exact - midi) * 100 };
}

export function noteInfo(midi) {
  return { midi, name: midiToName(midi), hz: Math.round(midiToFreq(midi) * 10) / 10 };
}

// Typical classical ranges (choir-style). Real voices vary a lot; this is only a label.
export const VOICE_TYPES = [
  { name: 'Bass', low: 40, high: 64 },          // E2-E4
  { name: 'Baritone', low: 45, high: 69 },      // A2-A4
  { name: 'Tenor', low: 48, high: 72 },         // C3-C5
  { name: 'Alto', low: 53, high: 77 },          // F3-F5
  { name: 'Mezzo-soprano', low: 57, high: 81 }, // A3-A5
  { name: 'Soprano', low: 60, high: 84 },       // C4-C6
];

// Pick the type whose range overlaps the singer's (chest voice) range best, penalizing
// parts of the type's range the singer cannot cover; centers break ties.
export function guessVoiceType(low, high) {
  let best = null;
  for (const t of VOICE_TYPES) {
    const overlap = Math.max(0, Math.min(high, t.high) - Math.max(low, t.low));
    const missing = Math.max(0, low - t.low) + Math.max(0, t.high - high);
    const centerGap = Math.abs((low + high) / 2 - (t.low + t.high) / 2);
    const score = overlap - 0.5 * missing - 0.1 * centerGap;
    if (!best || score > best.score) best = { ...t, score };
  }
  return best && best.name;
}
