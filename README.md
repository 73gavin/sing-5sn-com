# Voice Range Test

Live at **https://sing.5sn.com**.

A free, open source vocal range test that runs in the browser. It plays a note, you
sing it back, you say how it felt, and it maps your **comfortable range**, full range,
and light/falsetto range onto a keyboard. Audio never leaves the device.

This is phase 1 of a larger idea: tools that help a new singer find songs that fit their
voice, co-write songs they can actually perform, and practice them. See [Roadmap](#roadmap).

## Run it

```sh
npm start          # or: node bridge/server.mjs
```

Open http://localhost:8787. No install step, no dependencies (Node 20+). The mic needs
`localhost` or HTTPS.

### On a phone or tablet (same network)

Browsers only allow the mic on `localhost` or HTTPS, so plain `http://<pc-ip>` won't work.

```sh
npm run lan        # or: node bridge/server.mjs --lan
```

This serves HTTPS on every network interface, using a self-signed certificate generated
into `bridge/certs/`, and prints one URL per adapter, like
`https://192.168.1.20:8787/?key=...`. Open the one for the network the phone is on and
accept the certificate warning (Advanced, then Proceed). The `key` is a pairing key: the
page remembers it, and AI calls from other devices are refused without it. Delete
`bridge/certs/pairing-key.txt` to revoke paired devices.

If the phone runs Tailscale, the Tailscale address works from anywhere, not only at home.

`public/` is a plain static site (Cloudflare Pages: no build command, output dir
`public/`). Deployed, everything works except the AI button, which needs the local bridge.

## Tests

```sh
npm test
```

Synthetic voice-like tones from C2 to F#6 must be detected within 10 cents.

## How it works

| File | Role |
|---|---|
| `public/js/pitch.js` | YIN pitch detection, plus `NoteHold`, which turns frame estimates into held notes |
| `public/js/notes.js` | Hz / MIDI / note-name math, voice-type label |
| `public/js/audio.js` | Mic input (browser voice processing off), reference tones |
| `public/js/app.js` | Test flow, live display, results, history (localStorage) |
| `public/js/song.js` | Song text format, MIDI import, per-note pitch and timing scoring (no DOM, tested) |
| `public/js/songs.js` | Built-in public domain practice melodies |
| `public/js/sing.js` | Song practice page: count-in, scrolling note picture, take review |
| `public/js/hymn.js` | The "Sing" bookmark for churchofjesuschrist.org (one song, or whole songbooks), and the converter |
| `public/js/library.js` | Library of collections (IndexedDB), search, set and library files, verse fitting |
| `public/js/popularity.js` | The 50 most-sung hymns (SingPraises.net survey), for the "Most sung" filter |
| `public/js/ai.js` | Optional client for the AI bridge |
| `bridge/` | Local server: static files + pluggable AI |

Test flow: the speaking voice ("We were away a year ago", median pitch,
which the person can nudge up or down) sets the starting note, then semitone steps down and then
up from home. Each note is played, matched within 50 cents, held 0.8 s, and rated Easy /
OK / Strained (/ Light going up). Going down stops on "Can't reach" or two strained notes
in a row. Going up, the first such stop (if no Light note has been rated yet) coaches the
singer to try their light voice (falsetto) and re-tests from the first strained note; after
that, two strained notes ask "Keep going / Finish" and "Can't reach" finishes. The comfortable range is the unbroken run of Easy/OK notes around home.

The mic is ignored while a reference tone plays, so it works without headphones, but
headphones are better.

Practice mode: hold a key (on screen, or the home row `A`-`;` and `W E T Y U O P` above it,
DAW "musical typing" style) and the note plays until you let go. Sing it back within 50 cents
for 0.8 s to score a match, reported in cents flat or sharp. `Z` / `X` shift the octave; it
starts on the C below your last comfortable range. A "Headphones on" box keeps the mic
listening while the note plays. An input line shows level in dBFS against the -40 dBFS gate
and detector clarity, so two devices can test each other: hold notes on one, watch the other.

"Brighter low notes" (on by default, saved in the browser) gives reference tones below E3
(165 Hz) harmonics up to about 1 kHz (`toneHarmonics` in `audio.js`), with Schroeder phases
so the peak-normalized wave stays loud. Laptop and phone speakers play little below
200-300 Hz; on a laptop's own speaker-to-mic path this raised A1 (55 Hz) from -48 to
-28 dBFS and took detection from 0 to 16 of 16 frames. Turn it off for headphones or
full-range speakers if you prefer the plain tone.

Song practice: pick a built-in melody, type one, or load a MIDI file, and sing along after a
count-in. The notes scroll past a "now" line as bars (height = pitch, length = duration) and the
voice draws over them, green when within 50 cents of the note, amber when not. Each note is
scored as it passes: on pitch / sharp / flat (octave slips are scored against the sung octave),
and on time / early / late, from when the voice arrived on its pitch (on time = within about a
third of the note, 0.12-0.25 s). The voice is cut into runs of steady pitch and each note is
matched to the nearest-pitch run that overlaps it, so a singer who is consistently early or late
is still scored on the right notes. A bracket above each note shows the beat-to-entry gap.
"Fit to my range" moves the song into the latest comfortable range; speed goes down to half.
Timing is corrected for the detector's own delay (a change of note shows about 75 ms later at
4096 samples, measured on synthetic voices, plus half the ~50 ms between detections) and the
output and input latency the browser reports. What's left (speaker and mic delays the browser
doesn't report) starts at an estimated +90 ms, from a laptop and a phone with built-in speakers
and mics, and is measured per device by "Measure it": the
app plays a 16-note legato melody out loud (legato because the detector catches a change of
note later than a note after silence, and songs are mostly changes), scores itself through the
mic, and stores the median entry offset as the timing adjustment. Bluetooth headphones can't be measured that way (the mic
can't hear them), so Earlier / Later nudge it by hand. The melody can play along (needs
headphones, since the mic would hear it). "Copy for any AI app" copies the take note by note
(`song-take/v1`, prompt in `report.js`).

