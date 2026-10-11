import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSong, songToText, parseMidi, fitShift, timeline, scoreTake, summarizeTake, nameToMidi, barStarts, pickupBeats, barNumber, practiceView, parseKey, keyName, keyFromFifths, insideShare } from '../public/js/song.js';
import { SONGS } from '../public/js/songs.js';

test('note names to MIDI', () => {
  assert.equal(nameToMidi('C4'), 60);
  assert.equal(nameToMidi('A4'), 69);
  assert.equal(nameToMidi('C#4'), 61);
  assert.equal(nameToMidi('Db4'), 61);
  assert.equal(nameToMidi('B-1'), 11);
  assert.equal(nameToMidi('H4'), null);
});

test('parses the text format', () => {
  const s = parseSong(`title: Test  # a comment
tempo: 120
time: 3/4
notes: C4 C#4:2 | r E4:0.5 F4:1/2
words: one two_ _ three`);
  assert.equal(s.title, 'Test');
  assert.equal(s.bpm, 120);
  assert.equal(s.beatsPerBar, 3);
  assert.deepEqual(s.notes.map((n) => [n.midi, n.beat, n.beats]), [[60, 0, 1], [61, 1, 2], [64, 4, 0.5], [65, 4.5, 0.5]]);
  assert.deepEqual(s.notes.map((n) => n.lyric), ['one', 'two_', '', 'three']);
  assert.equal(parseSong('time: 6/8\nnotes: C4').pulse, 1.5);
  assert.throws(() => parseSong('notes: C4 X9'), /Line 1: "X9" is not a note/);
  assert.throws(() => parseSong('title: nothing'), /No notes/);
});

test('built-in songs parse, with one syllable per note where they have words', () => {
  for (const text of SONGS) {
    const s = parseSong(text);
    const words = text.split('\n').filter((l) => l.startsWith('words:')).flatMap((l) => l.slice(6).trim().split(/\s+/));
    if (words.length) assert.equal(words.length, s.notes.length, `${s.title}: ${words.length} syllables for ${s.notes.length} notes`);
    const bars = s.notes.at(-1).beat + s.notes.at(-1).beats;
    assert.equal(bars % s.beatsPerBar, 0, `${s.title}: ends mid-bar`);
  }
});

test('text round trip', () => {
  const s = parseSong(SONGS[3]);
  const back = parseSong(songToText(s));
  assert.deepEqual(back.notes, s.notes);
  assert.equal(back.pulse, 1.5);
});

test('fits a song into a range', () => {
  const s = parseSong('notes: C4 G4'); // 60-67, center 63.5
  assert.equal(fitShift(s.notes, 45, 57), -12); // center 51
});

// ---------- MIDI ----------

const vlq = (n) => {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
function midiFile(events, division = 480) {
  const track = events.flatMap(([delta, ...bytes]) => [...vlq(delta), ...bytes]).concat([0, 0xff, 0x2f, 0]);
  const len = track.length;
  return new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, division >> 8, division & 0xff,
    0x4d, 0x54, 0x72, 0x6b, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff,
    ...track,
  ]);
}
const lyric = (text) => [0xff, 0x05, text.length, ...[...text].map((c) => c.charCodeAt(0))];

test('reads a MIDI melody: tempo, lyrics, top note of chords, drums ignored', () => {
  const bytes = midiFile([
    [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], // 500000 us per beat = 120 bpm
    [0, 0xff, 0x58, 4, 3, 2, 24, 8],      // 3/4
    [0, ...lyric('Hel-')],
    [0, 0x90, 60, 100],
    [0, 0x99, 36, 100],                   // drum on channel 10
    [480, 0x80, 60, 0],
    [0, 0x89, 36, 0],
    [0, ...lyric('lo')],
    [0, 0x90, 55, 90],                    // chord: G3 under E4
    [0, 0x90, 64, 90],
    [960, 0x90, 55, 0],                   // note-on with velocity 0 = note-off
    [0, 0x80, 64, 0],
  ]);
  const m = parseMidi(bytes);
  assert.equal(m.bpm, 120);
  assert.equal(m.beatsPerBar, 3);
  assert.equal(m.parts.length, 1);
  const notes = m.parts[0].notes;
  assert.deepEqual(notes.map((n) => [n.midi, n.beat, n.beats, n.lyric]), [[60, 0, 1, 'Hel-'], [64, 1, 2, 'lo']]);
  assert.throws(() => parseMidi(new Uint8Array([1, 2, 3, 4])), /Not a MIDI file/);
});

