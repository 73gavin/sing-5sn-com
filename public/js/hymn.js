// Hymns from churchofjesuschrist.org: the "Sing" bookmark and the converter for what it sends.
// Each person loads hymns into their own browser (the arrangements may be copied for incidental,
// noncommercial Church or home use); this project stores none.
//
// The bookmark runs on the Church site. On a song's page it sends that song to this app; on any
// other page it opens a panel that collects whole songbooks. Each song's page carries its data
// (window.renderData): the title, credits, every verse's words (including verses printed below
// the music), and a link to the score its Interactive Sheet Music view plays (MusicXML turned
// into JSON). Each book's song list gives numbers, dates, sections, topics, and people, and its
// filter lists give voicing (SATB, TTBB, Unison...), difficulty, ensemble, category, and
// instruments, one list per value. The bookmark keeps what practice needs:
//
//   song:    { t: title, slug, num, book, src: page URL, cr: credits, desc: description (names
//              the book), date, sec: book section, tags: topics, au / co: authors / composers,
//              f: { voicing, difficulty, ensemble, category, instruments, features: [values] },
//              bpm, m: [measure, ...], v: [[kind 'v' verse | 'c' chorus, number, words], ...] }
//            A song already in your library and unchanged comes as details only: no m or v,
//            and meta: true.
//   measure: { time: [beats, beatType] | null, k: [fifths, mode] | null, s: [staff, ...] }
//   staff:   { d: divisions per quarter note | null, c: clef 'G' | 'F' | null,
//              o: clef octave change | null, n: [note, ...] }
//   note:    [voice, duration in divisions, [[step, alter, octave], ...], [[verse, text, syllabic], ...], [tie types]]
//
// Layouts (see hymnToSong): choir parts by voicing, or a melody with accompaniment. Words are
// printed under the melody; a part with words of its own (men answering the women, a bass line
// with different words) has them under its own notes, and keeps them. The site's format is
// undocumented, so if it changes, READ (the code run on the site) needs fixing.

import { meter, songToText, keyFromFifths, isAccompaniment } from './song.js';

// The rules songs are read with. Raise it when hymnToSong changes: the app then rebuilds stored
// songs from the data they were collected with, without collecting them again.
export const READER = 4;

