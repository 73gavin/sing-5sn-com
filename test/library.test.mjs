import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSong, parseAnswer, merge, search, setFile, readFile, fileUrl, topics, rebuildSong, updateDetails, stale, facetList } from '../public/js/library.js';
import { bookmarklet, verseTemplate, hymnToSong, READER } from '../public/js/hymn.js';
import { parseSong, practiceView, songToText, isAccompaniment } from '../public/js/song.js';

// Made-up song (no real hymn) in the collected shape: a verse of four notes with two verses
// under the music, then a six-note chorus with words only on the first line, and a third
// verse printed below the music.
const P = (step, octave) => [step, 0, octave];
const note = (step, octave, lyr = []) => [1, 4, [P(step, octave)], lyr, []];
const data = {
  t: 'Made-up Song', slug: 'made-up-song', num: '7', book: 'hymns', date: '2026-01-01',
  src: 'https://example.org/songs/made-up-song', cr: 'Text and music: Nobody',
  bpm: 90,
  m: [
    { time: [4, 4], k: [0, 'major'], s: [{ d: 4, n: [
      note('C', 4, [[1, 'Sing', 'single'], [2, 'Hum', 'single']]),
      note('D', 4, [[1, 'a', 'single'], [2, 'the', 'single']]),
      note('E', 4, [[1, 'hap', 'begin'], [2, 'tune', 'single']]),
      note('F', 4, [[1, 'py', 'end'], [2, '\u2014', 'single']]), // verse 2 holds "tune" here (a lone dash is no syllable)
    ] }] },
    { time: null, s: [{ d: 4, n: [
      note('G', 4, [[1, 'All', 'single']]), note('G', 4, [[1, 'to', 'begin']]), note('A', 4, [[1, 'geth', 'middle']]),
      note('A', 4, [[1, 'er', 'end']]),
    ] }] },
    { time: null, s: [{ d: 4, n: [note('G', 4, [[1, 'we', 'single']]), note('C', 5, [[1, 'sing', 'single']]), note('C', 5), note('C', 5)] }] },
  ],
  v: [['v', 1, 'Sing a happy'], ['v', 2, 'Hum the tune'], ['c', 0, 'All together we sing'], ['v', 3, 'Clap your hands now']],
};

test('chorus: every verse sings the refrain', () => {
  const s = hymnToSong(data);
  assert.deepEqual(s.extra, [{ number: 3, words: 'Clap your hands now' }]);
  assert.deepEqual(verseTemplate(s), ['Sing', 'a', 'hap-', 'py'], 'the template leaves the chorus out');
  const chorusNote = s.parts[0].notes[4];
  assert.equal(chorusNote.chorus, true);
  assert.deepEqual(chorusNote.lyrics, ['All', 'All']);
});

test('buildSong fits a checked answer and keeps a bad one as words only', async () => {
  const good = await buildSong(data, async () => ['Clap', 'your', 'hands', 'now']);
  assert.equal(good.unfitted, undefined);
  const song = parseSong(good.text);
  assert.equal(song.verses, 3);
  assert.deepEqual(practiceView(song, 0, 2).notes.map((n) => n.lyric).slice(0, 6), ['Clap', 'your', 'hands', 'now', 'All', 'to-']);
  assert.equal(song.source, 'https://example.org/songs/made-up-song');
  assert.equal(song.credit, 'Text and music: Nobody');
  assert.equal(good.number, '7');
  assert.match(good.words, /Clap your hands now/);

  let calls = 0;
  const bad = await buildSong(data, async () => { calls++; return ['Clap', 'your', 'hands']; });
  assert.equal(calls, 2, 'one retry');
  assert.deepEqual(bad.unfitted.map((u) => [u.number, u.why]), [[3, '3 syllables for 4 notes']]);
  assert.equal(parseSong(bad.text).verses, 2);

  const changed = await buildSong(data, async () => ['Clap', 'my', 'hands', 'now']);
  assert.equal(changed.unfitted[0].why, 'the words changed');

  const offline = await buildSong(data, null);
  assert.equal(offline.unfitted[0].why, 'no AI connected');
});

