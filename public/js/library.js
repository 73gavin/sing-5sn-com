// The song library: collections of songs (a songbook, your own songs, a choir set), kept in the
// browser (IndexedDB) and saved to or opened from files. A library file and a set file are the
// same format, so a set is just a small library:
//
//   { schema: 'sing-library/v1', saved: ISO date, collections: [collection, ...] }
//   collection: { id, name, kind: 'songbook' | 'own' | 'set', note?, updated, songs: [song, ...] }
//   song: { id, number, title, added, source, credit, text, words, section?, tags?, authors?,
//           composers?, facets?, note?, unfitted?, raw?, fits?, built? }
//     facets: the site's filter values: { voicing, difficulty, ensemble, category, instruments,
//             features: [values] }
//     raw:   the collected song (hymn.js), compressed, so songs can be rebuilt with newer reading
//            rules (built: the READER they were built with) without collecting them again
//     fits:  { [verse number]: answer } verses AI fitted, so a rebuild doesn't ask again
//     text:  the song in the text format (song.js), with parts and every verse it could fit
//     words: every verse's words as plain text, for searching
//     unfitted: [{ number, words, why }] verses that could not be fitted to the notes
//
// Collected hymns (hymn.js, 'sing-collected/v1') become library songs here, with AI fitting the
// verses printed below the music; each answer is checked before it is used (checkFit).

import { hymnToSong, verseTemplate, checkFit, addVerse, pack, unpack, READER } from './hymn.js';
import { songToText } from './song.js';

export const SCHEMA = 'sing-library/v1';

// ---------- building songs from collected hymns ----------

// One collected song to a library song. fit(template, words) -> Promise<answer> splits a verse
// (or is null: then extra verses are kept as words only); fits are answers from before, used
// first. onVerse(text) reports progress.
export async function buildSong(data, fit = null, onVerse = () => {}, fits = {}) {
  const song = hymnToSong(data);
  const unfitted = [];
  const kept = {};
  for (const { number, words } of song.extra) {
    const before = fits[number];
    if (before && !checkFit(verseTemplate(song), words, before)) {
      addVerse(song, number, before);
      kept[number] = before;
      continue;
    }
    if (!fit) { unfitted.push({ number, words, why: 'no AI connected' }); continue; }
    onVerse(`verse ${number}`);
    const template = verseTemplate(song);
    let why = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const answer = await fit(template, words);
        why = checkFit(template, words, answer);
        if (!why) { addVerse(song, number, answer); kept[number] = answer; break; }
      } catch (e) {
        why = e.message;
      }
    }
    if (why) unfitted.push({ number, words, why });
  }
  return {
    id: data.slug,
    number: String(data.num || ''),
    title: data.t,
    added: data.date || '',
    source: data.src || null,
    credit: song.credit,
    text: songToText(song),
    words: (data.v || []).map(([, , w]) => w).join('\n'),
    ...(data.sec ? { section: data.sec } : {}),
    ...(data.tags?.length ? { tags: data.tags } : {}),
    ...(data.au?.length ? { authors: data.au } : {}),
    ...(data.co?.length ? { composers: data.co } : {}),
    ...(facetsOf(data) ? { facets: facetsOf(data) } : {}),
    ...(unfitted.length ? { unfitted } : {}),
    raw: await pack(data),
    ...(Object.keys(kept).length ? { fits: kept } : {}),
    built: READER,
  };
}

const facetsOf = (data) => (data.f && Object.keys(data.f).length ? data.f : null);

// A song built with older reading rules, rebuilt from the data it was collected with. Keeps its
// AI-fitted verses and anything added in the library (a set's note).
export async function rebuildSong(entry) {
  if (!entry.raw) return entry;
  const fresh = await buildSong(await unpack(entry.raw), null, () => {}, entry.fits || {});
  return { ...entry, ...fresh, ...(entry.note ? { note: entry.note } : {}) };
}

// Songs that need rebuilding: collected data, built with older rules.
export const stale = (collections) => collections.flatMap((c) => c.songs.filter((s) => s.raw && s.built !== READER).map((s) => ({ c, s })));

// A details-only update (topics, voicing...) into a song you have. Returns the updated song, or
// null if nothing changed; rebuilt when its voicing changed (the parts depend on it).
export async function updateDetails(entry, data) {
  const next = {
    ...entry,
    number: String(data.num || entry.number || ''),
    added: data.date || entry.added || '',
    ...(data.sec ? { section: data.sec } : {}),
    ...(data.tags?.length ? { tags: data.tags } : {}),
    ...(data.au?.length ? { authors: data.au } : {}),
    ...(data.co?.length ? { composers: data.co } : {}),
    ...(facetsOf(data) ? { facets: facetsOf(data) } : {}),
  };
  if (JSON.stringify(next) === JSON.stringify(entry)) return null;
  const voicing = (s) => s.facets?.voicing?.join(',') || '';
  if (voicing(next) !== voicing(entry) && entry.raw) {
    const raw = await unpack(entry.raw);
    raw.f = next.facets;
    return rebuildSong({ ...next, raw: await pack(raw) });
  }
  return next;
}

// The AI's reply to a list of syllables: the first JSON array in it.
export function parseAnswer(text) {
  const a = text.indexOf('['), b = text.lastIndexOf(']');
  if (a < 0 || b < a) throw new Error('no list in the answer');
  return JSON.parse(text.slice(a, b + 1));
}

// ---------- merging ----------