// Code run on the site. read(path) fetches a song page and returns its packed song (above);
// facets(book, only) the filter values of every song in a book, by slug. Kept small: every
// byte is in the bookmark. Backslashes are doubled for the template string.
const READ = `
const plain=h=>new DOMParser().parseFromString(String(h||'').replace(/<br\\s*\\/?>|<\\/p>/gi,'\\n'),'text/html').body.textContent.replace(/[ \\t]+/g,' ').replace(/\\n\\s*/g,'\\n').trim();
const q=x=>encodeURIComponent(JSON.stringify(x));
const songList=async(book,extra)=>(await(await fetch('/media/music/api?type=songsFilteredList&lang=eng&batchSize=500&identifier='+q(Object.assign({lang:'eng',limit:500,offset:0,orderByKey:['bookSongPosition'],bookQueryList:[book]},extra||{})))).json().catch(()=>({}))).data||[];
const facets=async(book,only)=>{
const fl=(await(await fetch('/media/music/api?type=collectionFilters&lang=eng&identifier='+q([book]))).json().catch(()=>({}))).data||{};
const G={voicing:'voicingQueryList',difficulty:'difficultyQueryList',ensemble:'ensembleTypeQueryList',category:'categoryQueryList',instruments:'instrumentationQueryList',features:'musicalFeatureQueryList'};
const out={};
for(const g in G){if(only&&!only.includes(g))continue;
for(const v of fl[G[g]]||[]){for(const x of await songList(book,{[G[g]]:[v.id]}))((out[x.slug]=out[x.slug]||{})[g]=out[x.slug][g]||[]).push(v.value.replace(/\\u2019/g,"'"));
await new Promise(r=>setTimeout(r,300));}}
return out;};
const read=async(path,book,num)=>{
const html=await(await fetch(path+'?lang=eng')).text();
const a=html.indexOf('window.renderData=')+18;const rd=JSON.parse(html.slice(a,html.indexOf('</script>',a)).trim().replace(/;$/,''));
const sd=rd.data.songData;const as=(sd.assets||[]).find(x=>x.pianoMarvelUrl);
const out={t:sd.title,slug:sd.slug||path.split('/').pop(),num:num||'',book:book||'',src:location.origin+path+'?lang=eng',cr:plain(sd.fullCreditsText),desc:plain(sd.description),
v:(sd.verses||[]).filter(x=>x.verseType==='Verse'||x.verseType==='Chorus').map(x=>[x.verseType==='Chorus'?'c':'v',+x.verseNumber||0,plain(x.verseBody)]),bpm:null,m:[]};
if(!as)return out;
const j=await(await fetch('/media/music/proxyldscdn'+new URL(as.pianoMarvelUrl,location.origin).pathname)).json();
out.m=j.part.measurePairList.map(mp=>{const ms=Object.values(mp.measures);const at=ms[0].attributes||{};
return{time:at.time?[at.time.beats,at.time.beatType]:null,k:at.key?[at.key.fifths,at.key.mode]:null,s:ms.map(x=>{const c=x.attributes&&x.attributes.clef;return{d:x.attributes&&x.attributes.division||null,c:c&&c.sign||null,o:c&&+c.octave_change||null,
n:x.noteList.filter(n=>{const t=n.direction&&n.direction.sound&&n.direction.sound.tempo;if(t&&!out.bpm)out.bpm=+t;return!n.isHarmony&&n.voice>0&&n.voice<100;})
.map(n=>[n.voice,n.originDuration,n.rest?[]:(n.pitchList||[]).filter(p=>p.step).map(p=>[p.step,p.alter||0,p.octave]),
(n.lyricList||[]).map(l=>[+l.number,l.text,l.syllabic]),(n.tie||[]).map(t=>t.type||t)])};})};});
return out;};
const pack=async o=>{const b=new Uint8Array(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');};
const meta=x=>{const who=a=>(a||[]).map(p=>p.personName).filter(Boolean);return{date:x.songDate||'',sec:x.bookSectionTitle||'',tags:x.tags||[],au:who(x.authors),co:who(x.composers)};};
`;