test('parseAnswer finds the list in a chatty reply', () => {
  assert.deepEqual(parseAnswer('Here you go:\n["a", "b-", "c"]\nDone.'), ['a', 'b-', 'c']);
  assert.throws(() => parseAnswer('sorry'), /no list/);
});

const lib = [
  { id: 'hymns', name: 'Hymns (1985)', kind: 'songbook', songs: [
    { id: 'i-need-thee', number: '98', title: 'I Need Thee Every Hour', words: 'I need thee every hour, most gracious Lord', text: '' },
    { id: 'nearer', number: '100', title: 'Nearer, My God, to Thee', words: 'Nearer, my God, to thee, nearer to thee', text: '' },
  ] },
  { id: 'childrens-songbook', name: "Children's Songbook", kind: 'songbook', songs: [
    { id: 'child', number: '2', title: 'I Am a Child of God', words: 'I am a child of God, and he has sent me here', text: '' },
  ] },
];

test('search: number, title, words, and collection name', () => {
  assert.equal(search(lib, '98')[0].song.title, 'I Need Thee Every Hour');
  assert.equal(search(lib, 'nearer')[0].song.id, 'nearer');
  assert.deepEqual(search(lib, 'gracious').map((r) => r.song.id), ['i-need-thee']);
  assert.deepEqual(search(lib, 'children').map((r) => r.song.id), ['child'], 'by collection name');
  assert.deepEqual(search(lib, 'god', { only: 'hymns' }).map((r) => r.song.id), ['nearer'], 'one collection only');
  assert.equal(search(lib, '').length, 3);
});

test('merge adds and replaces by id; set files read back', () => {
  const more = [{ id: 'hymns', name: 'Hymns (1985)', songs: [{ id: 'nearer', number: '100', title: 'Nearer (new)' }, { id: 'abide', number: '166', title: 'Abide with Me' }] }];
  const m = merge(lib, more);
  const hymns = m.find((c) => c.id === 'hymns');
  assert.deepEqual(hymns.songs.map((s) => s.title), ['I Need Thee Every Hour', 'Nearer (new)', 'Abide with Me']);
  assert.equal(m.length, 2);

  const file = setFile('Sunday Oct 26', 'Basses: verses 1 and 3', [{ song: lib[0].songs[0], from: lib[0], note: 'slow' }]);
  const { collections } = readFile(JSON.parse(JSON.stringify(file)));
  assert.equal(collections[0].kind, 'set');
  assert.equal(collections[0].id, 'set-sunday-oct-26');
  assert.equal(collections[0].songs[0].from, 'Hymns (1985)');
  assert.equal(collections[0].songs[0].note, 'slow');
  assert.throws(() => readFile({ hello: 1 }), /not a Sing/);
});

test('web addresses: Dropbox and GitHub to the file, Google Drive explained', () => {
  assert.equal(fileUrl('https://www.dropbox.com/s/abc/set.json?dl=0'), 'https://www.dropbox.com/s/abc/set.json?dl=1');
  assert.equal(fileUrl('https://github.com/me/songs/blob/main/set.json'), 'https://raw.githubusercontent.com/me/songs/main/set.json');
  assert.throws(() => fileUrl('https://drive.google.com/file/d/xyz/view'), /Google Drive/);
});

test('the Sing bookmark is a javascript: link that parses', () => {
  for (const b of [bookmarklet('https://sing.5sn.com/')]) {
    assert.ok(b.startsWith('javascript:'));
    const code = decodeURIComponent(b.slice('javascript:'.length));
    assert.ok(code.includes('"https://sing.5sn.com/"'));
    assert.ok(!/\bAPP\b|BOOKLIST/.test(code));
    assert.doesNotThrow(() => new Function(code));
  }
});

