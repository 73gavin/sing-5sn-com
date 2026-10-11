// Songs for practice: a small text melody format, MIDI file import, and scoring a sung take
// against the melody, note by note, for pitch (sharp / flat) and timing (early / late).
// No DOM or Web Audio here, so it runs under Node for tests.
//
// A song is { title, bpm, beatsPerBar, pulse, meters, verses, parts, notes }, timed in beats
// (one beat = a quarter note) so the speed can change without touching the notes.
//   parts: [{ name, notes: [{ midi, beat, beats, lyrics: [one per verse] }] }], e.g. Soprano,
//          Alto, Tenor, Bass. A plain melody is one part.
//   notes: the part being practiced, with one verse's words: [{ midi, beat, beats, lyric }].
//          practiceView() picks the part and verse; parseSong() starts on the first of each.
// meters lists each time signature from the beat it starts: [{ beat, beatsPerBar, pulse }], so
// a pickup (a short first bar) and odd-length bars get their bar lines in the right place.
// beatsPerBar and pulse are the main one, used for the count-in.

import { NOTE_NAMES } from './notes.js';

// ---------- text format ----------
//
//   title: Twinkle, Twinkle, Little Star
//   tempo: 100            beats per minute
//   time: 4/4             optional, for the count-in and bar lines
//   notes: C4 C4 G4 G4 A4 A4 G4:2 | F4 F4 E4 E4 D4 D4 C4:2
//   words: Twin- kle twin- kle lit- tle star, how I won- der what you are
//
// A note is a name and octave (C4 is middle C, sharps as C#4, flats as Db4), lasting one beat
// unless followed by :beats (G4:2, E4:0.5, D4:1/2). "r" is a rest. "|" bar lines are ignored.
// Words go on the sung notes in order, one syllable each; "_" holds the previous syllable over
// another note. Repeated notes: or words: lines carry on where the last one stopped. A time:
// line between notes: lines changes the time signature from that point.
//
// key: D (or Bb, F#, "E minor", Em) names the written key, so it can be shown as the song is
// moved up or down. Optional.
//
// source: the page the song came from (a link back to it), and credit: who wrote it. Optional.
//
// transpose: octaves keeps the written key, moving only by whole octaves, for songs sung with
// others (a hymn practiced in another key would clash with the congregation). The default,
// "any", allows any step.
//
// Several parts and verses:
//
//   part: Soprano
//   notes: ...
//   words: verse one ...      (or "words 1:")
//   words 2: verse two ...
//   part: Bass
//   notes: ...
//
// Time signatures come from the first part. A part with no words of its own sings the words
// of the part that has the most, on the notes that start at the same time.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function nameToMidi(name) {
  const m = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  return (Number(m[3]) + 1) * 12 + PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function parseBeats(s) {
  const [a, b] = s.split('/');
  const v = b == null ? Number(a) : Number(a) / Number(b);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// ---------- keys ----------
//
// A key is { tonic: 0-11 (C = 0), minor }. Names use the spellings hymnbooks and lead sheets use.

const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm'];

export function parseKey(text) {
  const m = /^([A-Ga-g])(#|b)?\s*(m|min|minor|maj|major)?$/i.exec(text.trim());
  if (!m) return null;
  const tonic = (PC[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  return { tonic, minor: /^m(in(or)?)?$/i.test(m[3] || '') };
}

// From a key signature: sharps (+) or flats (-), as MusicXML and MIDI store it.
export const keyFromFifths = (fifths, minor = false) => ({ tonic: (((fifths * 7) % 12) + 12 + (minor ? 9 : 0)) % 12, minor });

// The key's name, moved by `shift` semitones.
export function keyName(key, shift = 0) {
  const pc = (((key.tonic + shift) % 12) + 12) % 12;
  return (key.minor ? MINOR_NAMES : MAJOR_NAMES)[pc];
}

// A time signature as beats (quarter notes) per bar, and the pulse a metronome clicks, in
// beats: 6/8 and 12/8 are felt in dotted quarters (1.5 beats), 2/2 in halves.
export function meter(num, den) {
  const beatsPerBar = (num * 4) / den;
  const pulse = den === 8 && num % 3 === 0 ? 1.5 : den === 2 ? 2 : 1;
  return { beatsPerBar, pulse };
}

// Writes a meter back as a time signature: 3/4, 6/8, 2/2, 5/8.
export function meterText({ beatsPerBar, pulse }) {
  if (pulse === 1.5 || !Number.isInteger(beatsPerBar)) return `${beatsPerBar * 2}/8`;
  if (pulse === 2) return `${beatsPerBar / 2}/2`;
  return `${beatsPerBar}/4`;
}

// Adds a meter change at a beat (a later one at the same beat replaces it), then picks the
// main meter: the one covering the most beats.
function setMeter(song, beat, m) {
  song.meters = song.meters.filter((x) => Math.abs(x.beat - beat) > 1e-6);
  song.meters.push({ beat, ...m });
  song.meters.sort((a, b) => a.beat - b.beat);
}

function finishMeters(song, notes) {
  if (!song.meters.length || song.meters[0].beat > 1e-6) song.meters.unshift({ beat: 0, beatsPerBar: 4, pulse: 1 });
  const end = Math.max(...notes.map((n) => n.beat + n.beats));
  const span = new Map();
  song.meters.forEach((m, i) => {
    const key = `${m.beatsPerBar}/${m.pulse}`;
    span.set(key, (span.get(key) || 0) + Math.max(0, (song.meters[i + 1]?.beat ?? end) - m.beat));
  });
  const main = song.meters.reduce((best, m) => (span.get(`${m.beatsPerBar}/${m.pulse}`) > span.get(`${best.beatsPerBar}/${best.pulse}`) ? m : best));
  song.beatsPerBar = main.beatsPerBar;
  song.pulse = main.pulse;
  return song;
}

// Beats where bars start, up to `until`.
export function barStarts(song, until) {
  const out = [];
  song.meters.forEach((m, i) => {
    const stop = Math.min(until, song.meters[i + 1]?.beat ?? until);
    for (let b = m.beat; b < stop - 1e-6; b += m.beatsPerBar) out.push(b);
  });
  return out;
}

// A first bar shorter than the main meter's: the pickup notes before the first full bar.
export function pickupBeats(song) {
  const [first, second] = song.meters;
  return second && first.beatsPerBar < song.beatsPerBar && second.beat < song.beatsPerBar ? second.beat : 0;
}

// Bar number of a beat, counting the first full bar as 1 (a pickup is bar 0).
export function barNumber(song, beat) {
  const started = barStarts(song, beat + 1).filter((b) => b <= beat + 1e-6).length;
  return started - (pickupBeats(song) ? 1 : 0);
}

export function parseSong(text) {
  const song = { title: 'Untitled', bpm: 90, meters: [], parts: [] };
  let part = null;
  const newPart = (name) => {
    part = { name, notes: [], beat: 0, words: [] }; // words[verse] = syllables
    song.parts.push(part);
  };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(^|\s)#.*$/, '').trim(); // "# comments", but not the # in C#4
    if (!line) return;
    const fail = (msg) => { throw new Error(`Line ${i + 1}: ${msg}`); };
    const m = /^(\w+)(?:\s+(\d+))?\s*:\s*(.*)$/.exec(line);
    if (!m) fail(`expected "notes:", "words:", "part:", "title:", "tempo:" or "time:", got "${line}"`);
    const [, key, num, value] = m;
    switch (key.toLowerCase()) {
      case 'title': song.title = value; break;
      case 'source':
        if (!/^https?:\/\/\S+$/.test(value)) fail(`source should be a web address, got "${value}"`);
        song.source = value;
        break;
      case 'credit':
        song.credit = value;
        break;
      case 'transpose':
        if (!/^(octaves|any)$/i.test(value)) fail(`transpose should be "octaves" or "any", got "${value}"`);
        song.transpose = value.toLowerCase();
        break;
      case 'key':
        song.key = parseKey(value);
        if (!song.key) fail(`key should be a note name like D, Bb, or F# minor, got "${value}"`);
        break;
      case 'tempo': case 'bpm': {
        const bpm = Number(value.replace(/bpm/i, ''));
        if (!(bpm >= 20 && bpm <= 300)) fail(`tempo should be beats per minute, 20-300, got "${value}"`);
        song.bpm = bpm;
        break;
      }
      case 'time': {
        const t = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
        if (!t) fail(`time should look like 4/4 or 3/4, got "${value}"`);
        // From this point in the notes; only the first part's time signatures count.
        if (song.parts.length <= 1) setMeter(song, part ? part.beat : 0, meter(Number(t[1]), Number(t[2])));
        break;
      }
      case 'part': case 'voice':
        newPart(value || `Part ${song.parts.length + 1}`);
        break;
      case 'notes':
        if (!part) newPart('Melody');
        for (const tok of value.split(/\s+/)) {
          if (!tok || tok === '|') continue;
          const [name, len = '1'] = tok.split(':');
          const beats = parseBeats(len);
          if (beats == null) fail(`"${tok}": the length after ":" should be a number of beats`);
          if (name.toLowerCase() !== 'r') {
            const midi = nameToMidi(name);
            if (midi == null) fail(`"${tok}" is not a note. Use a letter A-G, optional # or b, and an octave number, like C4 or F#3`);
            part.notes.push({ midi, beat: part.beat, beats, lyrics: [] });
          }
          part.beat += beats;
        }
        break;
      case 'words': case 'lyrics': {
        if (!part) newPart('Melody');
        const v = num ? Number(num) - 1 : 0;
        if (v < 0 || v > 30) fail(`verse number should be 1-30, got ${num}`);
        (part.words[v] ||= []).push(...value.split(/\s+/).filter(Boolean));
        break;
      }
      default:
        fail(`unknown field "${key}"`);
    }
  });
  song.parts = song.parts.filter((p) => p.notes.length);
  if (!song.parts.length) throw new Error('No notes found. Add a line starting with "notes:".');
  song.verses = Math.max(1, ...song.parts.map((p) => p.words.length));
  for (const p of song.parts) {
    for (let v = 0; v < song.verses; v++) {
      (p.words[v] || []).slice(0, p.notes.length).forEach((w, i) => (p.notes[i].lyrics[v] = w === '_' ? '' : w));
    }
    delete p.words;
    delete p.beat;
  }
  shareLyrics(song.parts, song.verses);
  finishMeters(song, song.parts[0].notes);
  return practiceView(song, 0, 0);
}

// Parts without words take them from the part with the most, note for note where both start
// on the same beat (hymnbooks print the words once, between the staves).
function shareLyrics(parts, verses) {
  const count = (p) => p.notes.filter((n) => n.lyrics.some(Boolean)).length;
  const source = parts.reduce((best, p) => (count(p) > count(best) ? p : best), parts[0]);
  if (count(source)) {
    const at = new Map(source.notes.map((n) => [Math.round(n.beat * 1000), n.lyrics]));
    for (const p of parts) {
      if (p === source || count(p) || isAccompaniment(p.name)) continue;
      for (const n of p.notes) n.lyrics = [...(at.get(Math.round(n.beat * 1000)) || [])];
    }
  }
  for (const p of parts) for (const n of p.notes) n.lyrics = Array.from({ length: verses }, (_, v) => n.lyrics[v] || '');
}

// Parts that play along but aren't sung: piano, organ, an instrument. Named so in the text
// format ("part: Piano (left hand)"), they're left out of the parts offered to practice.
export const isAccompaniment = (name) => /^(piano|organ|accompaniment|instrument|guitar|flute|violin)\b/i.test(name || '');

// The song as practiced: one part's notes, with one verse's words.
export function practiceView(song, part = 0, verse = 0) {
  const pi = Math.max(0, Math.min(song.parts.length - 1, part));
  const v = Math.max(0, Math.min(song.verses - 1, verse));
  return {
    ...song, part: pi, verse: v, partName: song.parts[pi].name,
    notes: song.parts[pi].notes.map((n) => ({ midi: n.midi, beat: n.beat, beats: n.beats, lyric: n.lyrics[v] || '' })),
  };
}

// Back to text, so a loaded MIDI file or hymn can be edited like a typed melody.
// Takes a song with parts, or a single-part { title, bpm, meters, notes: [{ ..., lyric }] }.
export function songToText(song) {
  const name = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const len = (b) => (Math.abs(b - 1) < 1e-6 ? '' : `:${+b.toFixed(3)}`);
  const parts = song.parts || [{ name: 'Melody', notes: song.notes.map((n) => ({ ...n, lyrics: [n.lyric || ''] })) }];
  const meters = song.meters?.length ? song.meters : [{ beat: 0, beatsPerBar: song.beatsPerBar || 4, pulse: song.pulse || 1 }];
  const lines = [`title: ${song.title}`, `tempo: ${Math.round(song.bpm)}`];
  if (song.key) lines.push(`key: ${keyName(song.key)}`);
  if (song.transpose === 'octaves') lines.push('transpose: octaves');
  if (song.source) lines.push(`source: ${song.source}`);
  if (song.credit) lines.push(`credit: ${song.credit.replace(/\s+/g, ' ')}`);
  const named = parts.length > 1 || parts[0].name !== 'Melody';
  parts.forEach((part, pi) => {
    if (named) lines.push(`part: ${part.name}`);
    let toks = [], at = 0, mi = pi === 0 ? 0 : meters.length; // time lines go in the first part only
    const flush = () => {
      for (let i = 0; i < toks.length; i += 16) lines.push(`notes: ${toks.slice(i, i + 16).join(' ')}`);
      toks = [];
    };
    // A time signature change goes on its own line, between the notes before and after it.
    const meterUpTo = (beat) => {
      while (mi < meters.length && meters[mi].beat <= beat + 1e-6) {
        const m = meters[mi++];
        if (m.beat > at + 0.01) { toks.push(`r${len(m.beat - at)}`); at = m.beat; }
        const t = meterText(m);
        if (mi > 1 || t !== '4/4') { flush(); lines.push(`time: ${t}`); }
      }
    };
    const notes = part.notes.filter((n) => n.beats > 0.0005); // a note with no length can't be written (or sung)
    for (const n of notes) {
      meterUpTo(n.beat);
      if (n.beat - at > 0.01) toks.push(`r${len(n.beat - at)}`);
      toks.push(name(n.midi) + len(n.beats));
      at = n.beat + n.beats;
    }
    flush();
    const verses = Math.max(0, ...notes.map((n) => (n.lyrics || []).length));
    for (let v = 0; v < verses; v++) {
      const words = notes.map((n) => n.lyrics[v] || '_');
      if (words.every((w) => w === '_')) continue;
      for (let i = 0; i < words.length; i += 16) lines.push(`words${v ? ` ${v + 1}` : ''}: ${words.slice(i, i + 16).join(' ')}`);
    }
  });
  return lines.join('\n');
}

// ---------- MIDI files ----------

// Returns { title, bpm, beatsPerBar, pulse, meters, main, parts: [{ name, notes, lyrics }] }, one part per track and
// channel (drums dropped), each made single-voice by keeping the top note of any chord.
export function parseMidi(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let p = 0;
  const str = (n) => String.fromCharCode(...b.subarray(p, (p += n)));
  const u32 = () => ((b[p++] << 24) | (b[p++] << 16) | (b[p++] << 8) | b[p++]) >>> 0;
  const u16 = () => (b[p++] << 8) | b[p++];
  const vlq = () => {
    let v = 0, c;
    do { c = b[p++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && p < b.length);
    return v;
  };

  if (str(4) !== 'MThd') throw new Error('Not a MIDI file.');
  const hlen = u32();
  const hstart = p;
  u16(); // format
  const ntrks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error('This MIDI file uses SMPTE timing, which is not supported.');
  p = hstart + hlen;

  const tempos = []; // { tick, usPerBeat }
  const times = []; // { tick, num, den }
  let key = null;
  let title = '';
  const parts = new Map(); // "track:channel" -> { name, notes, lyrics }
  const lyrics = [];       // { tick, text }, from any track

  for (let t = 0; t < ntrks && p < b.length; t++) {
    if (str(4) !== 'MTrk') break;
    const end = u32() + p;
    let tick = 0, status = 0, trackName = '';
    const open = new Map(); // "ch:note" -> start tick
    while (p < end) {
      tick += vlq();
      let s = b[p];
      if (s & 0x80) p++; else s = status; // running status
      if (s === 0xff) {
        const type = b[p++], len = vlq();
        const data = b.subarray(p, p + len);
        p += len;
        const text = () => new TextDecoder('latin1').decode(data);
        if (type === 0x51 && len === 3) tempos.push({ tick, usPerBeat: (data[0] << 16) | (data[1] << 8) | data[2] });
        else if (type === 0x58 && len >= 2) times.push({ tick, num: data[0], den: 2 ** data[1] });
        else if (type === 0x03) trackName = text().trim();
        else if (type === 0x59 && len === 2 && !key) key = keyFromFifths((data[0] << 24) >> 24, data[1] === 1);
        else if (type === 0x05) lyrics.push({ tick, text: text() });
        continue;
      }
      if (s === 0xf0 || s === 0xf7) { p += vlq(); continue; }
      status = s;
      const kind = s & 0xf0, ch = s & 0x0f;
      const d1 = b[p++], d2 = kind === 0xc0 || kind === 0xd0 ? 0 : b[p++];
      if (ch === 9 || (kind !== 0x90 && kind !== 0x80)) continue; // channel 10 is drums
      const key = `${ch}:${d1}`;
      if (kind === 0x90 && d2 > 0) {
        if (!open.has(key)) open.set(key, tick);
        continue;
      }
      if (!open.has(key)) continue;
      const id = `${t}:${ch}`;
      if (!parts.has(id)) parts.set(id, { track: t, channel: ch, trackName: '', raw: [] });
      parts.get(id).raw.push({ midi: d1, tick: open.get(key), endTick: tick });
      open.delete(key);
    }
    p = end;
    for (const part of parts.values()) if (part.track === t) part.trackName = trackName;
    if (t === 0 && trackName && !title) title = trackName;
  }

  // Ticks to seconds through the tempo map, then to beats at the opening tempo, so a song
  // that speeds up or slows down still plays in time.
  // Several tempos at one tick (a notation app's default, then the real one): the last wins.
  const lastAtTick = (list) => list.sort((x, y) => x.tick - y.tick).filter((x, i, a) => a[i + 1]?.tick !== x.tick);
  const tempoMap = lastAtTick(tempos);
  tempos.length = 0;
  tempos.push(...tempoMap);
  if (!tempos.length || tempos[0].tick > 0) tempos.unshift({ tick: 0, usPerBeat: 500000 });
  const sec = (tick) => {
    let s = 0;
    for (let i = 0; i < tempos.length; i++) {
      const from = tempos[i].tick, to = i + 1 < tempos.length ? Math.min(tick, tempos[i + 1].tick) : tick;
      if (to <= from) break;
      s += ((to - from) / division) * (tempos[i].usPerBeat / 1e6);
    }
    return s;
  };
  const bpm = 60e6 / tempos[0].usPerBeat;
  const beatOf = (tick) => (sec(tick) * bpm) / 60;
  const cleanLyric = (s) => s.replace(/[\r\n/\\]/g, '').trim();

  const out = [...parts.values()].map((part) => {
    const notes = topLine(part.raw).map((n) => ({
      midi: n.midi, beat: beatOf(n.tick), beats: beatOf(n.endTick) - beatOf(n.tick), lyric: '', tick: n.tick,
    }));
    // A lyric belongs to the note starting at its tick (or just after, within a 16th note).
    let li = 0, count = 0;
    const lyr = [...lyrics].sort((x, y) => x.tick - y.tick);
    for (const n of notes) {
      while (li < lyr.length && lyr[li].tick < n.tick - division / 4) li++;
      if (li < lyr.length && lyr[li].tick <= n.tick + division / 4) {
        n.lyric = cleanLyric(lyr[li++].text);
        if (n.lyric) count++;
      }
      delete n.tick;
    }
    return { name: part.trackName || `Track ${part.track + 1}`, channel: part.channel, notes, lyrics: count };
  }).filter((x) => x.notes.length);

  if (!out.length) throw new Error('No melody notes found in this MIDI file.');
  // One track playing on several channels: tell its parts apart by channel.
  for (const x of out) if (out.filter((y) => y.name === x.name).length > 1) x.name += ` (channel ${x.channel + 1})`;
  // The likeliest vocal line: the part with lyrics, else the one with the most notes.
  const main = out.reduce((best, x, i) => (x.lyrics > out[best].lyrics || (x.lyrics === out[best].lyrics && x.notes.length > out[best].notes.length) ? i : best), 0);
  const song = { meters: [] };
  for (const t of lastAtTick(times)) setMeter(song, beatOf(t.tick), meter(t.num, t.den));
  finishMeters(song, out[main].notes);
  return { title: title || 'MIDI song', bpm, key, beatsPerBar: song.beatsPerBar, pulse: song.pulse, meters: song.meters, parts: out, main };
}

// One note at a time: in a chord keep the highest note, and cut a note short when the next starts.
function topLine(raw) {
  const sorted = [...raw].sort((x, y) => x.tick - y.tick || y.midi - x.midi);
  const line = [];
  for (const n of sorted) {
    const last = line.at(-1);
    if (last && n.tick === last.tick) continue;
    if (last && n.tick < last.endTick) last.endTick = n.tick;
    line.push({ ...n });
  }
  return line.filter((n) => n.endTick > n.tick);
}

// ---------- fitting a song to a voice ----------

export function songRange(notes) {
  const ms = notes.map((n) => n.midi);
  return { low: Math.min(...ms), high: Math.max(...ms) };
}

// Semitones to move the song so its range sits in the middle of the singer's comfortable range.
// With `octaves`, the nearest whole octave, at most one either way: the key stays the same, as
// when men sing a melody an octave below (two octaves off is no way to sing with others).
export const MAX_OCTAVES = 1;
export function fitShift(notes, low, high, octaves = false) {
  const r = songRange(notes);
  const s = Math.round((low + high - r.low - r.high) / 2);
  if (!octaves) return s || 0; // no -0
  // By octave: the one with the most notes inside the range, where a note below the range counts
  // twice against (a voice can't make a note that low at all; one too high can often go to the
  // light voice). Staying put on a tie.
  const score = (x) => insideShare(notes, low, high, x) - (2 * notes.filter((n) => n.midi + x < low).length) / notes.length;
  const options = [0, -12, 12, -24, 24].filter((x) => Math.abs(x) <= 12 * MAX_OCTAVES);
  return options.reduce((best, x) => (score(x) > score(best) ? x : best), 0);
}

// Share of the notes inside a range once moved by `shift` (0-1).
export const insideShare = (notes, low, high, shift = 0) =>
  notes.filter((n) => n.midi + shift >= low && n.midi + shift <= high).length / notes.length;

// Notes in seconds at a given speed (1 = the written tempo), moved by `shift` semitones.
export function timeline(song, speed = 1, shift = 0) {
  const spb = 60 / (song.bpm * speed);
  return song.notes.map((n, i) => ({
    i, midi: n.midi + shift, lyric: n.lyric, start: n.beat * spb, end: (n.beat + n.beats) * spb,
  }));
}

// ---------- scoring a take ----------
//
// frames: [{ t, midi }] in song seconds, sorted, one per pitch detection (about 22 a second);
// midi is fractional, or null when no steady pitch was heard.
//
// The voice is first cut into runs: stretches of steady pitch, split at breaks and at pitch
// changes. Each written note is then matched to the run nearest its pitch that overlaps it,
// so an early or late singer is still scored on the right sung note.

export const PITCH_OK = 0.5;  // semitones: within 50 cents is on the note
const SAME_RUN = 0.7;         // semitones a run may wander (vibrato) before it counts as a new note
const EARLY_WINDOW = 0.35;    // seconds before a note's start an entry can still be its own
const SETTLE = 0.1;           // seconds at the start of a run skipped for pitch (the scoop into it)

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

// Runs of at least two readings: { start, end, frames }. A single stray reading (an octave
// slip) doesn't split a run if the next reading comes back.
export function voiceRuns(frames) {
  const runs = [];
  let cur = null;
  const center = (r) => median(r.frames.slice(-7).map((f) => f.midi));
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.midi == null) { cur = null; continue; }
    if (cur && Math.abs(f.midi - center(cur)) > SAME_RUN) {
      const next = frames[i + 1];
      if (next?.midi != null && Math.abs(next.midi - center(cur)) <= SAME_RUN) continue;
      cur = null;
    }
    if (!cur) runs.push((cur = { frames: [] }));
    cur.frames.push(f);
  }
  return runs.filter((r) => r.frames.length >= 2).map((r) => ({ start: r.frames[0].t, end: r.frames.at(-1).t, frames: r.frames }));
}

// How far off a start can be and still count as on time: about a third of the note,
// between 0.12 and 0.25 seconds.
export const timingTolerance = (note) => Math.max(0.12, Math.min(0.25, (note.end - note.start) * 0.35));

// Returns { missed, coverage, cents, octave, inTune, pitch, onsetMs, timing, runStart }.
//   coverage: share of the note's length with a steady pitch heard (0-1)
//   cents:    typical distance from the target once settled (octave removed)
//   octave:   +1 / -1 if sung an octave high / low (then scored against that octave)
//   inTune:   share of the sung note's readings within 50 cents (0-1)
//   pitch:    'ok' | 'sharp' | 'flat'
//   onsetMs:  when the singer arrived on their pitch for this note, relative to its start
//             (negative = early), or null if it ran on from the note before without a break
//   timing:   'ok' | 'early' | 'late' | null
//   runStart: which run was used, so the next note doesn't time the same entry again
// prevScore is this function's result for the note before.
export function scoreNote(note, prev, frames, prevScore = null) {
  const dur = note.end - note.start;
  const from = Math.max(note.start - EARLY_WINDOW, prev ? (prev.start + prev.end) / 2 : -Infinity);
  const nearby = frames.filter((f) => f.t >= from - 2 && f.t < note.end + 0.5);
  const inNote = nearby.filter((f) => f.t >= note.start && f.t < note.end);
  const coverage = inNote.length ? inNote.filter((f) => f.midi != null).length / inNote.length : 0;
  const missed = { missed: true, coverage, cents: null, octave: 0, inTune: 0, pitch: null, onsetMs: null, timing: null, runStart: null };
  if (coverage < 0.25) return missed;

  // Candidates: runs that cover enough of the note, or that start in its entry window.
  const need = Math.min(0.12, dur * 0.4);
  const fold = (d) => d - 12 * Math.round(d / 12);
  let best = null;
  for (const r of voiceRuns(nearby)) {
    const overlap = Math.min(r.end, note.end) - Math.max(r.start, note.start);
    const entersHere = r.start >= from && r.start < note.end;
    if (overlap < need && !entersHere) continue;
    const settled = r.frames.filter((f) => f.t >= r.start + SETTLE);
    const diffs = (settled.length >= 2 ? settled : r.frames).map((f) => f.midi - note.midi);
    const d = median(diffs);
    // Nearest pitch first, then the entry nearest the beat; the run the note before used
    // only if there is nothing else (a repeated note sung without a break).
    const used = prevScore && prevScore.runStart === r.start ? 2 : 0;
    // The written octave only breaks near-ties: the detector can read a note an octave off
    // for a moment, which splits it into two runs, and the first is still the real entry.
    const score = Math.abs(fold(d)) * 4 + (Math.abs(d) > 6 ? 0.1 : 0) + Math.min(1, Math.abs(r.start - note.start)) + used;
    if (!best || score < best.score) best = { r, diffs, d, score };
  }
  if (!best) return missed;

  const { r, d } = best;
  const octave = Math.abs(d) > 6 && Math.abs(fold(d)) < 3 ? Math.round(d / 12) : 0;
  const diffs = best.diffs.map((x) => x - 12 * octave);
  const med = median(diffs);
  const pitch = Math.abs(med) <= PITCH_OK ? 'ok' : med > 0 ? 'sharp' : 'flat';
  const inTune = diffs.filter((x) => Math.abs(x) <= PITCH_OK).length / diffs.length;

  const ranOn = r.start < from || (prevScore && prevScore.runStart === r.start);
  const onsetMs = ranOn ? null : Math.round((r.start - note.start) * 1000);
  const tol = timingTolerance(note) * 1000;
  const timing = onsetMs == null ? null : onsetMs < -tol ? 'early' : onsetMs > tol ? 'late' : 'ok';
  return { missed: false, coverage, cents: Math.round(med * 100), octave, inTune, pitch, onsetMs, timing, runStart: r.start };
}

export function scoreTake(notes, frames) {
  const scores = [];
  notes.forEach((n, i) => scores.push(scoreNote(n, notes[i - 1], frames, scores[i - 1])));
  return scores;
}

export function summarizeTake(scores) {
  const sung = scores.filter((s) => !s.missed);
  const timed = sung.filter((s) => s.timing);
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const count = (list, f) => list.filter(f).length;
  return {
    notes: scores.length,
    sung: sung.length,
    missed: scores.length - sung.length,
    inTune: count(sung, (s) => s.pitch === 'ok'),
    sharp: count(sung, (s) => s.pitch === 'sharp'),
    flat: count(sung, (s) => s.pitch === 'flat'),
    octave: count(sung, (s) => s.octave !== 0),
    timed: timed.length,
    onTime: count(timed, (s) => s.timing === 'ok'),
    early: count(timed, (s) => s.timing === 'early'),
    late: count(timed, (s) => s.timing === 'late'),
    avgCents: mean(sung.map((s) => s.cents)),
    typicalCents: mean(sung.map((s) => Math.abs(s.cents))),
    avgOnsetMs: mean(timed.map((s) => s.onsetMs)),
  };
}
