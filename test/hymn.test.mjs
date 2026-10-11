import test from 'node:test';
import assert from 'node:assert/strict';
import { hymnToSong, bookmarklet } from '../public/js/hymn.js';
import { parseSong, songToText, practiceView, barStarts, pickupBeats } from '../public/js/song.js';

// Made-up data in the bookmark's packed shape (no real hymn): a one-beat pickup, then a 3/4
// bar where soprano and alto move together (chords) and then split, and a tied bass note.
const P = (step, octave, alter = 0) => [step, alter, octave];
const data = {
  t: 'Test Hymn',
  bpm: 76,
  m: [
    { time: [3, 4], k: [2, 'major'], s: [
      { d: 4, n: [[1, 4, [P('D', 4), P('F', 4, 1)], [[1, '1.Come,', 'single'], [2, '2.\u2019Here', 'single']], []]] },
      { d: 2, n: [[11, 2, [P('D', 3), P('A', 3)], [], []]] },
    ] },
    { time: null, s: [
      { d: 4, n: [
        [1, 8, [P('A', 4), P('D', 5)], [[1, 'thou', 'single'], [2, 'I', 'single']], []],
        [1, 4, [P('E', 5)], [[1, 'Fount', 'begin'], [2, 'raise', 'single']], []],
        [2, 8, [], [], []],                       // spacer while the parts move together
        [2, 4, [P('C', 5, 1)], [], []],           // alto on its own under the soprano's E5
      ] },
      { d: 2, n: [
        [11, 4, [P('F', 3, 1), P('D', 3)], [], ['start']],
        [11, 2, [P('A', 3), P('D', 3)], [], ['stop']], // the bass D3 is tied over
      ] },
    ] },
  ],
};

test('hymn: parts split from chords and voices, pickup, words, tie', () => {
  const s = hymnToSong(data);
  assert.equal(s.title, 'Test Hymn');
  assert.equal(s.bpm, 76);
  assert.deepEqual(s.key, { tonic: 2, minor: false }, 'D major from two sharps');
  assert.equal(s.transpose, 'octaves', 'hymns keep the hymnbook key');
  const by = Object.fromEntries(s.parts.map((p) => [p.name, p.notes.map((n) => [n.midi, n.beat, n.beats])]));
  assert.deepEqual(by.Soprano, [[66, 0, 1], [74, 1, 2], [76, 3, 1]]);
  assert.deepEqual(by.Alto, [[62, 0, 1], [69, 1, 2], [73, 3, 1]]);
  assert.deepEqual(by.Tenor, [[57, 0, 1], [54, 1, 2], [57, 3, 1]]);
  assert.deepEqual(by.Bass, [[50, 0, 1], [50, 1, 3]], 'tied D3 is one note');
  assert.deepEqual(s.parts[0].notes.map((n) => n.lyrics), [['Come,', "'Here"], ['thou', 'I'], ['Fount-', 'raise']]);

  // Through the text format, as the app stores it.
  const song = parseSong(songToText(s));
  assert.equal(song.verses, 2);
  assert.equal(pickupBeats(song), 1);
  assert.deepEqual(barStarts(song, 4), [0, 1]);
  assert.deepEqual(practiceView(song, 3, 1).notes.map((n) => n.lyric), ["'Here", 'I'], 'bass sings verse 2 on its own beats');
});

test('bookmarklet is a javascript: link that points at the app', () => {
  const b = bookmarklet('https://sing.5sn.com/');
  assert.ok(b.startsWith('javascript:'));
  const code = decodeURIComponent(b.slice('javascript:'.length));
  assert.ok(code.includes('"https://sing.5sn.com/"+\'#import=\''));
  assert.doesNotThrow(() => new Function(code), 'bookmark code parses');
});