// Like "Jesus Is the Way": women and tenors sing one line while the basses sing other words
// (printed under the bass staff, as the staff's second line), and a verse below the music.
const counter = {
  t: 'Made-up Answer', slug: 'made-up-answer', num: '9', bpm: 80,
  m: [{ time: [4, 4], k: [0, 'major'], s: [
    { d: 1, n: [
      [1, 1, [P('E', 4), P('G', 4)], [[1, 'Come', 'single'], [2, 'Here', 'single']], []],
      [1, 1, [P('F', 4), P('A', 4)], [[1, 'to', 'single'], [2, 'we', 'single']], []],
      [1, 2, [P('E', 4), P('G', 4)], [[1, 'Him', 'single'], [2, 'stand', 'single']], []],
    ] },
    { d: 1, n: [
      [11, 1, [P('C', 4)], [], []], [11, 1, [P('C', 4)], [], []], [11, 2, [P('C', 4)], [], []],
      [12, 1, [P('C', 3)], [[2, 'Oh,', 'single']], []],
      [12, 1, [P('D', 3)], [], []], // holds "Oh,"
      [12, 2, [P('E', 3)], [[2, 'come!', 'single']], []],
    ] },
  ] }],
  v: [['v', 1, 'Come to Him'], ['v', 2, 'Here we stand'], ['v', 3, 'Sing with joy']],
};

test('a part with words of its own keeps them; the others sing the melody', async () => {
  const s = hymnToSong(counter);
  const words = (name, v) => s.parts.find((p) => p.name === name).notes.map((n) => n.lyrics[v] || '_');
  assert.deepEqual(words('Tenor', 1), ['Here', 'we', 'stand'], 'tenor sings the melody words');
  assert.deepEqual(words('Bass', 0), ['Oh,', '_', 'come!'], 'bass keeps its own words, holding between');
  assert.deepEqual(words('Bass', 1), ['Oh,', '_', 'come!'], 'the same in every verse');

  const entry = await buildSong(counter, async () => ['Sing', 'with', 'joy']);
  const song = parseSong(entry.text);
  assert.equal(song.verses, 3);
  const v3 = (i) => practiceView(song, i, 2).notes.map((n) => n.lyric || '_');
  assert.deepEqual(v3(2), ['Sing', 'with', 'joy'], 'tenor gets the fitted verse');
  assert.deepEqual(v3(3), ['Oh,', '_', 'come!'], 'bass keeps its own words in the fitted verse');
});

// Like the Children's Songbook: a descant staff with its own words (sung on verse 4), the
// melody staff with piano chords under the melody, and the piano's left hand.
const songbook = {
  t: 'Made-up Child Song', slug: 'made-up-child', num: '3', book: 'childrens-songbook', bpm: 90,
  m: [{ time: [4, 4], k: [0, 'major'], s: [
    { d: 1, c: 'G', n: [[1, 2, [P('G', 4)], [[4, 'High', 'single']], []], [1, 2, [P('C', 5)], [[4, 'part', 'single']], []]] },
    { d: 1, c: 'G', n: [
      [11, 1, [P('C', 4), P('E', 4)], [[1, 'I', 'single'], [2, 'You', 'single']], []],
      [11, 1, [P('D', 4), P('F', 4)], [[1, 'am', 'single'], [2, 'are', 'single']], []],
      [11, 2, [P('E', 4), P('G', 4)], [[1, 'here', 'single'], [2, 'there', 'single']], []],
    ] },
    { d: 1, c: 'F', n: [[13, 2, [P('C', 3), P('G', 3)], [], []], [13, 2, [P('G', 2), P('D', 3)], [], []]] },
  ] }],
  v: [['v', 1, 'I am here'], ['v', 2, 'You are there']],
};

test('melody with accompaniment: melody, descant, and piano parts', () => {
  const s = hymnToSong(songbook);
  assert.deepEqual(s.parts.map((p) => p.name), ['Melody', 'Piano (right hand)', 'Descant', 'Piano (left hand)']);
  const by = (name) => s.parts.find((p) => p.name === name).notes;
  assert.deepEqual(by('Melody').map((n) => n.midi), [64, 65, 67], 'top of each chord');
  assert.deepEqual(by('Piano (right hand)').map((n) => n.midi), [60, 62, 64], 'the notes under the melody');
  assert.deepEqual(by('Piano (left hand)').map((n) => n.midi), [48, 43], 'the bass line');
  assert.deepEqual(by('Melody').map((n) => n.lyrics[1]), ['You', 'are', 'there']);
  assert.deepEqual(by('Descant').map((n) => n.lyrics[0]), ['High', 'part'], 'its own words');

  const song = parseSong(songToText(s));
  const piano = song.parts.find((p) => p.name === 'Piano (left hand)');
  assert.ok(piano.notes.every((n) => n.lyrics.every((w) => !w)), 'piano parts get no words');
  assert.ok(isAccompaniment('Piano (left hand)') && !isAccompaniment('Descant'));
});

