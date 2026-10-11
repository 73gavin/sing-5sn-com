# Ideas and next steps

Things worth doing that aren't built yet, roughly in order of usefulness. Big phases are in the
README's Roadmap; this is the smaller, running list. Move an item to the README when it ships.

## Songs and library

- **MusicXML import (.musicxml, .mxl).** The standard score format. One importer opens files
  exported from MuseScore (desktop app or musescore.com downloads), Finale, Sibelius, Dorico, and
  public domain sources (CPDL, Open Hymnal, some IMSLP). `.mxl` is zipped; unzipping needs a small
  reader (DecompressionStream handles the deflate part). Probably the single most useful addition.
- **A hosted public domain collection.** Candidates, all needing a license check per song:
  - Open Hymnal Project: public domain hymns, many with MusicXML or ABC.
  - CPDL (Choral Public Domain Library): thousands of choral scores, many MusicXML; each score
    carries its editor's license (most allow free copying).
  - Hymnary.org: hymn texts and tunes, many public domain, some MIDI and MusicXML.
  - Mutopia Project: public domain scores in LilyPond, with MIDI.
  Build a `sing-library/v1` file from these (with source and license per song) and host it as a
  loadable collection, e.g. `/collections/public-domain-hymns.json` on the site.
- **More library filters**: voicing, difficulty, choir, category, instruments, and topics are
  in (from the site's filter lists). Still to add: an author / composer list, "has a recording",
  and the site's book sections as a browsable list.
- **Section labels from the score** ("Men", "Women", "Unison", "Descant"): shown above the notes
  when a score has them. None found in Hymns for Home and Church; check the older books.
- **Members' set checklist**: in a set, mark what each member has practiced and their last take.
- **Per-voice set links** ("open everything on Bass").

## Practice

- **Loop a section** (bars N to M), and slow practice of just that bit.
- **Recorded takes**: play back your own singing with the score.
- **Low voices**: on very low notes the detector sometimes reads about 7 semitones high (a
  harmonic). Seen in a take two octaves down (C2-A2). Needs a recording to tune against.

## Timing

- **Sing-along measurement for Bluetooth**: sing on clicks through speakers, then through the
  headphones; the difference is the headphone delay (your own lean cancels out).
- **Remember the timing adjustment per output device** where the browser names devices
  (laptops yes, phones mostly no).

## Not planned, and why

- **A musescore.com account loader.** musescore.com has no public download API, many downloads
  need a paid plan, its terms forbid automated downloading, and scores there are user uploads
  with mixed copyright. Instead: download MusicXML from MuseScore yourself and open it here (needs
  MusicXML import, above).
- **SQLite.** A JSON file plus the browser's IndexedDB holds every hymnbook easily; SQLite in a
  browser would need a large package, and the site has no build step or dependencies.