// The one bookmark. APP is this app's address; BOOKLIST the songbooks the panel offers.
const SING = `(()=>{${READ}
const BOOKS=BOOKLIST;
if(/\\/media\\/music\\/songs\\//.test(location.pathname)){
const w=open('','_blank');
(async()=>{
const song=await read(location.pathname);
if(!song.m.length)throw new Error('this song has no Interactive Sheet Music');
const d=song.desc||'';const book=/children/i.test(d)?'childrens-songbook':/home and church/i.test(d)?'hymns-for-home-and-church':/\\bhymns\\b/i.test(d)?'hymns':'';
if(book){song.book=book;const x=(await songList(book)).find(s=>s.slug===song.slug);if(x)Object.assign(song,{num:x.songNumber},meta(x));song.f=(await facets(book,['voicing']))[song.slug]||{};}
const url=APP+'#import='+await pack(song);
if(w)w.location.href=url;else location.href=url;
})().catch(e=>{w&&w.close();alert('Could not read this song: '+e.message);});
return;}
if(document.getElementById('sing-collect'))return;
const d=document.createElement('div');d.id='sing-collect';
d.style.cssText='position:fixed;top:12px;right:12px;z-index:99999;background:#fff;color:#111;border:2px solid #2f6fde;border-radius:10px;padding:12px 14px;font:14px system-ui;max-width:360px;box-shadow:0 6px 24px #0004';
d.innerHTML='<b>Collect songs for Sing</b><div id="sc-books"></div>'
+'<label style="display:block;margin-top:8px">Your library file, to fetch only new or changed songs (optional):<br><input type="file" id="sc-have" accept=".json"></label>'
+'<label style="display:block;margin-top:6px"><input type="checkbox" id="sc-meta" checked> Also refresh the details (topics, voicing...) of songs you have: quick</label>'
+'<label style="display:block;margin-top:6px">Only the first <input id="sc-limit" type="number" min="1" style="width:5em"> new songs of each book (blank: all)</label>'
+'<div style="margin-top:10px"><button id="sc-go">Start</button> <button id="sc-x">Close</button></div><div id="sc-msg" style="margin-top:8px;white-space:pre-wrap"></div>';
document.body.append(d);
const $=i=>d.querySelector('#'+i);
$('sc-books').innerHTML=Object.entries(BOOKS).map(([s,n])=>'<label style="display:block"><input type="checkbox" value="'+s+'" checked> '+n+'</label>').join('');
let stop=false;$('sc-x').onclick=()=>{stop=true;d.remove();};
const msg=t=>$('sc-msg').textContent=t;
$('sc-go').onclick=async()=>{
$('sc-go').disabled=true;
try{
const have=new Map();const f=$('sc-have').files[0];
if(f){const j=JSON.parse(await f.text());for(const c of j.collections||[])for(const x of c.songs||[])have.set(c.id+'/'+x.id,x.added||'');for(const b of j.books||[])for(const x of b.songs||[])if(!x.meta)have.set(b.slug+'/'+x.slug,x.date||'');}
const limit=+$('sc-limit').value||Infinity;const books=[];
for(const box of d.querySelectorAll('#sc-books input:checked')){
const slug=box.value;msg(BOOKS[slug]+': reading the song list and its filters...');
const list=await songList(slug);const fx=await facets(slug);
const fresh=list.filter(x=>!have.has(slug+'/'+x.slug)||have.get(slug+'/'+x.slug)!==(x.songDate||''));
const todo=fresh.slice(0,limit);const songs=[];
if($('sc-meta').checked)for(const x of list)if(!fresh.includes(x))songs.push(Object.assign({t:x.title,slug:x.slug,num:x.songNumber,book:slug,meta:true,f:fx[x.slug]||{}},meta(x)));
for(let i=0;i<todo.length&&!stop;i++){
const x=todo[i];msg(BOOKS[slug]+': '+(i+1)+' of '+todo.length+' new or changed\\n'+x.songNumber+' '+x.title);
try{const s=await read('/media/music/songs/'+x.slug,slug,x.songNumber);Object.assign(s,meta(x),{f:fx[x.slug]||{}});songs.push(s);}catch(e){songs.push({t:x.title,slug:x.slug,num:x.songNumber,book:slug,error:e.message});}
await new Promise(r=>setTimeout(r,700));}
books.push({slug,title:BOOKS[slug],songs});}
if(stop)return;
const out={schema:'sing-collected/v1',collected:new Date().toISOString(),books};
const n=books.reduce((a,b)=>a+b.songs.length,0);
if(!n){msg('Nothing new to collect.');return;}
const packed=await pack(out);
if(packed.length<1500000){msg('Opening Sing with '+n+' songs...');location.href=APP+'#collected='+packed;return;}
const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(out)],{type:'application/json'}));
a.download='songs-collected-'+out.collected.slice(0,10)+'.json';a.click();
msg('Saved '+n+' songs as '+a.download+'. In Sing, open it with "Open a file".');
}catch(e){msg('Stopped: '+e.message);}
finally{$('sc-go').disabled=false;}};
})()`;

// The songbooks the collector offers, by the site's book name.
export const BOOKS = {
  'hymns-for-home-and-church': 'Hymns for Home and Church',
  hymns: 'Hymns (1985)',
  'childrens-songbook': "Children's Songbook",
};

// The "Sing" bookmark for an app at `appUrl` (e.g. https://sing.5sn.com/).
export const bookmarklet = (appUrl) =>
  `javascript:${encodeURIComponent(SING.replace('BOOKLIST', JSON.stringify(BOOKS)).replace(/\n/g, '').replace(/\bAPP\b/g, JSON.stringify(appUrl)))}`;

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const toMidi = ([step, alter, octave]) => (Number(octave) + 1) * 12 + PC[step] + Number(alter || 0);
const plainQuotes = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');