test('a hymn with two staves is a choir hymn; from the Children\'s Songbook it is a melody', () => {
  const choir = hymnToSong({ ...songbook, book: 'hymns', m: [{ ...songbook.m[0], s: songbook.m[0].s.slice(1) }] });
  assert.deepEqual(choir.parts.map((p) => p.name), ['Soprano', 'Alto', 'Tenor', 'Bass']);
  const kids = hymnToSong({ ...songbook, m: [{ ...songbook.m[0], s: songbook.m[0].s.slice(1) }] });
  assert.equal(kids.parts[0].name, 'Melody');
  const byDescription = hymnToSong({ ...songbook, book: '', desc: '"X" from Children\'s Songbook (English).', m: [{ ...songbook.m[0], s: songbook.m[0].s.slice(1) }] });
  assert.equal(byDescription.parts[0].name, 'Melody', 'the Send to Sing bookmark knows the book from the description');
});

test('topics: kept from the song list, searchable and filterable', async () => {
  const e = await buildSong({ ...data, sec: 'Praise', tags: ['faith', 'joy'], au: ['Nobody'], co: ['Someone'] }, null);
  assert.equal(e.section, 'Praise');
  const c = [{ id: 'x', name: 'X', songs: [e, { ...e, id: 'other', title: 'Other', tags: ['joy'] }] }];
  assert.deepEqual(topics(c), ['joy', 'faith']);
  assert.deepEqual(search(c, '', { topic: 'faith' }).map((r) => r.song.id), ['made-up-song']);
  assert.deepEqual(search(c, 'someone').length, 2, 'by composer');
});

// One bar in two staves: treble with a two-note chord and words, bass with a two-note chord.
const twoStaves = (f, extra = {}) => ({
  t: 'Voiced', slug: 'voiced', num: '1', bpm: 80, f, ...extra,
  m: [{ time: [4, 4], k: [0, 'major'], s: [
    { d: 1, c: 'G', n: [[1, 4, [P('C', 4), P('E', 4)], [[1, 'Sing', 'single']], []]] },
    { d: 1, c: 'F', n: [[11, 4, [P('C', 3), P('G', 3)], [], []]] },
  ] }],
  v: [['v', 1, 'Sing']],
});
const parts = (data) => hymnToSong(data).parts.map((p) => `${p.name} ${p.notes.map((n) => n.midi).join(',')}`);

test('voicing decides the parts', () => {
  assert.deepEqual(parts(twoStaves({ voicing: ['SATB'] })), ['Soprano 64', 'Alto 60', 'Tenor 55', 'Bass 48']);
  assert.deepEqual(parts(twoStaves({ voicing: ['TTBB'] })), ['Tenor 1 52', 'Tenor 2 48', 'Baritone 55', 'Bass 48'], 'tenors sound an octave below the treble clef');
  assert.deepEqual(parts(twoStaves({ voicing: ['TTB'] })), ['Tenor 1 52', 'Tenor 2 48', 'Bass 55']);
  assert.deepEqual(parts(twoStaves({ voicing: ['SA'] })), ['Soprano 64', 'Alto 60', 'Piano (left hand) 48']);
  assert.deepEqual(parts(twoStaves({ voicing: ['Two-Part'] })), ['Part 1 64', 'Part 2 60', 'Piano (left hand) 48']);
  assert.deepEqual(parts(twoStaves({ voicing: ['Unison'] })), ['Melody 64', 'Piano (right hand) 60', 'Piano (left hand) 48']);
  assert.deepEqual(parts(twoStaves({})), ['Soprano 64', 'Alto 60', 'Tenor 55', 'Bass 48'], 'no voicing: treble over bass is SATB');
  assert.deepEqual(parts(twoStaves({}, { book: 'childrens-songbook' }))[0], 'Melody 64');
});