test('hymn-style MIDI: two tempos at the start, a pickup, and a short bar', () => {
  // Like the Hymns for Home and Church files: tempo 120 then 76 at tick 0, a one-beat pickup
  // in 1/4, then 3/4, with a 2/4 bar at the end of the phrase.
  const q = 480;
  const meterEv = (num) => [0, 0xff, 0x58, 4, num, 2, 24, 8];
  const note = (m, len) => [[0, 0x90, m, 80], [len, 0x80, m, 0]];
  const bytes = midiFile([
    [0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20], // 120 bpm
    [0, 0xff, 0x51, 3, 0x0c, 0x0b, 0xa7], // 76 bpm (789415 us per beat)
    meterEv(1), ...note(62, q),           // pickup D4 in 1/4
    meterEv(3), ...note(66, q), ...note(64, q), ...note(62, q),
    meterEv(2), ...note(62, 2 * q),       // a 2/4 bar
    meterEv(3), ...note(69, 3 * q),
  ]);
  const m = parseMidi(bytes);
  assert.equal(Math.round(m.bpm), 76);
  assert.deepEqual(m.parts[0].notes.map((n) => n.beat), [0, 1, 2, 3, 4, 6]);
  assert.equal(m.beatsPerBar, 3, 'main meter is 3/4');
  const song = parseSong(songToText({ ...m, notes: m.parts[0].notes }));
  assert.deepEqual(song.notes.map((n) => [n.midi, n.beat, n.beats]), m.parts[0].notes.map((n) => [n.midi, n.beat, n.beats]));
  assert.equal(pickupBeats(song), 1);
  assert.deepEqual(barStarts(song, 9), [0, 1, 4, 6]);
  assert.deepEqual(song.notes.map((n) => barNumber(song, n.beat)), [0, 1, 1, 1, 2, 3]);
});

test('a time: line between notes changes the bar length from there', () => {
  const s = parseSong(['time: 3/4', 'notes: C4 C4 C4', 'time: 2/4', 'notes: D4 D4', 'time: 3/4', 'notes: E4:3'].join('\n'));
  assert.deepEqual(barStarts(s, 8), [0, 3, 5]);
  assert.equal(pickupBeats(s), 0);
  assert.equal(barNumber(s, 5), 3);
});

// ---------- scoring ----------

// A simulated singer: frames every 45 ms; each note sung from start + late to end + late,
// leaving a short break before the next note (a consonant), at target + cents.
function sing(notes, { late = 0, cents = 0, octave = 0, skip = [] } = {}) {
  const frames = [];
  const end = notes.at(-1).end + 0.5;
  for (let t = -0.5; t < end; t += 0.045) {
    const n = notes.find((x) => t >= x.start + late && t < x.end + late - 0.06);
    const on = n && !skip.includes(n.i);
    frames.push({ t, midi: on ? n.midi + 12 * octave + cents / 100 : null });
  }
  return frames;
}

const twinkle = timeline(parseSong(SONGS[2]), 1, 0); // quarter notes 0.6 s long

test('a clean take scores on pitch and on time, including repeated notes', () => {
  const s = scoreTake(twinkle, sing(twinkle));
  const sum = summarizeTake(s);
  assert.equal(sum.missed, 0);
  assert.equal(sum.inTune, twinkle.length);
  assert.equal(sum.timed, twinkle.length, 'repeated notes timed from the break between them');
  assert.equal(sum.onTime, twinkle.length);
  assert.ok(Math.abs(sum.avgOnsetMs) < 50, `onset ${sum.avgOnsetMs}`);
});