// A packed song to a song with parts and verses (see song.js), plus what the app needs to fit
// the verses printed below the music: { ...song, extra: [{ number, words }] }. On the melody's
// notes, `chorus` marks a refrain: notes every verse sings with the same words.
//
// The site's voicing decides the parts (VOICINGS): SATB, men's (TTBB, TTB) and women's (SSA, SA)
// choir, two-part. A unison song, or one from the Children's Songbook, is a melody with
// accompaniment: the melody is the top line of the staff that carries the words, another staff
// with words is a descant, and staves without words are the piano (or an instrument). With no
// voicing (an older collection), two staves, treble then bass, are taken as SATB. Accompaniment
// parts play along but aren't offered to sing (see song.js).
export function hymnToSong(data) {
  // Every staff's voices as timed events, bar by bar.
  const staves = [];   // staves[si] = { clef, voices: Map(voice -> events) }
  const division = [];
  const meters = [];
  let at = 0, last = null;
  for (const measure of data.m) {
    let length = 0;
    measure.s.forEach((staff, si) => {
      const st = staves[si] ||= { clef: null, voices: new Map() };
      if (staff.c && !st.clef) { st.clef = staff.c; st.octave = staff.o || 0; }
      if (staff.d) division[si] = staff.d;
      const t = new Map();
      for (const [voice, dur, pitches, lyr, ties] of staff.n) {
        const beats = dur / (division[si] || 4);
        const v0 = t.get(voice) || 0;
        if (pitches.length && beats > 0) { // grace notes take no time: left out
          const events = st.voices.get(voice) || st.voices.set(voice, []).get(voice);
          events.push({ beat: at + v0, beats, midis: pitches.map(toMidi).sort((x, y) => x - y), lyr, ties });
        }
        t.set(voice, v0 + beats);
        length = Math.max(length, v0 + beats);
      }
    });
    // The bar's length as sung (a pickup is short), written as a time signature when it changes.
    const sig = measure.time && Math.abs((measure.time[0] * 4) / measure.time[1] - length) < 1e-6 ? measure.time
      : Number.isInteger(length) ? [length, 4] : [Math.round(length * 2), 8];
    if (!last || sig[0] !== last[0] || sig[1] !== last[1]) meters.push({ beat: at, ...meter(sig[0], sig[1]) });
    last = sig;
    at += length;
  }
  // Collected before clefs were kept: assume treble staves over one bass staff.
  staves.forEach((st, si) => (st.clef ||= si === staves.length - 1 && staves.length > 1 ? 'F' : 'G'));

  const voicing = data.f?.voicing?.[0] || '';
  const children = /children/i.test(`${data.book || ''} ${data.desc || ''}`);
  const plan = VOICINGS[voicing]
    || (!voicing && !children && staves.length === 2 && staves[0].clef === 'G' && staves[1].clef === 'F' ? VOICINGS.SATB : null);
  const list = (plan && staves.length >= plan.length ? voicedParts(staves, plan) : melodyParts(staves)).filter((x) => x.notes.length);
  if (!list.length) throw new Error('No notes found in this song.');
  for (const x of list) x.notes.sort((p, q) => p.beat - q.beat);

  const chorusWords = (data.v || []).find(([kind]) => kind === 'c')?.[2] || '';
  const scoreVerses = markChorus(list[0].notes, chorusWords);
  shareWords(list, Math.max(1, scoreVerses));

  // Verses printed below the music: words only, for the app to fit to the notes.
  const extra = (data.v || [])
    .filter(([kind, number]) => kind === 'v' && number > scoreVerses)
    .map(([, number, words]) => ({ number, words: plainQuotes(words) }));

  const k = data.m.find((x) => x.k)?.k;
  const key = k ? keyFromFifths(Number(k[0]), k[1] === 'minor') : null;
  return {
    title: data.t || 'Hymn', bpm: data.bpm || 80, key,
    // Sung with others, so practice keeps the written key (see "transpose" in song.js).
    transpose: 'octaves',
    source: data.src || null, credit: data.cr ? plainQuotes(data.cr).replace(/\s+/g, ' ') : null,
    meters, parts: list, extra,
  };
}