The address keeps the screen after "#", so a refresh, bookmark, or link to another device comes
back to it: `#song=twinkle-twinkle-little-star&shift=-19&speed=0.75` (built-in songs by name; a
typed or MIDI melody is deflate-compressed into `&melody=`), `#practice`, or
`#results=<test date>`. A linked song doesn't ask for the mic until Sing it. The range test
itself always starts from the beginning.

Songs can have several parts and verses. The parts follow the voicing the Church site gives each
song: SATB (Soprano, Alto, Tenor, Bass), men's choir TTBB / TTB (Tenor 1, Tenor 2, Baritone,
Bass; tenors written in treble clef sound an octave lower), women's choir SSA / SA, and
Two-Part. Unison songs and the Children's Songbook become a Melody (the top line of the staff
with the words), a Descant if another staff has words, and Piano or Instrument parts that play
along but aren't offered to sing. Without a voicing, two staves (treble then bass) are SATB. A part with words of its own (a bass line with different words, men answering the women)
keeps them; other parts sing the melody's words. "My part" picks the part
that is scored and drawn as bars (the others are drawn faint); "Words" picks the verse. While
singing, the app plays the other parts by default ("Everyone but me": the other voices around
you and a gap for yours, as in a choir, and your own notes can't reach the mic and be scored as
you); "All parts", "Only my part", and "Nothing" are the other choices. A part without words of
its own sings the words of the part that has them, on the notes that start together. The key is
shown by name when known (`key:` line, a MIDI key signature, or the hymn's), as "Written in D,
moved 2 steps lower to C".

Keeping the key: a hymn practiced in another key would clash with the congregation, so hymns
(`transpose: octaves`, set by the hymn import) move only by a whole octave, at most one either
way (the same key; men often sing a melody an octave lower). "Lower / Higher" become "Octave
down / up", and "Fit to my range" picks the octave. "Keep the written key" can be turned off for
solo practice; the card then says "Not the hymnbook key: the congregation sings in D." When
another part fits the singer's range better as written, the card suggests it instead.

Hymns from churchofjesuschrist.org: the arrangements are copyright Intellectual Reserve, Inc.
and may be copied for incidental, noncommercial Church or home use, and the site serves its
files only to its own pages, so this app never fetches or stores them. Instead, a "Send to
Sing" bookmark (made on the song card, for whichever address serves the app) runs on a song's
page, reads the page's data and the score its Interactive Sheet Music view plays (MusicXML as
JSON), plus the song's voicing from its book's filter list,
keeps only pitches, lengths, voices, words, key, and tempo, and opens the app with that packed
into `#import=`. `hymn.js` splits the treble and bass staves into four parts (chords in a
staff's upper voice are two parts moving together; a lone upper note over silence is both in
unison). The site's format is undocumented: if it changes, the extraction in `hymn.js`
(`EXTRACT`) needs updating.

Library: collections of songs (each songbook, songs sent with the bookmark, your own, and choir
sets), kept in the browser (IndexedDB) and searchable by collection name, number, title, and
words, with a mark for how much of your part fits your range. A choir director adds songs to a
set (with a note for everyone and one per song) and saves it as a file to email or text, or puts
it on Dropbox, GitHub, or a website; members open the file or its web address. Library files,
set files, and collected-songs files share one format (`sing-library/v1`, see `library.js`).
Google Drive links can't be opened: Drive doesn't let other web apps read its files.

Fit marks and order: with a comfortable range set and nothing typed, the library lists best fits
first. "Fit for: my part" measures your part as written (the share of its notes in your range);
"Fit for: the melody" shows how many steps the tune, in the octave you'd sing it, must move from
the hymnbook key to fit your range (0: you can sing it with the congregation), closest first.
"Most sung" filters (top 10, 25, 50) use SingPraises.net's survey of 16,491 sacrament meetings
(2017, Hymns 1985; `popularity.js`), and each of those songs shows its rank.