test('late and early entries', () => {
  const late = summarizeTake(scoreTake(twinkle, sing(twinkle, { late: 0.3 })));
  assert.ok(late.late >= late.timed * 0.8, `late ${late.late} of ${late.timed}`);
  assert.ok(late.avgOnsetMs > 200, `avg ${late.avgOnsetMs}`);
  const early = summarizeTake(scoreTake(twinkle, sing(twinkle, { late: -0.3 })));
  assert.ok(early.early >= early.timed * 0.8, `early ${early.early} of ${early.timed}`);
});

test('flat, sharp, octave, and missed notes', () => {
  const flat = summarizeTake(scoreTake(twinkle, sing(twinkle, { cents: -70 })));
  assert.equal(flat.flat, twinkle.length);
  assert.equal(flat.avgCents, -70);
  assert.equal(flat.onTime, twinkle.length, 'off-key notes still get timed');

  const sharp = summarizeTake(scoreTake(twinkle, sing(twinkle, { cents: 30 })));
  assert.equal(sharp.inTune, twinkle.length, '30 cents is within 50');

  const low = scoreTake(twinkle, sing(twinkle, { octave: -1 }));
  assert.ok(low.every((x) => x.octave === -1 && x.pitch === 'ok'));

  const s = scoreTake(twinkle, sing(twinkle, { skip: [3, 4] }));
  assert.ok(s[3].missed && s[4].missed);
  assert.equal(summarizeTake(s).missed, 2);
});

test('fast repeated notes (row, row, merrily) score clean when sung clean', () => {
  const row = timeline(parseSong(SONGS[3]), 1, 0); // eighth notes about 0.27 s
  const sum = summarizeTake(scoreTake(row, sing(row)));
  assert.equal(sum.inTune, row.length);
  assert.equal(sum.onTime, sum.timed);
  assert.ok(sum.timed >= row.length - 1, `timed ${sum.timed} of ${row.length}`);
});

test('a repeated note sung without a break is on pitch, with its start unclear', () => {
  const notes = timeline(parseSong('tempo: 60\nnotes: C4 C4 E4'), 1, 0);
  const frames = [];
  for (let t = -0.5; t < 3.5; t += 0.045) frames.push({ t, midi: t < 0 ? null : t < 2 ? 60 : t < 2.94 ? 64 : null });
  const s = scoreTake(notes, frames);
  assert.equal(s[0].timing, 'ok');
  assert.equal(s[1].pitch, 'ok');
  assert.equal(s[1].onsetMs, null);
  assert.equal(s[2].timing, 'ok');
});

test('a one-reading octave slip does not split a held note', () => {
  const notes = timeline(parseSong('tempo: 60\nnotes: A3:2'), 1, 0);
  const frames = [];
  for (let t = -0.5; t < 2.5; t += 0.045) frames.push({ t, midi: t < 0 || t > 1.95 ? null : Math.abs(t - 1) < 0.02 ? 69 : 57 });
  const [s] = scoreTake(notes, frames);
  assert.equal(s.timing, 'ok');
  assert.equal(s.inTune, 1);
});

test('a note first read an octave high is timed from its real entry', () => {
  const notes = timeline(parseSong('tempo: 60\nnotes: G4:2'), 1, 0);
  const frames = [];
  for (let t = -0.5; t < 2.5; t += 0.045) frames.push({ t, midi: t < 0.03 || t > 1.95 ? null : t < 0.5 ? 79 : 67 });
  const [s] = scoreTake(notes, frames);
  assert.equal(s.timing, 'ok');
  assert.ok(Math.abs(s.onsetMs) < 60, `onset ${s.onsetMs}`);
});

