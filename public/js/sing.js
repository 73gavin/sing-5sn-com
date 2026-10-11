// Song practice: pick or load a melody, sing along after a count-in, and see note by note
// whether you were on pitch and on time. The notes scroll past a "now" line like a piano roll;
// your voice draws over them. Scoring lives in song.js; this file is the page.

import { parseSong, parseMidi, songToText, songRange, fitShift, insideShare, timeline, scoreNote, summarizeTake, PITCH_OK, barStarts, pickupBeats, barNumber, practiceView, keyName, isAccompaniment } from './song.js';
import { SONGS } from './songs.js';
import { midiToName, midiToFreq, freqToMidi, isBlackKey } from './notes.js';
import { scheduleTone, scheduleClick } from './audio.js';
import { songPrompt } from './report.js';
import { unpack, bookmarklet, BOOKS } from './hymn.js';
import { aiStatus, aiAsk, bridgeFile } from './ai.js';
import * as lib from './library.js';
import { popularity, POPULARITY_SOURCE } from './popularity.js';

const $ = (id) => document.getElementById(id);
const hz = (m) => midiToFreq(m).toFixed(1);
const named = (m) => `${midiToName(m)} (${hz(m)} Hz)`;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const TEXT = 'voiceRange.songText';   // the last melody typed or loaded
const PREFS = 'voiceRange.songPrefs'; // { play, click, syncMs, syncModel, range, partName }
const TAKES = 'voiceRange.songTakes'; // { [title]: [{ date, inTune, onTime, timed, notes }] }
const PX_PER_BEAT = 56;
const NOW_AT = 0.25; // the "now" line sits a quarter of the way across

let env;             // hooks into app.js: openInput, mic, bright, mute, lastRange, close
let song = null;     // practiceView: the part being practiced, plus every part in song.parts
let libRef = null;   // { c, id, title, note } when the song came from the library
let shift = 0, speed = 1;
let keepKey = false; // move only by whole octaves, so the key matches singing with others
let run = null;      // the take or listen-through in progress
let review = null;   // the last finished take: { notes, frames, scores, spb }
// play: what sounds while you sing. 'others' (everyone but me) is the default: the other parts
// around you and a gap for yours, as in a choir, and your own notes can't reach the mic and be
// scored as you. On a one-part song it plays nothing, so speakers are safe.
// fitFor: what the library's marks and best-first order measure: 'part' (your part, to sing
// with a choir or congregation) or 'melody' (the tune, to sing on your own).
const prefs = { play: 'others', click: true, syncMs: null, partName: null, fitFor: 'part', ...JSON.parse(localStorage.getItem(PREFS) || '{}') };
const savePrefs = () => localStorage.setItem(PREFS, JSON.stringify(prefs));

// Timing. The app already allows for the detector's own delay (DETECT_LAG plus half the time
// between detections) and the mic and speaker delays the browser reports. The adjustment
// covers the rest, which the browser doesn't report: about 90 ms on a laptop and a phone
// measured with their built-in speakers and mics (129 and 152 ms before the detector delay
// was counted). Until "Measure it" runs on a device, that estimate is used.
const DETECT_LAG = 0.88;   // of the analysis buffer: a change of note shows about 75 ms after it happens (4096 at 48 kHz)
const DEFAULT_SYNC_MS = 90;
const SYNC_MODEL = 2;      // version 1 counted 60 ms for the detector and nothing for the gap
if (prefs.syncModel !== SYNC_MODEL) {
  // Older saved values included the 40 ms now counted in code; 0 was the old default.
  prefs.syncMs = prefs.syncMs ? prefs.syncMs - 40 : null;
  prefs.syncModel = SYNC_MODEL;
  savePrefs();
}
const syncMs = () => prefs.syncMs ?? DEFAULT_SYNC_MS;

export const songRunning = () => run != null;
const PAGE_TITLE = document.title; // put back when song practice closes

// The range songs are fitted to: one set on this card, else the latest range test.
const myRange = () => prefs.range || env.lastRange();

// The move that fits the song to the range (only whole octaves while keeping the key), or 0.
// In a hymn (several parts, keeping the key) only the melody, the first part, is moved: men
// sing it an octave lower. Alto, tenor, and bass lines are written where those voices sing,
// and moving one an octave can put it under the bass.
function fitted(notes = song.notes) {
  const r = myRange();
  if (!r || (keepKey && song.parts.length > 1 && song.part !== 0)) return 0;
  return fitShift(notes, r.low, r.high, keepKey);
}

function fillRangePickers() {
  for (const id of ['song-range-low', 'song-range-high']) {
    const sel = $(id);
    sel.replaceChildren(new Option('not set', ''));
    for (let m = 28; m <= 88; m++) sel.append(new Option(named(m), String(m)));
  }
}

function showRangePickers() {
  const r = myRange();
  $('song-range-low').value = r ? String(r.low) : '';
  $('song-range-high').value = r ? String(r.high) : '';
  $('song-range-from').textContent = prefs.range ? 'Set here.' : r ? 'From your latest range test.' : '';
}

// Picking one end fills in the other an octave away, to adjust after; "not set" on either
// end goes back to the range test.
function pickRange(e) {
  const lowSel = $('song-range-low'), highSel = $('song-range-high');
  if (!e.target.value) prefs.range = null;
  else {
    let low = Number(lowSel.value || Number(highSel.value) - 12);
    let high = Number(highSel.value || Number(lowSel.value) + 12);
    if (low > high) [low, high] = e.target === lowSel ? [low, low + 12] : [high - 12, high];
    prefs.range = { low: Math.max(28, low), high: Math.min(88, high) };
  }
  savePrefs();
  showRangePickers();
  const r = myRange();
  if (r && song) moveKey(fitted() - shift, true);
  else if (song) showInfo();
  showResults(); // the library's range marks follow the new range
}

// ---------- choosing a song ----------

function fillSongList() {
  const sel = $('song-select');
  sel.replaceChildren();
  SONGS.forEach((text, i) => sel.append(new Option(parseSong(text).title, String(i))));
  const own = localStorage.getItem(TEXT);
  if (own) {
    try {
      sel.append(new Option(`Your song: ${parseSong(own).title}`, 'own'));
      $('song-text').value = own;
    } catch {
      localStorage.removeItem(TEXT);
    }
  }
  if (libRef) sel.append(new Option(`Library: ${libRef.title}`, 'lib'));
}

// hint: the part to start on when the singer hasn't picked one by name before.
function useSong(s, hint = 0) {
  stopRun();
  // Start on your part; when the library is set to fit for the melody (singing on your own),
  // start on the melody instead.
  const named = prefs.fitFor === 'melody' ? -1 : s.parts.findIndex((x) => x.name === prefs.partName);
  const firstSung = Math.max(0, s.parts.findIndex((x) => !isAccompaniment(x.name)));
  song = practiceView(s, named >= 0 ? named : isAccompaniment(s.parts[hint]?.name) ? firstSung : hint, 0);
  fillPartPickers();
  setKeepKey(song.transpose === 'octaves');
  shift = fitted();
  review = null;
  $('song-result').hidden = true;
  $('song-note').textContent = '';
  $('song-status').textContent = '';
  showInfo();
  renderLane();
}

// The melody is the first part: the top line of the first staff (Soprano in SATB, Tenor 1 in
// a men's choir arrangement, Part 1 in a two-part song). Named so, for singing on your own.
const partLabel = (name, i) => (i === 0 && name !== 'Melody' && song.parts.length > 1 ? `${name} (melody)` : name);

function fillPartPickers() {
  const part = $('song-voice'), verse = $('song-verse');
  const sung = song.parts.map((x, i) => [x, i]).filter(([x]) => !isAccompaniment(x.name));
  part.replaceChildren(...sung.map(([x, i]) => new Option(partLabel(x.name, i), String(i))));
  part.value = String(song.part);
  $('song-voice-label').hidden = sung.length < 2;
  verse.replaceChildren(...Array.from({ length: song.verses }, (_, v) => new Option(`Verse ${v + 1}`, String(v))));
  verse.value = String(song.verse);
  $('song-verse-label').hidden = song.verses < 2;
}

// Another part fits the voice differently, so it's moved to the range again.
function pickPart(i) {
  song = practiceView(song, i, song.verse);
  prefs.partName = song.partName;
  savePrefs();
  if (myRange()) shift = fitted();
  changed();
  showResults(); // the library's marks follow your part
}