// Adds a note to a part (one note at a time). A tie continues the note before; a note that
// starts before the last one ends cuts it short. own: words printed under this part's notes
// ([[verse, text, syllabic], ...]), not the melody's.
function addNote(part, midi, e, lyrics = [], own = null) {
  const list = part.notes;
  const prev = list.at(-1);
  if (prev && e.ties.includes('stop') && prev.midi === midi && Math.abs(prev.beat + prev.beats - e.beat) < 1e-6) {
    prev.beats += e.beats;
    return;
  }
  if (prev && prev.beat + prev.beats > e.beat) {
    prev.beats = e.beat - prev.beat;
    if (prev.beats < 0.01) list.pop(); // two notes at once in one part: the later one wins
  }
  list.push({ midi, beat: e.beat, beats: e.beats, lyrics, ...(own?.length ? { own } : {}) });
}

const byBeat = (events) => [...events].sort((p, q) => p.beat - q.beat);
const wordCount = (events) => events.reduce((n, e) => n + (e.lyr || []).filter(([, t]) => t).length, 0);

// Choir parts by voicing, staff by staff: [upper part, lower part] (a lower part only where the
// staff carries two). Tenor parts written in treble clef sound an octave lower (shift).
// Staves past the plan are the piano.
const VOICINGS = {
  SATB: [{ names: ['Soprano', 'Alto'] }, { names: ['Tenor', 'Bass'] }],
  TTBB: [{ names: ['Tenor 1', 'Tenor 2'], shift: -12 }, { names: ['Baritone', 'Bass'] }],
  TTB: [{ names: ['Tenor 1', 'Tenor 2'], shift: -12 }, { names: ['Bass'] }],
  SSA: [{ names: ['Soprano 1', 'Soprano 2'] }, { names: ['Alto'] }],
  SA: [{ names: ['Soprano', 'Alto'] }],
  'Two-Part': [{ names: ['Part 1', 'Part 2'] }],
};

// Where two parts share a staff they are one chord in the staff's upper voice while they move
// together; where they split, the upper voice has the higher part alone and the lower voice the
// other. Words under the first staff's top part are the melody's.
function voicedParts(staves, plan) {
  const out = [];
  plan.forEach(({ names, shift = 0 }, si) => {
    const st = staves[si];
    const move = st.octave ? 12 * st.octave : st.clef === 'G' ? shift : 0; // the clef's own octave mark wins
    const [high, low] = names.map((name) => ({ name, notes: [] }));
    const [upperId, lowerId] = [...st.voices.keys()].sort((p, q) => p - q);
    const upper = byBeat(st.voices.get(upperId) || []);
    const lower = byBeat(st.voices.get(lowerId) || []);
    const lowerSounds = (e) => lower.some((x) => x.beat < e.beat + e.beats - 1e-6 && x.beat + x.beats > e.beat + 1e-6);
    const melody = si === 0;
    for (const e of upper) {
      addNote(high, e.midis.at(-1) + move, e, melody ? verses(e.lyr) : [], melody ? null : e.lyr);
      // A single note with nothing in the lower voice is both parts in unison.
      if (low && (e.midis.length > 1 || !lowerSounds(e))) addNote(low, e.midis[0] + move, e, [], melody ? null : e.lyr);
    }
    for (const e of lower) addNote(low || high, e.midis[0] + move, e, [], e.lyr);
    out.push(high, ...(low ? [low] : []));
  });
  // The rest is accompaniment: treble staves the right hand, bass staves the left.
  const right = { name: 'Piano (right hand)', notes: [] }, left = { name: 'Piano (left hand)', notes: [] };
  staves.slice(plan.length).forEach((st) => {
    for (const e of byBeat([...st.voices.values()].flat())) {
      if (st.clef === 'F') addNote(left, e.midis[0], e); else addNote(right, e.midis.at(-1), e);
    }
  });
  return [...out, right, left];
}