test('stored songs rebuild without collecting again, keeping fitted verses', async () => {
  let asked = 0;
  const entry = await buildSong(data, async () => { asked++; return ['Clap', 'your', 'hands', 'now']; });
  assert.equal(asked, 1);
  assert.equal(entry.built, READER);
  assert.deepEqual(entry.fits, { 3: ['Clap', 'your', 'hands', 'now'] });
  assert.equal(stale([{ id: 'x', songs: [entry] }]).length, 0);
  const old = { ...entry, built: 1, text: 'title: old\nnotes: C4', note: 'slow' };
  assert.equal(stale([{ id: 'x', songs: [old] }]).length, 1);
  const again = await rebuildSong(old);
  assert.equal(asked, 1, 'the AI is not asked again');
  assert.equal(again.text, entry.text);
  assert.equal(again.note, 'slow', 'library additions kept');
  assert.equal(parseSong(again.text).verses, 3);
});

test('details-only refresh: topics update; a new voicing rebuilds the parts', async () => {
  const entry = await buildSong(twoStaves({ voicing: ['SATB'] }), null);
  assert.equal(await updateDetails(entry, { slug: 'voiced', num: '1', f: { voicing: ['SATB'] } }), null, 'nothing changed');
  const tagged = await updateDetails(entry, { slug: 'voiced', num: '1', tags: ['joy'], f: { voicing: ['SATB'] } });
  assert.deepEqual(tagged.tags, ['joy']);
  assert.equal(tagged.text, entry.text);
  const men = await updateDetails(entry, { slug: 'voiced', num: '1', f: { voicing: ['TTBB'] } });
  assert.deepEqual(parseSong(men.text).parts.map((p) => p.name), ['Tenor 1', 'Tenor 2', 'Baritone', 'Bass']);
  assert.deepEqual(facetList([{ id: 'x', songs: [men, { ...entry, facets: { voicing: ['SATB'], difficulty: ['EASY'] } }] }]),
    [{ key: 'voicing', label: 'Voicing', values: ['SATB', 'TTBB'] }, { key: 'difficulty', label: 'Difficulty', values: ['EASY'] }]);
  assert.deepEqual(search([{ id: 'x', name: 'X', songs: [men, entry] }], '', { facet: 'voicing|TTBB' }).length, 1);
});

test('grace notes (no length) are left out, so every song can be read back', () => {
  const g = twoStaves({ voicing: ['Unison'] });
  g.m[0].s[0].n.unshift([1, 0, [P('B', 3)], [], []]); // a grace note before the first note
  const s = hymnToSong(g);
  assert.ok(s.parts.every((p) => p.notes.every((n) => n.beats > 0)));
  assert.doesNotThrow(() => parseSong(songToText(s)));
  // A note with no length that slips through is skipped when written, words staying in step.
  const text = songToText({ title: 'x', bpm: 90, parts: [{ name: 'Melody', notes: [{ midi: 60, beat: 0, beats: 0, lyrics: ['oops'] }, { midi: 62, beat: 0, beats: 1, lyrics: ['Hi'] }] }] });
  assert.deepEqual(parseSong(text).notes.map((n) => n.lyric), ['Hi']);
});

test('popularity: survey ranks for Hymns (1985) songs only', async () => {
  const { popularity } = await import('../public/js/popularity.js');
  assert.equal(popularity('hymns', { title: 'I Stand All Amazed' }), 1);
  assert.equal(popularity('hymns', { title: 'We\u2019ll Sing All Hail to Jesus\u2019 Name' }), 10, 'curly quotes');
  assert.equal(popularity('hymns', { title: "'Tis Sweet to Sing the Matchless Love" }), 23, 'two tunes share the higher rank');
  assert.equal(popularity('childrens-songbook', { title: 'I Am a Child of God' }), null, 'the survey is of the hymnbook');
  assert.equal(popularity('set-sunday', { title: 'I Am a Child of God', from: 'Hymns (1985)' }), 45, 'a set keeps its book');
  assert.equal(popularity('hymns', { title: 'Ye Elders of Israel' }), null);
});