function pickVerse(v) {
  song = practiceView(song, song.part, v);
  changed();
}

// Keeping the key: the buttons move by octaves, and a move out of the key snaps back to one.
function setKeepKey(on) {
  keepKey = on;
  $('song-keep').checked = on;
  $('song-lower').textContent = on ? 'Octave down' : 'Lower';
  $('song-higher').textContent = on ? 'Octave up' : 'Higher';
  $('song-lower').setAttribute('aria-label', on ? 'Octave down' : 'Lower key');
  $('song-higher').setAttribute('aria-label', on ? 'Octave up' : 'Higher key');
}

function changed() {
  review = null;
  $('song-result').hidden = true;
  $('song-note').textContent = '';
  showInfo();
  renderLane();
}

// ---------- the song in the address (#song=...&shift=...&speed=...) ----------
//
// The part after "#" never reaches the server, so this works on the static site too. A
// refresh comes back to the same song, key, and speed, and a link or bookmark carries them
// to another device. Built-in songs go by name; your own melody is packed into the link.

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function packText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return b64url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

async function unpackText(packed) {
  const stream = new Blob([unb64url(packed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

let hashJob = 0;
async function updateHash() {
  if ($('song').hidden || !song) return;
  const job = ++hashJob;
  const own = $('song-select').value === 'own';
  const p = new URLSearchParams(libRef ? { song: 'lib', c: libRef.c, id: libRef.id } : { song: own ? 'own' : slug(song.title) });
  if (song.parts.length > 1) p.set('part', slug(song.partName));
  if (song.transpose === 'octaves' && !keepKey) p.set('anykey', '1');
  if (song.verse) p.set('verse', String(song.verse + 1));
  if (shift) p.set('shift', String(shift));
  if (speed !== 1) p.set('speed', String(speed));
  if (own) p.set('melody', await packText(localStorage.getItem(TEXT)));
  if (job === hashJob && !$('song').hidden) history.replaceState(null, '', `${location.pathname}${location.search}#${p}`);
}

// Opens the song named in the address, at its key and speed. Returns false if it can't.
async function restore(p) {
  if (p.has('open')) {
    // A library or set file the local helper shares (#open=/api/local/<file>), e.g. your
    // library on your phone. Only the helper's own files, never another site's.
    const path = p.get('open');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    $('library').open = true;
    if (/^\/api\/local\/[^/]+$/.test(path)) {
      libStatus('Opening the library from the helper...');
      try { await openContents(await bridgeFile(path)); } catch (e) { libStatus(`Couldn't open it: ${e.message}`); }
    }
    $('library').scrollIntoView({ behavior: 'smooth' });
    if (!song) pick();
    return true;
  }
  if (p.has('collected')) {
    // Songs from the "Collect hymns" bookmark: built into the library, then back to the library.
    try {
      await addCollected(await unpack(p.get('collected')));
    } catch (e) {
      libStatus(`Could not add those songs: ${e.message}`);
    }
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    $('library').open = true;
    $('library').scrollIntoView({ behavior: 'smooth' });
    if (!song) pick();
    return true;
  }
  if (p.get('song') === 'lib') {
    const all = await lib.loadAll();
    const c = all.find((x) => x.id === p.get('c'));
    const s = c?.songs.find((x) => x.id === p.get('id'));
    if (s) openLibSong(c, s);
    else $('song-status').textContent = 'That song is not in this browser\'s library. Open the library or set file first.';
  } else if (p.has('import')) {
    // A song sent by the "Send to Sing" bookmark: kept in the library and as your own song.
    try {
      $('song-status').textContent = 'Loading the song...';
      const data = await unpack(p.get('import'));
      const entry = await lib.buildSong(data, await aiFit(), (v) => ($('song-status').textContent = `Fitting ${v} to the notes...`));
      const cid = data.book || 'sent';
      const name = BOOKS[data.book] || 'Sent from churchofjesuschrist.org';
      await lib.saveCollection(lib.merge(await lib.loadAll(), [{ id: cid, name, kind: 'songbook', songs: [entry] }]).find((c) => c.id === cid));
      $('song-text').value = entry.text;
      saveOwn(entry.text, parseSong(entry.text));
      $('song-status').textContent = `Loaded "${song.title}". Pick your part and verse above.${entry.unfitted ? ` ${unfittedText(entry)}` : ''}`;
      refreshLibrary();
    } catch (e) {
      $('song-status').textContent = `Could not load that song: ${e.message}`;
    }
  } else if (p.has('melody')) {
    let text;
    try {
      text = await unpackText(p.get('melody'));
      parseSong(text);
    } catch {
      text = null;
    }
    if (text) {
      $('song-text').value = text;
      saveOwn(text, parseSong(text));
    }
  } else {
    const i = SONGS.findIndex((t) => slug(parseSong(t).title) === p.get('song'));
    if (i >= 0 || p.get('song') === 'own') {
      $('song-select').value = i >= 0 ? String(i) : 'own';
      if (!$('song-select').value) $('song-select').value = '0'; // no saved own song here
      pick();
    }
  }
  if (!song) return false;
  const pi = song.parts.findIndex((x) => slug(x.name) === p.get('part'));
  song = practiceView(song, pi >= 0 ? pi : song.part, Number(p.get('verse') || 1) - 1);
  // A link that opens a part makes it your part, as picking it would (the library marks use it).
  if (pi >= 0 && !isAccompaniment(song.partName) && prefs.partName !== song.partName) {
    prefs.partName = song.partName;
    savePrefs();
    showResults();
  }
  fillPartPickers();
  const sp = Number(p.get('speed'));
  if ([...$('song-speed').options].some((o) => Number(o.value) === sp)) {
    speed = sp;
    $('song-speed').value = String(sp);
  }
  if (p.get('anykey') === '1') setKeepKey(false);
  if (p.has('shift')) shift = Math.max(-36, Math.min(36, Math.round(Number(p.get('shift'))) || 0));
  if (keepKey) shift = 12 * Math.max(-1, Math.min(1, Math.round(shift / 12))); // a link can't move a hymn out of its key
  showInfo();
  renderLane();
  return true;
}

function pick() {
  const v = $('song-select').value;
  if (v === 'lib') return;
  libRef = null;
  fillSongList();
  $('song-select').value = v;
  const text = v === 'own' ? localStorage.getItem(TEXT) : SONGS[Number(v)];
  useSong(parseSong(text));
}

function loadTyped() {
  const err = $('song-error');
  try {
    const s = parseSong($('song-text').value);
    err.hidden = true;
    saveOwn($('song-text').value, s);
  } catch (e) {
    err.hidden = false;
    err.textContent = e.message;
  }
}

function saveOwn(text, s, hint = 0) {
  libRef = null;
  localStorage.setItem(TEXT, text);
  fillSongList();
  $('song-select').value = 'own';
  useSong(s, hint);
}

// MIDI goes through the text format, every part included, so it can be edited and is kept
// like a typed melody. It starts on the likeliest melody unless a part was picked by name before.
async function loadMidi(file) {
  const err = $('song-error');
  try {
    const m = parseMidi(new Uint8Array(await file.arrayBuffer()));
    if (m.title === 'MIDI song') m.title = file.name.replace(/\.midi?$/i, '');
    const parts = m.parts.map((x) => ({ name: x.name, notes: x.notes.map((n) => ({ ...n, lyrics: [n.lyric] })) }));
    const text = songToText({ title: m.title, bpm: m.bpm, key: m.key, meters: m.meters, parts });
    $('song-text').value = text;
    err.hidden = true;
    saveOwn(text, parseSong(text), m.main);
  } catch (e) {
    err.hidden = false;
    err.textContent = `Could not read that MIDI file: ${e.message}`;
  }
}

function showInfo() {
  const r = songRange(song.notes);
  const lo = r.low + shift, hi = r.high + shift;
  const secs = Math.round(((song.notes.at(-1).beat + song.notes.at(-1).beats) * 60) / (song.bpm * speed));
  const which = [song.parts.length > 1 && `${escapeHtml(partLabel(song.partName, song.part))} part`, song.verses > 1 && `verse ${song.verse + 1} of ${song.verses}`].filter(Boolean).join(', ');
  const parts = [`<b>${escapeHtml(song.title)}</b>${which ? ` (${which})` : ''}: ${song.notes.length} notes, about ${secs} seconds.
    Lowest note ${named(lo)}, highest ${named(hi)}.`];
  // Key names for those who read music; steps for those who don't.
  const steps = `${Math.abs(shift)} step${Math.abs(shift) > 1 ? 's' : ''} ${shift > 0 ? 'higher' : 'lower'}`;
  const octaves = shift && shift % 12 === 0 ? `${Math.abs(shift) / 12 > 1 ? `${Math.abs(shift) / 12} octaves` : 'an octave'} ${shift > 0 ? 'higher' : 'lower'}` : '';
  const written = song.key ? keyName(song.key) : null;
  if (shift === 0) parts.push(written ? `Written key, ${written}.` : 'Written key.');
  else if (octaves) parts.push(`${written ? `Key of ${written}, as written` : 'Written key'}, sung ${octaves}.`);
  else parts.push(written ? `Written in ${written}, moved ${steps} to ${keyName(song.key, shift)}.` : `Moved ${steps} than written.`);
  if (song.transpose === 'octaves' && shift % 12) {
    parts.push(`<span class="warn">Not the hymnbook key: the congregation sings in ${written || 'the written key'}. Fine for practice on your own.</span>`);
  }
  $('song-key').textContent = song.key ? keyName(song.key, shift) : shift === 0 ? 'as written' : `${shift > 0 ? '+' : ''}${shift}`;
  $('song-key').title = song.key ? 'The key the song is in now' : 'Steps up or down from the written key';
  const range = myRange();
  if (range) {
    const out = song.notes.filter((n) => n.midi + shift < range.low || n.midi + shift > range.high).length;
    parts.push(`Your comfortable range: ${midiToName(range.low)} to ${midiToName(range.high)}${out ? `; ${out} note${out > 1 ? 's are' : ' is'} outside it` : ', and the whole song fits'}.`);
  } else if (lo < 40 || hi > 81) {
    // Outside E2-A5, few voices are comfortable, and the detector struggles at the very bottom.
    parts.push(`<span class="warn">That's very ${lo < 40 ? 'low' : 'high'} for most voices.</span>`);
  }
  // A part that fits the voice better as written beats moving the key. Parts are compared
  // exactly as written: a hymnbook's tenor and bass lines are already where men sing, and
  // moving a harmony part an octave can put it under the bass.
  if (range && song.parts.length > 1) {
    const share = (i) => insideShare(practiceView(song, i, 0).notes, range.low, range.high, 0);
    const now = insideShare(song.notes, range.low, range.high, shift);
    const best = song.parts.map((x, i) => ({ i, share: isAccompaniment(x.name) ? -1 : share(i) })).reduce((a, b) => (b.share > a.share ? b : a));
    if (best.i !== song.part && best.share - now >= 0.1) {
      parts.push(`<span class="hint">Tip: the ${escapeHtml(song.parts[best.i].name)} part fits your range better as written (${Math.round(best.share * 100)}% of its notes).</span>`);
    }
  }
  if (libRef?.note) parts.push(`<br><b>Note:</b> ${escapeHtml(libRef.note)}`);
  if (song.source || song.credit) {
    const src = /^https?:\/\//.test(song.source || '') ? `<a href="${escapeHtml(song.source)}" target="_blank" rel="noopener">Source</a>` : '';
    parts.push(`<br><span class="hint">${[src, song.credit && escapeHtml(song.credit)].filter(Boolean).join(' | ')}</span>`);
  }
  $('song-info').innerHTML = parts.join(' ');
  // The tab (and a bookmark) names the song, and the part when there are several.
  document.title = `${song.title}${song.parts.length > 1 ? ` - ${song.partName}` : ''} | Sing`;
  $('song-fit').disabled = !range;
  $('song-fit').title = range ? '' : 'Set your comfortable range below first';
  updateHash();
}

// by: steps; while keeping the key, one step either way is a whole octave. exact: move as given.
function moveKey(by, exact = false) {
  if (run) return;
  if (keepKey && !exact) by = 12 * Math.sign(by);
  const limit = keepKey ? 12 : 36; // keeping the key: one octave either way
  shift = Math.max(-limit, Math.min(limit, shift + by));
  review = null;
  $('song-result').hidden = true;
  showInfo();
  renderLane();
}

// ---------- playing and listening ----------

// Timing calibration: the app plays a melody out loud and scores itself through the mic.
// How late the notes come back is the delay of this speaker and mic, which then becomes
// the timing adjustment. The notes run into each other, as in a song (the detector picks up a
// change of note later than a note after silence), and each is a few steps from the last so
// every entry is clear.
const CALIBRATION = parseSong(`title: Timing check
tempo: 100
notes: A4 E4 C5 G4 D5 A4 E4 C5 G4 D5 A4 E4 C5 G4 D5 A4`);

// mode: 'sing' | 'listen' | 'calibrate'
async function begin(mode) {
  if (!song) return;
  stopRun();
  if (!(await env.openInput())) return;
  const mic = env.mic();
  const ctx = mic.ctx;
  if (ctx.state === 'suspended') await ctx.resume();

  const calibrating = mode === 'calibrate';
  const sg = calibrating ? CALIBRATION : song;
  const notes = calibrating ? timeline(sg) : timeline(sg, speed, shift);
  const spb = 60 / (sg.bpm * (calibrating ? 1 : speed));
  const pulse = spb * sg.pulse;
  const perBar = Math.round(sg.beatsPerBar / sg.pulse) || 1;
  // Count in one bar of the main meter (two if it has fewer than three clicks), ending where
  // the first full bar starts, so a pickup comes in on the right count.
  const countIn = perBar < 3 ? perBar * 2 : perBar; // in clicks
  const firstFull = pickupBeats(sg) * spb;        // seconds after the first note
  const countFrom = firstFull - countIn * pulse;  // first click, in song seconds (negative)
  const t0 = ctx.currentTime + 0.3 - countFrom;
  const end = notes.at(-1).end;

  // Everything for this run goes through one gain node, so Stop can cut it all at once.
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const sources = [];
  const bars = new Set(barStarts(sg, end / spb + 1).map((b) => Math.round(b * 1000)));
  for (let k = 0; countFrom + k * pulse < end; k++) {
    const t = countFrom + k * pulse;
    if (t >= -1e-6 && (!prefs.click || calibrating)) break;
    const accent = t < -1e-6 ? k % perBar === 0 : bars.has(Math.round((t / spb) * 1000));
    sources.push(scheduleClick(ctx, t0 + t, accent, master));
  }
  // What sounds: listening plays every part (just yours on "Only my part"); singing plays what
  // the singer chose. Your part is a little louder than the others, so it can be followed.
  const others = calibrating ? [] : song.parts.map((_, i) => i).filter((i) => i !== song.part)
    .map((i) => timeline(practiceView(song, i, song.verse), speed, shift));
  const play = mode === 'listen' ? (prefs.play === 'mine' ? 'mine' : 'all') : mode === 'calibrate' ? 'mine' : prefs.play;
  const voices = [];
  if (play === 'mine' || play === 'all') voices.push({ notes, level: others.length ? 0.2 : 0.25 });
  if (play === 'others' || play === 'all') for (const o of others) voices.push({ notes: o, level: 0.1 });
  for (const v of voices) {
    for (const n of v.notes) {
      // A little gap before each next note, so repeated notes are heard as separate.
      const len = Math.max(0.08, n.end - n.start - 0.04);
      sources.push(scheduleTone(ctx, midiToFreq(n.midi), t0 + n.start, len, env.bright(), master, v.level));
    }
  }
  // Ignore the mic during a listen-through, so the melody from the speaker isn't scored.
  if (mode === 'listen') env.mute(performance.now() + (t0 - ctx.currentTime + end + 0.6) * 1000);

  run = {
    mode, song: sg, ctx, t0, notes, others, spb, pulse, countIn, end, master, sources,
    // When the speaker plays a beat, the ear hears it later by the output latency. The voice
    // reaches the detector later by the mic latency, and the detector notices a new note
    // DETECT_LAG of a buffer later, plus on average half the gap between detections.
    outLat: (ctx.outputLatency || 0) + (ctx.baseLatency || 0),
    inLat: mic.inputLatency || 0,
    analysis: (mic.size * DETECT_LAG) / mic.sampleRate,
    lastTick: null, tickGap: 0.05,
    frames: [], scores: [], next: 0,
  };
  if (!calibrating) review = null;
  $('song-lane').parentElement.scrollLeft = 0;
  $('song-result').hidden = true;
  $('song-note').textContent = '';
  $('song-status').textContent = {
    sing: 'Get ready. Start singing on the first bar after the clicks.',
    listen: 'Listen and follow the line. The mic is off.',
    calibrate: 'Measuring: stay quiet while the app plays and listens to itself.',
  }[mode];
  $('song-cal-result').textContent = '';
  setButtons();
  document.body.classList.add('song-live');
  $('song-lane').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function stopRun() {
  if (!run) return;
  const t = run.ctx.currentTime;
  run.master.gain.setValueAtTime(run.master.gain.value, t);
  run.master.gain.linearRampToValueAtTime(0, t + 0.05);
  for (const s of run.sources) {
    try { s.stop(t + 0.06); } catch { /* already stopped */ }
  }
  if (run.mode === 'listen') env.mute(performance.now() + 300);
  run = null;
  document.body.classList.remove('song-live');
  setButtons();
}

function setButtons() {
  $('song-sing').hidden = !!run;
  $('song-listen').hidden = !!run;
  $('song-stop').hidden = !run;
  for (const id of ['song-keep', 'song-range-low', 'song-range-high', 'song-calibrate', 'song-sync-down', 'song-sync-up', 'song-select', 'song-voice', 'song-verse', 'song-play', 'song-lower', 'song-higher', 'song-fit', 'song-speed', 'song-text', 'song-load', 'song-file']) {
    $(id).disabled = !!run || (id === 'song-fit' && !myRange());
  }
}

// Called by the app for every pitch detection (about 22 a second) with Hz or null.
export function songTick(hzNow) {
  if (!run) return;
  const c = run.ctx.currentTime;
  if (run.mode === 'listen') {
    if (c - run.outLat - run.t0 > run.end + 0.3) {
      stopRun();
      $('song-status').textContent = 'Ready when you are: press Sing it.';
      renderLane();
    }
    return;
  }
  if (run.lastTick != null) run.tickGap += (Math.min(0.2, c - run.lastTick) - run.tickGap) * 0.1;
  run.lastTick = c;
  const t = c - run.analysis - run.tickGap / 2 - run.inLat - run.outLat - syncMs() / 1000 - run.t0;
  run.frames.push({ t, midi: hzNow ? freqToMidi(hzNow) : null });
  const { notes } = run;
  while (run.next < notes.length && t > notes[run.next].end + 0.05) {
    const i = run.next++;
    const s = scoreNote(notes[i], notes[i - 1], run.frames, run.scores[i - 1]);
    run.scores[i] = s;
    $('song-status').textContent = `${notes[i].lyric ? `"${notes[i].lyric}" ` : ''}${midiToName(notes[i].midi)}: ${shortVerdict(s)}`;
  }
  if (t > run.end + 0.4) finish();
}

function finish() {
  const { notes, frames, scores, spb } = run;
  if (run.mode === 'calibrate') return finishCalibration(scores);
  stopRun();
  review = { notes, frames, scores, spb };
  showTake();
  renderLane();
}

function finishCalibration(scores) {
  stopRun();
  const out = $('song-cal-result');
  const onsets = scores.filter((s) => s && !s.missed && s.onsetMs != null).map((s) => s.onsetMs).sort((a, b) => a - b);
  if (onsets.length < 6) {
    out.textContent = `Only heard ${onsets.length} of ${scores.length} test notes, not enough to measure. Turn the volume up, take headphones off so the mic can hear the speaker, and try again.`;
  } else {
    const delay = onsets[Math.floor(onsets.length / 2)];
    const spread = onsets.at(-1) - onsets[0];
    prefs.syncMs = Math.max(-500, Math.min(500, Math.round(syncMs() + delay)));
    savePrefs();
    showSync();
    out.textContent = `Heard ${onsets.length} of ${scores.length} notes, ${Math.abs(delay)} ms ${delay >= 0 ? 'late' : 'early'} on average. Timing adjustment set to ${$('song-sync').textContent}.`
      + (spread > 100 ? ' The readings varied a lot, so a quieter room may give a better measurement.' : '');
  }
  $('song-status').textContent = out.textContent;
  renderLane();
}

const showSync = () => {
  const v = syncMs();
  $('song-sync').textContent = `${v > 0 ? '+' : ''}${v} ms`;
  $('song-sync-note').textContent = prefs.syncMs == null ? 'Estimated. Press Measure it for this device.' : 'Measured or set on this device.';
};

// ---------- words ----------

function shortVerdict(s) {
  if (s.missed) return 'not heard';
  const bits = [];
  if (s.octave) bits.push(`an octave ${s.octave > 0 ? 'high' : 'low'}`);
  bits.push(s.pitch === 'ok' ? 'on pitch' : `${Math.abs(s.cents)} cents ${s.pitch}`);
  bits.push(s.timing == null ? 'start unclear' : s.timing === 'ok' ? 'on time' : s.timing);
  return bits.join(', ');
}

// Seconds as a share of a beat, which is easier to feel than milliseconds.
function beatWords(ms, spb) {
  const x = Math.abs(ms) / 1000 / spb;
  if (x < 0.15) return 'a hair';
  const steps = [[0.25, 'about a quarter of a beat'], [0.5, 'about half a beat'], [0.75, 'about three quarters of a beat'], [1, 'about a whole beat']];
  return steps.reduce((best, s) => (Math.abs(s[0] - x) < Math.abs(best[0] - x) ? s : best))[1];
}

function describe(note, s, spb) {
  const head = `<b>${named(note.midi)}</b>${note.lyric ? `, "${escapeHtml(note.lyric)}"` : ''}: `;
  if (!s) return head + 'not sung yet.';
  if (s.missed) return head + 'no steady pitch heard on this note. Sing a little louder, or check you came in at the right time.';
  const out = [];
  if (s.octave) out.push(`You sang it an octave ${s.octave > 0 ? 'higher' : 'lower'} than written, which is fine if the song sits outside your voice (try "Fit to my range"). Scored against that octave:`);
  const c = Math.abs(s.cents);
  if (s.pitch === 'ok') out.push(`on pitch (${c < 10 ? 'dead on' : `${c} cents ${s.cents > 0 ? 'high' : 'low'}`}, within the 50 allowed).`);
  else {
    const size = c >= 100 ? `about ${Math.round(c / 100)} semitone${Math.round(c / 100) > 1 ? 's' : ''}` : `${c} cents`;
    out.push(`${s.pitch} (${s.pitch === 'sharp' ? 'too high' : 'too low'}) by ${size}. Aim ${s.pitch === 'sharp' ? 'a little lower' : 'a little higher'}.`);
  }
  out.push(`${Math.round(s.inTune * 100)}% of it was within 50 cents.`);
  if (s.timing == null) out.push('Start: unclear (same note as the one before, with no break to hear).');
  else if (s.timing === 'ok') out.push(`Started on time (${s.onsetMs > 0 ? '+' : ''}${s.onsetMs} ms).`);
  else out.push(`Started ${s.timing}: ${(Math.abs(s.onsetMs) / 1000).toFixed(2)} s, ${beatWords(s.onsetMs, spb)} ${s.timing === 'early' ? 'before' : 'after'} the beat.`);
  return head + out.join(' ');
}

function showTake() {
  const { notes, scores, spb } = review;
  const sum = summarizeTake(scores);
  const takes = JSON.parse(localStorage.getItem(TAKES) || '{}');
  const key = song.parts.length > 1 ? `${song.title} | ${song.partName}` : song.title;
  const past = (takes[key] || []).at(-1);
  takes[key] = [...(takes[key] || []), { date: new Date().toISOString(), inTune: sum.inTune, onTime: sum.onTime, timed: sum.timed, notes: sum.notes }].slice(-20);
  localStorage.setItem(TAKES, JSON.stringify(takes));

  const rows = [];
  rows.push(`<b>${sum.inTune} of ${sum.notes}</b> notes on pitch <span class="hint">(within 50 cents, half a piano key)</span>`);
  if (sum.timed) rows.push(`<b>${sum.onTime} of ${sum.timed}</b> notes started on time${sum.early ? `, ${sum.early} early` : ''}${sum.late ? `, ${sum.late} late` : ''}`);
  if (past) rows.push(`<span class="hint">Last time: ${past.inTune} of ${past.notes} on pitch${past.timed ? `, ${past.onTime} of ${past.timed} on time` : ''}.</span>`);

  const tips = [];
  if (sum.missed > sum.notes / 2) tips.push('Most notes were not heard. Check the input level bar moves when you sing, and sing at a normal speaking volume or louder.');
  else if (sum.missed) tips.push(`${sum.missed} note${sum.missed > 1 ? 's were' : ' was'} not heard (red outline): usually too quiet, or a breath in the wrong place.`);
  if (sum.avgCents != null && Math.abs(sum.avgCents) >= 20 && (sum.avgCents < 0 ? sum.flat : sum.sharp) > sum.notes / 5) {
    tips.push(sum.avgCents < 0
      ? `You tend to sing flat (low), by ${-sum.avgCents} cents on average. Listen first, then aim each note a hair higher than feels natural.`
      : `You tend to sing sharp (high), by ${sum.avgCents} cents on average. Relax and let each note settle a hair lower.`);
  }
  if (sum.avgOnsetMs != null && sum.timed >= 3 && Math.abs(sum.avgOnsetMs) >= 70) {
    tips.push(sum.avgOnsetMs > 0
      ? `You tend to come in late, by ${(sum.avgOnsetMs / 1000).toFixed(2)} s (${beatWords(sum.avgOnsetMs, spb)}). Breathe in on the beat before each phrase, so you're ready to sing on the beat.`
      : `You tend to come in early, by ${(-sum.avgOnsetMs / 1000).toFixed(2)} s (${beatWords(sum.avgOnsetMs, spb)}). Wait for the click, and try a slower speed.`);
  }
  if (sum.octave) tips.push(`${sum.octave} note${sum.octave > 1 ? 's were' : ' was'} sung an octave away from the written note. That's fine; "Fit to my range" moves the song nearer your voice.`);
  if (!tips.length && sum.inTune === sum.notes) tips.push('Every note on pitch. Try it faster, or try the next song.');

  // The rough spots, in song order, so they can be practiced.
  const bad = notes.map((n, i) => ({ n, s: scores[i] })).filter(({ s }) => s.missed || s.pitch !== 'ok' || (s.timing && s.timing !== 'ok'));
  const barOf = (n) => barNumber(song, song.notes[n.i].beat);
  const spots = bad.slice(0, 8).map(({ n, s }) => `<li>Bar ${barOf(n)}, ${midiToName(n.midi)}${n.lyric ? ` "${escapeHtml(n.lyric)}"` : ''}: ${shortVerdict(s)}</li>`);

  $('song-summary').innerHTML = `<p>${rows.join('<br>')}</p>${tips.map((t) => `<p>${t}</p>`).join('')}
    ${spots.length ? `<p class="hint">Spots to work on${bad.length > spots.length ? ` (first ${spots.length} of ${bad.length})` : ''}. Tap a note in the picture for details.</p><ul>${spots.join('')}</ul>` : ''}`;
  $('song-result').hidden = false;
  $('song-status').textContent = 'Done. Scroll the picture to see every note; tap a note for details.';

  review.take = {
    schema: 'song-take/v1',
    date: new Date().toISOString(),
    title: song.title, part: song.parts.length > 1 ? song.partName : null, verse: song.verses > 1 ? song.verse + 1 : null,
    playing: { others: 'the other parts', all: 'all parts', mine: 'only my part', none: 'nothing but the click' }[prefs.play],
    bpm: song.bpm, speed, shift,
    summary: sum,
    notes: notes.map((n, i) => {
      const { runStart, ...score } = scores[i];
      return { name: midiToName(n.midi), hz: Number(hz(n.midi)), lyric: n.lyric, bar: barOf(n), beat: song.notes[i].beat, ...score };
    }),
  };
}

// ---------- the picture ----------

// Live: a window that scrolls with the music. Otherwise: the whole song, scrollable sideways.
export function drawSong() {
  if (run) drawLane(true);
}

function renderLane() {
  if (song) drawLane(false);
}

function drawLane(live) {
  const c = $('song-lane');
  const wrap = c.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const sg = run ? run.song : song;
  const spb = run ? run.spb : 60 / (song.bpm * speed);
  const pps = PX_PER_BEAT / spb;
  const notes = run ? run.notes : review ? review.notes : timeline(song, speed, shift);
  const others = run ? run.others : song.parts.map((_, i) => i).filter((i) => i !== song.part)
    .map((i) => timeline(practiceView(song, i, song.verse), speed, shift));
  const frames = run ? run.frames : review ? review.frames : [];
  const scores = run ? run.scores : review ? review.scores : [];
  const end = notes.at(-1).end;
  const viewW = wrap.clientWidth;
  const w = live ? viewW : Math.max(viewW, Math.ceil((end + 1.5) * pps));
  const h = c.clientHeight || 240;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.style.width = `${w}px`;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();

  let now = null;
  let tLeft = -0.5;
  if (run) {
    now = run.ctx.currentTime - run.outLat - run.t0;
    tLeft = now - (NOW_AT * w) / pps;
  }
  const X = (t) => (t - tLeft) * pps;
  const tRight = tLeft + w / pps;

  // Pitch rows: the song's range plus some room, at least 14 semitones.
  const r = songRange(notes);
  let lo = r.low - 3, hi = r.high + 3;
  if (hi - lo < 14) { const pad = (14 - (hi - lo)) / 2; lo -= Math.floor(pad); hi += Math.ceil(pad); }
  const top = 6, bottom = h - 20; // room under the lowest row for words
  const row = (bottom - top) / (hi - lo + 1);
  const Y = (m) => bottom - (m - lo + 0.5) * row; // center of row m

  g.font = '11px system-ui, sans-serif';
  for (let m = lo; m <= hi; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    g.fillStyle = color('--line');
    g.globalAlpha = isBlackKey(m) ? 0.35 : 0.12;
    g.fillRect(0, Y(m) - row / 2, w, row);
    if (isC) {
      g.globalAlpha = 1;
      g.fillStyle = color('--muted');
      g.fillText(midiToName(m), (live ? 0 : wrap.scrollLeft) + 4, Y(m) + 4);
    }
  }
  g.globalAlpha = 1;

  // Beat and bar lines.
  const pulse = spb * sg.pulse;
  const bars = new Set(barStarts(sg, end / spb + 1).map((b) => Math.round(b * 1000)));
  const phase = pickupBeats(sg) * spb % pulse; // beat lines line up with the bars after a pickup
  for (let k = Math.ceil((tLeft - phase) / pulse); phase + k * pulse <= tRight; k++) {
    const t = phase + k * pulse;
    const isBar = bars.has(Math.round((t / spb) * 1000));
    g.strokeStyle = color('--line');
    g.lineWidth = isBar ? 2 : 1;
    g.globalAlpha = isBar ? 1 : 0.6;
    g.beginPath();
    g.moveTo(X(t), top);
    g.lineTo(X(t), bottom);
    g.stroke();
  }
  g.globalAlpha = 1;
  g.lineWidth = 1;

  // The other parts, faint, so you can see what moves around yours.
  const rh = Math.max(6, row * 0.8);
  g.fillStyle = color('--muted');
  g.globalAlpha = 0.18;
  for (const o of others) {
    for (const n of o) {
      if (n.end < tLeft || n.start > tRight || n.midi < lo || n.midi > hi) continue;
      roundRect(g, X(n.start), Y(n.midi) - rh / 4, Math.max(3, (n.end - n.start) * pps - 3), rh / 2, 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;

  // The notes to sing, colored once sung: green on pitch, amber off pitch, red outline missed.
  for (const n of notes) {
    if (n.end < tLeft || n.start > tRight) continue;
    const s = scores[n.i];
    const x = X(n.start), nw = Math.max(4, (n.end - n.start) * pps - 3), y = Y(n.midi) - rh / 2;
    const active = now != null && now >= n.start && now < n.end;
    g.globalAlpha = 1;
    if (s && s.missed) {
      g.strokeStyle = color('--home');
      g.setLineDash([4, 3]);
      g.lineWidth = 2;
      g.strokeRect(x, y, nw, rh);
      g.setLineDash([]);
      g.lineWidth = 1;
    } else {
      g.fillStyle = s ? color(s.pitch === 'ok' ? '--comfy' : '--reach') : active ? color('--accent') : color('--muted');
      g.globalAlpha = s ? 0.55 : active ? 0.9 : 0.45;
      roundRect(g, x, y, nw, rh, 3);
      g.fill();
      g.globalAlpha = 1;
    }
    if (n.lyric) {
      g.fillStyle = color('--text');
      g.font = `${active ? 'bold ' : ''}12px system-ui, sans-serif`;
      g.fillText(n.lyric, x, Math.min(h - 4, y + rh + 13));
    }
    if (!s) continue;
    // Timing: a bracket from the beat to where the voice actually arrived.
    if (s.onsetMs != null) {
      const xo = X(n.start + s.onsetMs / 1000);
      g.strokeStyle = s.timing === 'ok' ? color('--muted') : color('--warn');
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, y - 4);
      g.lineTo(xo, y - 4);
      g.moveTo(xo, y - 9);
      g.lineTo(xo, y + rh);
      g.stroke();
      g.lineWidth = 1;
    }
    const tags = [];
    if (s.missed) tags.push('missed');
    else {
      if (s.pitch !== 'ok') tags.push(s.pitch);
      if (s.timing === 'early' || s.timing === 'late') tags.push(s.timing);
    }
    g.font = '11px system-ui, sans-serif';
    g.fillStyle = tags.length ? color('--warn') : color('--comfy');
    g.fillText(tags.length ? tags.join(', ') : '✓', x, y - 12);
  }

  // The voice. Points an octave outside the view are moved into it and drawn faint.
  g.lineWidth = 3;
  g.lineJoin = g.lineCap = 'round';
  let ni = 0, prev = null;
  for (const f of frames) {
    if (f.t < tLeft - 0.1 || f.midi == null) { prev = null; continue; }
    if (f.t > tRight) break;
    let m = f.midi, faint = false;
    while (m < lo - 0.5) { m += 12; faint = true; }
    while (m > hi + 0.5) { m -= 12; faint = true; }
    while (ni < notes.length - 1 && notes[ni].end <= f.t) ni++;
    const n = notes[ni] && notes[ni].start <= f.t && f.t < notes[ni].end ? notes[ni] : null;
    let col = color('--muted');
    if (n) {
      const d = f.midi - n.midi;
      col = Math.abs(d - 12 * Math.round(d / 12)) <= PITCH_OK ? color('--comfy') : color('--reach');
    }
    const p = { x: X(f.t), y: Y(m), t: f.t };
    if (prev && p.t - prev.t < 0.2 && Math.abs(p.y - prev.y) < row * 2.5) {
      g.strokeStyle = col;
      g.globalAlpha = faint ? 0.4 : 1;
      g.beginPath();
      g.moveTo(prev.x, prev.y);
      g.lineTo(p.x, p.y);
      g.stroke();
    }
    prev = p;
  }
  g.globalAlpha = 1;
  g.lineWidth = 1;

  if (now != null) {
    g.strokeStyle = color('--accent');
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(X(now), 0);
    g.lineTo(X(now), h);
    g.stroke();
    g.lineWidth = 1;
    if (now < 0) {
      const left = Math.ceil(-now / run.pulse);
      g.fillStyle = color('--accent');
      g.font = 'bold 40px system-ui, sans-serif';
      g.fillText(String(left), X(now) + 12, h / 2);
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Tap a note in the finished take for the details.
function pickNote(e) {
  if (run || !song) return;
  const c = $('song-lane');
  const rect = c.getBoundingClientRect();
  const spb = 60 / (song.bpm * speed);
  const t = -0.5 + ((e.clientX - rect.left) / PX_PER_BEAT) * spb;
  const notes = review ? review.notes : timeline(song, speed, shift);
  const n = notes.find((x) => t >= x.start - 0.05 && t < x.end + 0.05);
  if (!n) return;
  $('song-note').innerHTML = describe(n, review?.scores[n.i], spb);
}

// ---------- the library: collections, search, sets, files ----------

let collections = [];
const SET = 'voiceRange.set'; // the set being put together: { name, note, items: [{ c, id, note }] }
let set = JSON.parse(localStorage.getItem(SET) || 'null') || { name: 'Choir set', note: '', items: [] };
const parsed = new Map(); // song text -> parsed song, for the range marks
const libStatus = (t) => ($('lib-status').textContent = t || '');

// The AI's verse fitter through the local bridge, or null when it isn't running.
async function aiFit() {
  const s = await aiStatus();
  if (!s?.ok || !s.tasks?.includes('fit-verse')) return null;
  return async (template, words) => lib.parseAnswer((await aiAsk('fit-verse', { template, words })).text);
}

const unfittedText = (s) => `Verse${s.unfitted.length > 1 ? 's' : ''} ${s.unfitted.map((u) => u.number).join(', ')} couldn't be fitted to the notes (${s.unfitted[0].why}); ${s.unfitted.length > 1 ? 'they are' : 'it is'} in the words only.`;

function openLibSong(c, s) {
  libRef = { c: c.id, id: s.id, title: s.title, note: [c.kind === 'set' && c.note, s.note].filter(Boolean).join(' ') };
  const ref = libRef;
  fillSongList();
  $('song-select').value = 'lib';
  useSong(parseSong(s.text));
  libRef = ref; // useSong keeps it; pick() is what clears it
  showInfo();
  if (s.unfitted) $('song-status').textContent = unfittedText(s);
  $('song').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function refreshLibrary() {
  collections = await lib.loadAll();
  const sel = $('lib-coll'), was = sel.value;
  sel.replaceChildren(new Option('All collections', ''), ...collections.map((c) => new Option(`${c.name} (${c.songs.length})`, c.id)));
  sel.value = collections.some((c) => c.id === was) ? was : '';
  $('lib-delete').hidden = !sel.value;
  $('lib-empty').hidden = collections.length > 0;
  const tsel = $('lib-topic'), twas = tsel.value, all = lib.topics(collections);
  tsel.replaceChildren(new Option('All topics', ''), ...all.map((t) => new Option(t, t)));
  tsel.value = all.includes(twas) ? twas : '';
  tsel.hidden = !all.length;
  const fsel = $('lib-facet'), fwas = fsel.value, groups = lib.facetList(collections);
  fsel.replaceChildren(new Option('All voicings, levels...', ''), ...groups.map(({ label, key, values }) => {
    const g = document.createElement('optgroup');
    g.label = label;
    g.append(...values.map((v) => new Option(v, `${key}|${v}`)));
    return g;
  }));
  fsel.value = [...fsel.options].some((o) => o.value === fwas) ? fwas : '';
  fsel.hidden = !groups.length;
  showResults();
  showSet();
}

// How much of the singer's part fits their range: { share 0-1, html mark }, or null with no
// range. Their own part (Bass, say) is checked as written. A song without it is sung on the
// melody, which may be an octave up or down (men sing a melody an octave below a woman), so the
// octave that fits best is used and named. Kept per range and part, since sorting by fit
// checks every song.
let fitCache = { key: '', map: new Map() };
function fitOf(text) {
  const r = myRange();
  if (!r) return null;
  const key = `${r.low}-${r.high}-${prefs.partName}-${prefs.fitFor}`;
  if (fitCache.key !== key) fitCache = { key, map: new Map() };
  if (fitCache.map.has(text)) return fitCache.map.get(text);
  let s = parsed.get(text);
  if (!s) { try { s = parseSong(text); } catch { return null; } parsed.set(text, s); }
  // Your part as written; or the melody (the first part) in the octave you'd sing it, when
  // fitting for the melody or when the song doesn't have your part.
  const named = prefs.fitFor === 'melody' ? -1 : s.parts.findIndex((x) => x.name === prefs.partName);
  const i = named >= 0 ? named : Math.max(0, s.parts.findIndex((x) => !isAccompaniment(x.name)));
  const notes = practiceView(s, i, 0).notes;
  const by = named >= 0 ? 0 : fitShift(notes, r.low, r.high, true); // the octave a singer would choose
  const share = insideShare(notes, r.low, r.high, by);
  const octave = by ? `, octave ${by < 0 ? 'down' : 'up'}` : '';
  const how = by ? `sung an octave ${by < 0 ? 'lower' : 'higher'}` : 'as written';
  let out;
  if (prefs.fitFor === 'melody') {
    // Singing on your own: how many steps from the hymnbook key (in the octave you'd sing it)
    // the tune has to move to sit inside your comfortable range. At 0 you can sing it with
    // the congregation.
    const steps = stepsToFit(notes.map((n) => n.midi + by), r.low, r.high);
    const what = steps.n === 0 ? 'in the hymnbook key' : `${Math.abs(steps.n)} step${Math.abs(steps.n) > 1 ? 's' : ''} ${steps.n < 0 ? 'down' : 'up'}`;
    const cls = steps.n === 0 && steps.fits ? 'good' : Math.abs(steps.n) <= 4 && steps.fits ? 'ok' : 'poor';
    const tip = `The ${s.parts[i].name.toLowerCase()} ${how}${steps.fits ? ` fits your comfortable range ${steps.n === 0 ? 'as written' : `moved ${what} from the hymnbook key`}` : ` is wider than your comfortable range; moved ${what} it fits best`}. At 0 steps you can sing it with the congregation.`;
    // Men sing a melody written for women's voices (Soprano, Melody, Part 1) an octave lower,
    // and one written for men's (Tenor 1) as written; name the octave only when it differs.
    const usual = /^tenor|^baritone|^bass/i.test(s.parts[i].name) ? 0 : -12;
    const off = by - usual;
    const where = off ? `, an octave ${off < 0 ? 'below' : 'above'} where men usually sing it` : '';
    out = { share, steps: Math.abs(steps.n) + (steps.fits ? 0 : 100), html: `<span class="fit ${cls}" title="${escapeHtml(tip)}">Melody${where}: ${what}${steps.fits ? '' : ' (still too wide)'}</span>` };
  } else {
    const label = s.parts.length > 1 || octave ? `${escapeHtml(s.parts[i].name)}${octave} ` : '';
    out = { share, html: `<span class="fit ${share >= 0.9 ? 'good' : share >= 0.7 ? 'ok' : 'poor'}" title="Share of the ${escapeHtml(s.parts[i].name)} part's notes inside your comfortable range, ${how}">${label}${Math.round(share * 100)}%</span>` };
  }
  fitCache.map.set(text, out);
  return out;
}

// Steps to move notes (MIDI numbers) so they all sit inside low..high: { n: negative down,
// positive up, 0 already inside; fits: false when the tune is wider than the range (then n puts
// it as near as it goes, its top at the range's top) }.
function stepsToFit(midis, low, high) {
  const lo = Math.min(...midis), hi = Math.max(...midis);
  if (hi - lo > high - low) return { n: high - hi, fits: false };
  if (hi > high) return { n: high - hi, fits: true };
  if (lo < low) return { n: low - lo, fits: true };
  return { n: 0, fits: true };
}

// The results: what the search finds, or with nothing typed and a range set, the best fits for
// the singer first (filters still apply; ties stay in book order).
function showResults() {
  const coll = collections.find((c) => c.id === $('lib-coll').value);
  $('lib-coll-note').textContent = coll?.note ? `Note: ${coll.note}` : '';
  const query = $('lib-search').value.trim();
  const r = myRange();
  const byFit = !query && !!r;
  const top = Number($('lib-pop').value) || 0; // most sung: top 10, 25, 50
  let found = lib.search(collections, query, { only: $('lib-coll').value, topic: $('lib-topic').value, facet: $('lib-facet').value, limit: Infinity })
    .map((f) => ({ ...f, rank: popularity(f.collection.id, f.song) }));
  if (top) found = found.filter((f) => f.rank && f.rank <= top);
  const matched = found.length;
  if (byFit) {
    // Best fits first: your part's share in range, or for the melody the fewest steps from the
    // hymnbook key. Ties keep the order before (most sung first under a popularity filter).
    if (top) found.sort((a, b) => a.rank - b.rank);
    const melody = prefs.fitFor === 'melody';
    found = found.map((f) => ({ ...f, fit: fitOf(f.song.text) }))
      .sort((a, b) => (melody ? (a.fit?.steps ?? 999) - (b.fit?.steps ?? 999) : (b.fit?.share ?? -1) - (a.fit?.share ?? -1)));
  } else if (top && !query) {
    found.sort((a, b) => a.rank - b.rank);
  }
  found = found.slice(0, 60);
  $('lib-results').replaceChildren(...found.map(({ collection: c, song: s, rank }) => {
    const li = document.createElement('li');
    li.innerHTML = `<button class="lib-pick">${s.number ? `<b>${escapeHtml(s.number)}</b> ` : ''}${escapeHtml(s.title)}</button>
      <small>${escapeHtml(s.from || c.name)}${s.section ? `, ${escapeHtml(s.section)}` : ''}${rank ? `, <b>#${rank} most sung</b>` : ''}${s.note ? ` | ${escapeHtml(s.note)}` : ''}</small> ${fitOf(s.text)?.html || ''}
      <button class="lib-add" title="Add to the set">+ Set</button>`;
    li.querySelector('.lib-pick').onclick = () => openLibSong(c, s);
    li.querySelector('.lib-add').onclick = () => {
      if (!set.items.some((x) => x.c === c.id && x.id === s.id)) set.items.push({ c: c.id, id: s.id, note: '' });
      saveSet();
    };
    return li;
  }));
  const total = collections.reduce((a, c) => a + c.songs.length, 0);
  const shown = matched > 60 ? `the first 60 of ${matched} matching` : `${matched} of ${total}`;
  const order = byFit ? (prefs.fitFor === 'melody' ? ' Closest to the hymnbook key first.' : ' Best fits for you first.') : top && !query ? ' Most sung first.' : '';
  const marks = !r || !found.length ? ''
    : prefs.fitFor === 'melody'
      ? ` The mark is how many steps the melody (in the octave you'd sing it) must move from the hymnbook key to fit your comfortable range (${named(r.low)} to ${named(r.high)}); at 0 you can sing it with the congregation. To practice in your key, untick "Keep the written key" on the song and press "Fit to my range".`
      : ` The % mark is how many of your part's notes${prefs.partName ? ` (${prefs.partName})` : ''} are inside your comfortable range (${named(r.low)} to ${named(r.high)}), as written; songs without your part are measured on the melody.`;
  const source = top ? ` Most sung: ${POPULARITY_SOURCE.name}.` : '';
  $('lib-count').textContent = total ? `Showing ${shown} songs.${order}${marks}${source}` : '';
}

const saveSet = () => { localStorage.setItem(SET, JSON.stringify(set)); showSet(); };

function showSet() {
  $('set-box').hidden = !set.items.length;
  $('set-name').value = set.name;
  $('set-note').value = set.note;
  $('set-list').replaceChildren(...set.items.map((item, i) => {
    const c = collections.find((x) => x.id === item.c);
    const s = c?.songs.find((x) => x.id === item.id);
    const li = document.createElement('li');
    li.innerHTML = `${s ? `${s.number ? `${escapeHtml(s.number)} ` : ''}${escapeHtml(s.title)} <small>${escapeHtml(c.name)}</small>` : '<i>missing from the library</i>'}
      <input class="set-song-note" placeholder="Note for this song (part, verses...)" value="${escapeHtml(item.note || '')}">
      <button class="set-up" title="Move up">Up</button> <button class="set-remove" title="Remove">Remove</button>`;
    li.querySelector('.set-song-note').onchange = (e) => { item.note = e.target.value; saveSet(); };
    li.querySelector('.set-up').onclick = () => { if (i) { set.items.splice(i - 1, 0, ...set.items.splice(i, 1)); saveSet(); } };
    li.querySelector('.set-remove').onclick = () => { set.items.splice(i, 1); saveSet(); };
    return li;
  }));
}

function download(name, json) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// A library, set, or collected-songs file's contents, into the library.
async function openContents(json) {
  const got = lib.readFile(json);
  if (got.collected) return addCollected(got.collected);
  const merged = lib.merge(await lib.loadAll(), got.collections);
  for (const c of merged.filter((m) => got.collections.some((g) => g.id === m.id))) await lib.saveCollection(c);
  await refreshLibrary();
  const first = got.collections[0];
  if (got.collections.length === 1) { $('lib-coll').value = first.id; $('lib-delete').hidden = false; showResults(); }
  libStatus(`Opened ${got.collections.map((c) => `"${c.name}" (${c.songs.length} songs)`).join(', ')}.`);
}

// Collected hymns into songbook collections, one song at a time (verse fitting is slow), saving
// every 15 songs and at the end of each book, so a closed tab loses little (saving after every
// song would rewrite a whole book each time).
async function addCollected(collected) {
  const fit = await aiFit();
  const total = collected.books.reduce((a, b) => a + b.songs.length, 0);
  let done = 0, failed = 0, partly = 0, details = 0, added = 0;
  for (const book of collected.books) {
    let all = await lib.loadAll();
    let c = all.find((x) => x.id === book.slug) || { id: book.slug, name: book.title || BOOKS[book.slug] || book.slug, kind: 'songbook', songs: [] };
    let unsaved = 0;
    const changed = async () => { if (++unsaved >= 15) { await lib.saveCollection(c); unsaved = 0; } };
    for (const data of book.songs) {
      done++;
      libStatus(`Adding ${done} of ${total}: ${data.num ? `${data.num} ` : ''}${data.t}${fit ? '' : ' (AI not connected: extra verses kept as words only)'}`);
      const had = c.songs.find((x) => x.id === data.slug);
      if (data.meta) {
        // Details only (topics, voicing...) for a song you have, unchanged.
        const next = had && await lib.updateDetails(had, data);
        if (next) { details++; [c] = lib.merge([c], [{ ...c, songs: [next] }]); await changed(); }
        continue;
      }
      if (data.error || !data.m?.length) { failed++; continue; }
      try {
        const entry = await lib.buildSong(data, fit, (v) => libStatus(`Adding ${done} of ${total}: ${data.t}, fitting ${v}...`), had?.fits || {});
        added++;
        if (entry.unfitted) partly++;
        [c] = lib.merge([c], [{ ...c, songs: [entry] }]);
        await changed();
      } catch (e) {
        failed++;
        console.warn(`${data.t}: ${e.message}`);
      }
    }
    if (unsaved) await lib.saveCollection(c);
  }
  await refreshLibrary();
  libStatus(`Added ${added} songs${details ? `, updated the details of ${details}` : ''}.${partly ? ` ${partly} have a verse that couldn't be fitted to the notes (shown as words only).` : ''}${failed ? ` ${failed} couldn't be read (no sheet music).` : ''}`);
}

function initLibrary() {
  $('lib-search').oninput = showResults;
  $('lib-topic').onchange = showResults;
  $('lib-facet').onchange = showResults;
  $('lib-pop').onchange = showResults;
  $('lib-fit').value = prefs.fitFor;
  $('lib-fit').onchange = (e) => { prefs.fitFor = e.target.value; savePrefs(); showResults(); };
  $('lib-coll').onchange = () => { $('lib-delete').hidden = !$('lib-coll').value; showResults(); };
  $('lib-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { await openContents(JSON.parse(await f.text())); } catch (err) { libStatus(`Couldn't open that file: ${err.message}`); }
    e.target.value = '';
  };
  $('lib-open-url').onclick = async () => {
    const url = $('lib-url').value.trim();
    if (!url) return;
    libStatus('Opening...');
    try { await openContents(url.startsWith('/api/') ? await bridgeFile(url) : await lib.fetchFile(url)); } catch (err) { libStatus(err.message); }
  };
  $('lib-save').onclick = async () => download(`sing-library-${new Date().toISOString().slice(0, 10)}.json`, lib.libraryFile(await lib.loadAll()));
  $('lib-delete').onclick = async () => {
    const c = collections.find((x) => x.id === $('lib-coll').value);
    if (!c || $('lib-delete').dataset.armed !== c.id) {
      $('lib-delete').dataset.armed = c?.id || '';
      $('lib-delete').textContent = `Really remove "${c?.name}"?`;
      return;
    }
    await lib.deleteCollection(c.id);
    $('lib-delete').dataset.armed = '';
    $('lib-delete').textContent = 'Remove this collection';
    $('lib-coll').value = '';
    refreshLibrary();
  };
  $('set-name').onchange = (e) => { set.name = e.target.value.trim() || 'Choir set'; saveSet(); };
  $('set-note').onchange = (e) => { set.note = e.target.value; saveSet(); };
  $('set-clear').onclick = () => { set = { name: set.name, note: '', items: [] }; saveSet(); };
  $('set-save').onclick = () => {
    const items = set.items.map((x) => {
      const c = collections.find((y) => y.id === x.c);
      const s = c?.songs.find((y) => y.id === x.id);
      return s && { song: s, from: c, note: x.note };
    }).filter(Boolean);
    if (!items.length) return;
    download(`${set.name.replace(/[^\w -]+/g, '').trim() || 'choir-set'}.json`, lib.setFile(set.name, set.note, items));
  };
  refreshLibrary().then(upgradeLibrary).catch((e) => libStatus(`The library is unavailable in this browser: ${e.message}`));
}

// Songs built with older reading rules are rebuilt from the data they were collected with:
// newer part names, words, and layouts without collecting anything again.
async function upgradeLibrary() {
  const todo = lib.stale(collections);
  if (!todo.length) return;
  const byColl = new Map();
  for (let i = 0; i < todo.length; i++) {
    const { c, s } = todo[i];
    libStatus(`Updating songs to this version of the app: ${i + 1} of ${todo.length}...`);
    try {
      const col = byColl.get(c.id) || byColl.set(c.id, { ...c, songs: [...c.songs] }).get(c.id);
      col.songs[col.songs.findIndex((x) => x.id === s.id)] = await lib.rebuildSong(s);
    } catch (e) {
      console.warn(`${s.title}: ${e.message}`);
    }
  }
  for (const c of byColl.values()) await lib.saveCollection(c);
  await refreshLibrary();
  libStatus(`Updated ${todo.length} songs to this version of the app.`);
}

// ---------- setup ----------

export function initSong(hooks) {
  env = hooks;
  fillSongList();
  $('song-select').onchange = pick;
  $('song-load').onclick = loadTyped;
  $('song-file').onchange = (e) => e.target.files[0] && loadMidi(e.target.files[0]);
  $('song-voice').onchange = (e) => pickPart(Number(e.target.value));
  $('song-keep').onchange = (e) => {
    setKeepKey(e.target.checked);
    if (keepKey && (shift % 12 || Math.abs(shift) > 12)) moveKey(12 * Math.max(-1, Math.min(1, Math.round(shift / 12))) - shift, true);
    else changed();
  };
  $('song-verse').onchange = (e) => pickVerse(Number(e.target.value));
  $('song-lower').onclick = () => moveKey(-1);
  $('song-higher').onclick = () => moveKey(1);
  $('song-fit').onclick = () => {
    if (myRange()) moveKey(fitted() - shift, true);
  };
  $('song-speed').onchange = (e) => {
    speed = Number(e.target.value);
    review = null;
    $('song-result').hidden = true;
    showInfo();
    renderLane();
  };
  $('song-play').value = prefs.play;
  $('song-play').onchange = (e) => { prefs.play = e.target.value; savePrefs(); };
  $('song-click').checked = prefs.click;
  $('song-click').onchange = (e) => { prefs.click = e.target.checked; savePrefs(); };
  const nudge = (by) => { prefs.syncMs = Math.max(-500, Math.min(500, syncMs() + by)); savePrefs(); showSync(); };
  $('song-sync-down').onclick = () => nudge(-10);
  $('song-sync-up').onclick = () => nudge(10);
  $('song-calibrate').onclick = () => begin('calibrate');
  fillRangePickers();
  $('song-range-low').onchange = pickRange;
  $('song-range-high').onchange = pickRange;
  showSync();
  $('song-sing').onclick = () => begin('sing');
  $('song-listen').onclick = () => begin('listen');
  $('song-stop').onclick = () => {
    stopRun();
    $('song-status').textContent = 'Stopped.';
    renderLane();
  };
  $('song-done').onclick = () => closeSong();
  $('song-again').onclick = () => begin('sing');
  $('song-copy-ai').onclick = async (e) => {
    const btn = e.currentTarget;
    await env.copy(songPrompt(review.take));
    const was = btn.textContent;
    btn.textContent = 'Copied. Paste into any AI chat.';
    setTimeout(() => (btn.textContent = was), 2500);
  };
  $('song-lane').addEventListener('click', pickNote);
  initLibrary();
  // The bookmark points at whichever address served this page (the live site, or a local copy).
  const mark = bookmarklet(`${location.origin}${location.pathname}`);
  $('collect-bookmark').href = mark;
  $('hymn-bookmark').href = mark;
  $('hymn-copy').onclick = async (e) => {
    await env.copy(mark);
    const btn = e.currentTarget, was = btn.textContent;
    btn.textContent = 'Copied. Paste it as the bookmark address.';
    setTimeout(() => (btn.textContent = was), 3000);
  };
  $('song-lane').parentElement.addEventListener('scroll', () => !run && renderLane());
  window.addEventListener('resize', () => !run && renderLane());
}

// params: URLSearchParams from the address, to open a linked song.
export async function openSong(params = null) {
  $('song').hidden = false;
  showRangePickers(); // a range test may have finished since
  setButtons();
  if (params && (await restore(params))) return;
  if (!song) pick();
  else { showInfo(); renderLane(); }
}

export function closeSong() {
  stopRun();
  document.title = PAGE_TITLE;
  $('song').hidden = true;
  env.close();
}