// Melody with accompaniment. The staff with the most words carries the melody: the top note of
// its worded voice. Its other notes are the piano's right hand. Another staff with words is a
// descant (above) or a second part (below); staves without words are the piano or an instrument.
function melodyParts(staves) {
  const words = staves.map((st) => [...st.voices.values()].reduce((n, ev) => n + wordCount(ev), 0));
  const mi = words.indexOf(Math.max(...words));
  const melody = { name: 'Melody', notes: [] };
  const out = [melody];
  const right = { name: 'Piano (right hand)', notes: [] };
  const rightNotes = [];
  const ms = staves[mi];
  const mv = [...ms.voices.keys()].reduce((best, v) => (wordCount(ms.voices.get(v)) > wordCount(ms.voices.get(best) || []) ? v : best));
  for (const e of byBeat(ms.voices.get(mv))) {
    addNote(melody, e.midis.at(-1), e, verses(e.lyr));
    if (e.midis.length > 1) rightNotes.push({ ...e, midi: e.midis.at(-2) });
  }
  for (const [v, events] of ms.voices) if (v !== mv) for (const e of events) rightNotes.push({ ...e, midi: e.midis.at(-1) });
  staves.forEach((st, si) => {
    if (si === mi) return;
    const all = byBeat([...st.voices.values()].flat());
    if (words[si]) {
      const part = { name: si < mi ? 'Descant' : 'Part 2', notes: [] };
      for (const e of all) addNote(part, e.midis.at(-1), e, [], e.lyr);
      out.push(part);
    } else if (st.clef === 'F') {
      const part = { name: 'Piano (left hand)', notes: [] };
      for (const e of all) addNote(part, e.midis[0], e); // the bass line
      out.push(part);
    } else if (si < mi) {
      const part = { name: 'Instrument', notes: [] };
      for (const e of all) addNote(part, e.midis.at(-1), e);
      out.push(part);
    } else {
      for (const e of all) rightNotes.push({ ...e, midi: e.midis.at(-1) });
    }
  });
  for (const e of byBeat(rightNotes)) addNote(right, e.midi, e);
  out.splice(1, 0, right);
  return out;
}

// Refrains: notes every verse sings with the same words. They get those words in every verse
// and are marked `chorus`. Found by the chorus's words when the page has them (the notes whose
// first-verse syllables spell them out), else as a run of at least six melody notes where only
// the first verse line has words. Returns how many verses are under the music.
function markChorus(notes, chorusWords = '') {
  const count = Math.max(0, ...notes.map((n) => n.lyrics.length));
  const mark = (from, to) => {
    for (let x = from; x < to; x++) {
      notes[x].chorus = true;
      notes[x].lyrics = Array.from({ length: Math.max(1, count) }, () => notes[x].lyrics[0] || '');
    }
  };
  const target = letters(chorusWords);
  if (target.length >= 4) {
    for (let s = 0; s < notes.length; s++) {
      if (!notes[s].lyrics[0]) continue;
      let spelled = '', e = s;
      while (e < notes.length && spelled.length < target.length) spelled += letters(notes[e++].lyrics[0] || '');
      if (spelled !== target) continue;
      while (e < notes.length && !notes[e].lyrics.some(Boolean)) e++; // the last word held on
      mark(s, e);
      return count;
    }
  }
  if (count < 2) return count;
  const only1 = (n) => n.lyrics[0] && !n.lyrics.slice(1).some(Boolean);
  for (let i = 0; i < notes.length;) {
    let j = i;
    while (j < notes.length && (only1(notes[j]) || (j > i && !notes[j].lyrics.some(Boolean)))) j++;
    if (j - i >= 6) mark(i, j);
    i = Math.max(j, i + 1);
  }
  return count;
}