test('parts and verses: words shared across parts, kept through text', () => {
  const text = [
    'title: Two parts', 'tempo: 80', 'time: 3/4',
    'part: Soprano', 'notes: D4 F#4 A4 | D5:3',
    'words: Come, thou fount', 'words 2: Here I raise',
    'part: Bass', 'notes: D3:2 A2 | D3:3',
  ].join('\n');
  const s = parseSong(text);
  assert.deepEqual(s.parts.map((p) => p.name), ['Soprano', 'Bass']);
  assert.equal(s.verses, 2);
  assert.deepEqual(s.notes.map((n) => n.lyric), ['Come,', 'thou', 'fount', '']);
  const bass = practiceView(s, 1, 1);
  assert.equal(bass.partName, 'Bass');
  assert.deepEqual(bass.notes.map((n) => [n.midi, n.lyric]), [[50, 'Here'], [45, 'raise'], [50, '']], 'bass sings the words on the beats it shares');
  const back = parseSong(songToText(s));
  assert.deepEqual(back.parts, s.parts);
  assert.deepEqual(back.meters, s.meters);
});

test('keys: parse, name, move, and keep through text', () => {
  assert.deepEqual(parseKey('D'), { tonic: 2, minor: false });
  assert.deepEqual(parseKey('F# minor'), { tonic: 6, minor: true });
  assert.deepEqual(parseKey('Bbm'), { tonic: 10, minor: true });
  assert.equal(parseKey('H'), null);
  assert.equal(keyName(keyFromFifths(2)), 'D');       // two sharps
  assert.equal(keyName(keyFromFifths(-3)), 'Eb');     // three flats
  assert.equal(keyName(keyFromFifths(1, true)), 'Em'); // one sharp, minor
  assert.equal(keyName(parseKey('D'), -2), 'C');
  assert.equal(keyName(parseKey('D'), -19), 'G');
  const s = parseSong('key: Eb\nnotes: Eb4 G4');
  assert.equal(keyName(parseSong(songToText(s)).key), 'Eb');
  assert.throws(() => parseSong('key: X\nnotes: C4'), /key should be/);
});

test('keeping the key: fit by whole octaves, and the setting survives text', () => {
  const soprano = parseSong('notes: D4 F#4 A4 D5').notes; // D4-D5 (62-74)
  assert.equal(fitShift(soprano, 37, 54), -22, 'any step: centered in C#2-F#3');
  assert.equal(fitShift(soprano, 37, 54, true), -12, 'whole octaves: one down at most, still in D');
  assert.equal(insideShare(soprano, 37, 54, -12), 0.5, 'D3 and F#3 in; A3 and D4 above F#3');
  const bass = parseSong('notes: F#2 A2 D3 D3 A2 D3 B3').notes; // a bass line, B3 the one high note
  assert.equal(fitShift(bass, 37, 54, true), 0, 'the bass part stays as written');
  assert.equal(insideShare(bass, 37, 54, 0), 6 / 7);
  assert.equal(insideShare(soprano, 37, 54, 0), 0);
  const s = parseSong('key: D\ntranspose: octaves\nnotes: D4');
  assert.equal(s.transpose, 'octaves');
  assert.equal(parseSong(songToText(s)).transpose, 'octaves');
  assert.throws(() => parseSong('transpose: thirds\nnotes: C4'), /transpose should be/);
});

test('keeping the key, the octave avoids notes too low to sing', () => {
  const melody = parseSong('notes: A#2 C3 D3 D#3 F3 G3 A#3 C4').notes; // a tune sung by men
  // C#2-F#3: as written 5 of 8 fit and 3 are high; an octave down 6 fit but A#1 and C2 are
  // below the lowest note, which can't be sung at all. Stay as written.
  assert.equal(insideShare(melody, 37, 54, 0), 5 / 8);
  assert.equal(insideShare(melody, 37, 54, -12), 6 / 8);
  assert.equal(fitShift(melody, 37, 54, true), 0);
  // A melody well above the range still goes down an octave.
  assert.equal(fitShift(parseSong('notes: D4 F#4 A4 D5').notes, 37, 54, true), -12);
});
