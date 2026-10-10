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
4. **Practice:** karaoke-style pitch overlay on your own songs, recorded takes.
5. **Release:** backing tracks, stems, charts for a band.

## License

Copyright (C) 2026 Gavin Hollinger

This program is free software: you can redistribute it and/or modify it under the terms
of the GNU Affero General Public License as published by the Free Software Foundation,
either version 3 of the License, or (at your option) any later version. See `LICENSE`.

In short: use it, change it, share it, host it. If you run a modified version for other
people, including as a website, you must offer them its source code under the same license.
Songs, lyrics, and recordings you make with the app are yours, not covered by this license.