// Words for the parts besides the melody. A part's own words stay; if they come in only one
// line (a countermelody or an answer in a refrain) every verse sings them. Notes between its own
// words, a few beats apart, hold the word before. Everything else sings the melody's words on
// the notes that start together. Each note records which (`share`), so verses fitted later
// reach the other parts too (addVerse).
function shareWords(parts, count) {
  const at = new Map(parts[0].notes.map((n) => [Math.round(n.beat * 1000), n]));
  for (const p of parts.slice(1)) {
    if (isAccompaniment(p.name)) { for (const n of p.notes) { n.lyrics = []; n.share = 'none'; } continue; }
    const lines = new Set(p.notes.flatMap((n) => (n.own || []).map(([num]) => num)));
    const own = [];
    p.notes.forEach((n, i) => {
      if (!n.own) return;
      const words = verses(n.own);
      if (words.some(Boolean)) {
        n.lyrics = lines.size === 1 ? Array(count).fill(words.find(Boolean)) : Array.from({ length: count }, (_, v) => words[v] || '');
        n.share = lines.size === 1 ? 'own1' : 'own';
        own.push(i);
      }
      delete n.own;
    });
    for (let k = 0; k + 1 < own.length; k++) {
      const a = p.notes[own[k]], b = own[k + 1];
      if (p.notes[b].beat - (a.beat + a.beats) > 4) continue;
      for (let i = own[k] + 1; i < b; i++) Object.assign(p.notes[i], { share: 'held', lyrics: Array(count).fill('') });
    }
    for (const n of p.notes) {
      if (n.share) continue;
      const m = at.get(Math.round(n.beat * 1000));
      n.share = 'melody';
      n.lyrics = Array.from({ length: count }, (_, v) => (m ? m.lyrics[v] || '' : ''));
    }
  }
}

// [[verse, text, syllabic], ...] to one syllable per verse; a word that carries on gets a "-".
function verses(lyr) {
  const out = [];
  for (const [num, text, syllabic] of lyr || []) {
    if (!(num >= 1) || !text) continue;
    // The first syllable of each verse carries its number ("1.Come,"); curly quotes become plain.
    const word = plainQuotes(text.replace(/^\d+\.\s*/, '')).replace(/\s+/g, '');
    // A dash or other mark alone on a note is no syllable: the note before is held.
    if (/\p{L}|\p{N}/u.test(word)) out[num - 1] = word + (syllabic === 'begin' || syllabic === 'middle' ? '-' : '');
  }
  return Array.from(out, (w) => w || '');
}

// ---------- fitting the verses printed below the music ----------
//
// The melody's notes outside a chorus, with the first verse's syllables ('_' where a syllable
// is held over another note), are the template; AI splits the new verse into the same number
// of slots (prompt in report.js), and fitVerse checks the answer before it is used.

export function verseTemplate(song) {
  return song.parts[0].notes.filter((n) => !n.chorus).map((n) => n.lyrics[0] || '_');
}

const letters = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}]/gu, '');

// Checks an answer (an array of syllables) against the template and the verse's words.
// Returns null if good, else why not.
export function checkFit(template, words, answer) {
  if (!Array.isArray(answer)) return 'not a list';
  if (answer.length !== template.length) return `${answer.length} syllables for ${template.length} notes`;
  if (!answer.every((x) => typeof x === 'string')) return 'not all text';
  if (letters(answer.join('')) !== letters(words)) return 'the words changed';
  return null;
}

// Puts a checked answer into the song as verse `number`, on every part (via the melody).
export function addVerse(song, number, answer) {
  const v = number - 1;
  let k = 0;
  for (const n of song.parts[0].notes) {
    const word = n.chorus ? n.lyrics[0] : answer[k++];
    n.lyrics[v] = word === '_' ? '' : plainQuotes(word).replace(/\s+/g, '');
  }
  for (const n of song.parts[0].notes) for (let i = 0; i < v; i++) n.lyrics[i] ||= '';
  // The other parts follow the melody's words, or keep their own (see shareWords).
  const at = new Map(song.parts[0].notes.map((n) => [Math.round(n.beat * 1000), n]));
  for (const p of song.parts.slice(1)) {
    for (const n of p.notes) {
      if (n.share === 'none') continue;
      for (let i = 0; i < v; i++) n.lyrics[i] ||= '';
      if (n.share === 'none') continue;
      if (n.share === 'melody') n.lyrics[v] = at.get(Math.round(n.beat * 1000))?.lyrics[v] || '';
      else if (n.share === 'own1') n.lyrics[v] = n.lyrics[0];
      else n.lyrics[v] ||= '';
    }
  }
}

// The packed address value from the Send to Sing bookmark, to { song, data } (compressed).
export async function pack(obj) {
  const b = new Uint8Array(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode(...b.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function unpack(packed) {
  const bytes = Uint8Array.from(atob(packed.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text());
}

// Song text for a packed song, verses below the music left out (they need fitting first).
export const hymnText = (data) => songToText(hymnToSong(data));