Collecting songbooks (home use): on any other page of churchofjesuschrist.org the same "Sing"
bookmark opens a panel that reads Hymns for Home and Church, Hymns (1985), and the Children's
Songbook. Each book's song list gives numbers, dates, sections, topics, and people; its filter
lists (one request per value, about a minute per book) give each song's voicing, difficulty,
choir, category, and instruments, which become library filters. Songs are read one every
couple of seconds, skipping songs already in a library file you pick unless the site's date for
them changed; the songs you have can get their details refreshed in the same pass. Each song
keeps its source link and credits, and the data it was collected with (about 3 KB compressed):
when the reading rules change (`READER` in `hymn.js`), the app rebuilds stored songs from it,
reusing verses AI already fitted, without collecting again.
Verses printed below the music (the page lists every verse's words; the score has only some)
are fitted to the notes by AI through the local bridge (`fit-verse` task, prompt in
`report.js`); every answer must have one syllable per note and exactly the verse's words, or the
verse is kept as words only. Refrains are found by the chorus's words and sung by every verse.
Library files stay on your device; they are not part of this project.

Text melody format (also what MIDI files are converted to, so they can be edited):

```
title: Twinkle, Twinkle, Little Star
tempo: 100
time: 4/4
notes: C4 C4 G4 G4 | A4 A4 G4:2
words: Twin- kle twin- kle lit- tle star,
```

Several parts and verses: start each part with `part: Bass`, and number later verses
`words 2:`, `words 3:`. A `key: D` line names the written key, and `transpose: octaves`
keeps it (moves by whole octaves only); a `time: 2/4` line between
`notes:` lines changes the time signature from there.

Notes last one beat unless given `:beats`; `r` is a rest; `_` in words holds a syllable.

Results export as JSON (`schema: voice-range/v1`). Later phases consume this file.

## AI (optional, pluggable)

**Any AI app, no setup:** the results page has "Copy for any AI app" (and "Share to an app"
on phones). It copies the results as text with a built-in coaching prompt, ready to paste
into ChatGPT, Gemini, Claude, a local model, or anything else. "Copy all tests" in the
history adds a comparison. The prompt lives in `public/js/report.js`.

**Local bridge:** for a button that answers in the page itself:

The browser never talks to a model directly. It sends `{ task, input }` to the local
bridge, which owns the prompts (`bridge/tasks.mjs`) and hands them to one provider
(`bridge/providers.mjs`):

| `AI_PROVIDER` | Backend | Settings |
|---|---|---|
| `claude` (default) | `claude -p` using your existing Claude Code login | `AI_MODEL`, `CLAUDE_BIN` |
| `ollama` | Local open-weight models via Ollama | `AI_MODEL` (default `llama3.2`), `OLLAMA_URL` |
| `openai` | Any OpenAI-compatible server: llama.cpp, LM Studio, vLLM, LocalAI, Jan | `OPENAI_BASE_URL`, `AI_MODEL`, `OPENAI_API_KEY` |

```sh
AI_PROVIDER=ollama AI_MODEL=qwen3 npm start
```

`claude -p` runs with no tools, no MCP servers, and no saved session, from an empty temp
directory, so it is a plain text-in, text-out call.

Safety: the bridge listens on 127.0.0.1 only, rejects non-localhost `Host` headers (DNS
rebinding), and only answers pages from localhost origins plus any listed in
`ALLOWED_ORIGINS`. To use the bridge from the deployed site, start it with
`ALLOWED_ORIGINS=https://your.site` and open the site once with
`?ai=http://127.0.0.1:8787` (`?ai=off` to undo). The browser may ask permission to
reach local devices.

## Roadmap

1. **Range test** (this).
2. **Song matcher:** an open database of song melody ranges, built from MIDI/MusicXML
   files or Demucs + pitch tracking, plus "sing it in this key" suggestions and a
   playlist export.
3. **Profile interview + co-writer:** the AI proposes chords, a melody kept inside the
   singer's range, and lyric drafts; the human edits. Exports ChordPro, MusicXML, and
   MIDI, with an OpenUtau guide vocal.
4. **Practice:** karaoke-style pitch and timing overlay on your own songs (started: song
   practice), recorded takes.
5. **Release:** backing tracks, stems, charts for a band.

Smaller ideas and next steps are tracked in [IDEAS.md](IDEAS.md).

## License

Copyright (C) 2026 Gavin Hollinger

This program is free software: you can redistribute it and/or modify it under the terms
of the GNU Affero General Public License as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version. See `LICENSE`.

In short: use it, change it, share it, host it. If you run a modified version for other
people, including as a website, you must offer them its source code under the same license.
Songs, lyrics, and recordings you make with the app are yours, not covered by this license.