// Adds or replaces collections and songs (by id), returning the merged list.
export function merge(into, collections) {
  const out = new Map(into.map((c) => [c.id, { ...c, songs: [...c.songs] }]));
  for (const c of collections) {
    const have = out.get(c.id);
    if (!have) { out.set(c.id, { ...c, songs: [...c.songs] }); continue; }
    const byId = new Map(have.songs.map((s) => [s.id, s]));
    for (const s of c.songs) byId.set(s.id, s);
    out.set(c.id, { ...have, ...c, songs: [...byId.values()], updated: new Date().toISOString() });
  }
  return [...out.values()];
}

// A file's contents to collections, or what it needs: { collections } or { collected } (needs
// building) or throws.
export function readFile(json) {
  if (json?.schema === SCHEMA && Array.isArray(json.collections)) return { collections: json.collections };
  if (json?.schema === 'sing-collected/v1' && Array.isArray(json.books)) return { collected: json };
  throw new Error('This is not a Sing library, set, or collected songs file.');
}

export const libraryFile = (collections) => ({ schema: SCHEMA, saved: new Date().toISOString(), collections });

// A choir set: chosen songs (with their collection's name) and notes, as a one-collection file.
export function setFile(name, note, items) {
  const id = `set-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'songs'}`;
  return libraryFile([{
    id, name, kind: 'set', note: note || '', updated: new Date().toISOString(),
    songs: items.map(({ song, from, note: n }) => ({ ...song, id: `${from.id}--${song.id}`, from: from.name, ...(n ? { note: n } : {}) })),
  }]);
}

// ---------- searching ----------

const fold = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ');

// Songs matching every word of `query` in the collection name, number, title, words, section,
// topics, people, or filter values. A number alone finds that number first; titles rank above
// the rest. Options: only (a collection id), topic, facet ('voicing|SATB'), limit.
export function search(collections, query, { only = '', topic = '', facet = '', limit = 50 } = {}) {
  const [fk, fv] = facet ? facet.split('|') : [];
  const q = fold(query).split(/\s+/).filter(Boolean);
  const out = [];
  for (const c of collections) {
    if (only && c.id !== only) continue;
    const cname = fold(c.name);
    for (const s of c.songs) {
      const title = fold(s.title), num = String(s.number || '').toLowerCase();
      if (topic && !(s.tags || []).includes(topic)) continue;
      if (fk && !(s.facets?.[fk] || []).includes(fv)) continue;
      const hay = `${cname} ${num} ${title} ${fold(s.words)} ${fold(s.section)} ${fold((s.tags || []).join(' '))} ${fold([...(s.authors || []), ...(s.composers || [])].join(' '))} ${fold(Object.values(s.facets || {}).flat().join(' '))}`;
      if (!q.every((w) => hay.includes(w))) continue;
      let score = 0;
      if (q.length === 1 && q[0] === num) score += 100;
      if (q.length && title.startsWith(q.join(' '))) score += 50;
      score += q.filter((w) => title.includes(w)).length * 10;
      out.push({ collection: c, song: s, score });
    }
  }
  const n = (s) => parseInt(s.number, 10) || 1e9;
  out.sort((a, b) => b.score - a.score || n(a.song) - n(b.song) || a.song.title.localeCompare(b.song.title));
  return out.slice(0, limit);
}

// Every topic in the library, most used first, for a topic filter.
export function topics(collections) {
  const n = new Map();
  for (const c of collections) for (const s of c.songs) for (const t of s.tags || []) n.set(t, (n.get(t) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

// The filter values in the library, for a filter menu: [{ key, label, values }].
export const FACETS = { voicing: 'Voicing', difficulty: 'Difficulty', ensemble: 'Choir', category: 'Category', instruments: 'Instruments', features: 'Feature' };
export function facetList(collections) {
  const seen = {};
  for (const c of collections) for (const s of c.songs) for (const [k, vs] of Object.entries(s.facets || {})) for (const v of vs) (seen[k] ||= new Set()).add(v);
  return Object.keys(FACETS).filter((k) => seen[k]).map((key) => ({ key, label: FACETS[key], values: [...seen[key]].sort() }));
}

// ---------- opening a web address ----------

// Share links that point at a page rather than the file, changed to the file where possible.
export function fileUrl(url) {
  const u = new URL(url);
  if (/(^|\.)dropbox\.com$/.test(u.hostname)) { u.searchParams.set('dl', '1'); return u.href; }
  if (/(^|\.)drive\.google\.com$|(^|\.)docs\.google\.com$/.test(u.hostname)) {
    throw new Error('Google Drive does not let other web apps read its files. Download the file, then use "Open a file". Dropbox, GitHub, or your own website links work.');
  }
  if (u.hostname === 'github.com' && u.pathname.includes('/blob/')) {
    return `https://raw.githubusercontent.com${u.pathname.replace('/blob/', '/')}`;
  }
  return u.href;
}

export async function fetchFile(url) {
  let r;
  try {
    r = await fetch(fileUrl(url));
  } catch (e) {
    if (e.message.startsWith('Google Drive')) throw e;
    throw new Error("Couldn't read that address. The site may not allow other web apps to read it (Google Drive doesn't); download the file and use \"Open a file\" instead.");
  }
  if (!r.ok) throw new Error(`That address answered ${r.status} ${r.statusText}.`);
  return r.json();
}

// ---------- kept in the browser ----------

const DB = 'sing-library', STORE = 'collections';

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const loadAll = () => tx('readonly', (s) => s.getAll());
export const saveCollection = (c) => tx('readwrite', (s) => s.put(c));
export const deleteCollection = (id) => tx('readwrite', (s) => s.delete(id));
