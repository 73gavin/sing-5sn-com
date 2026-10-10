# sing-5sn-com: voice range test + songwriting aid

Open source (AGPL-3.0-or-later) web app for beginner singers, live at https://sing.5sn.com
(repo 73gavin/sing-5sn-com, Cloudflare Pages, output `public/`, auto-deploys on push to `main`).
`README.md` has run commands, file roles, test flow, AI provider table, and roadmap.

## Never
- Commit or push unless asked: every push to `main` deploys to the live site.
- Add a build step or npm package to `public/`: it deploys as-is to Cloudflare Pages
  (static, ES modules, no dependencies).
- Put prompt text in the browser. Wording lives in `public/js/report.js`, shared by
  "Copy for AI" and the local bridge (`bridge/tasks.mjs`, backends in
  `bridge/providers.mjs`); the browser sends the bridge `{ task, input }` only.
- Change the results JSON (`schema: voice-range/v1`) incompatibly without bumping the
  version: later phases consume it.
- Add or recommend freemium or closed-source tools: the project is open source only
  (AGPL so forks can't become closed apps).

## Product direction
- Goal: help humans write songs they can perform live. Output symbolic music (lead
  sheet, MIDI, ChordPro), not AI audio.
- The "Copy for any AI app" button is the primary AI route; the bridge is secondary.
- UI copy assumes no music theory: pair note names with Hz and explain music terms
  plainly (beginner singers are the audience).

## Test
`npm test` must pass after touching `public/js/pitch.js` or `notes.js`.
