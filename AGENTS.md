# music: voice range test + songwriting aid

Open source (AGPL-3.0-or-later) web app for beginner singers, live at https://sing.5sn.com
(repo 73gavin/sing-5sn-com, Cloudflare Pages, output `public/`, auto-deploys on push to `main`).
`README.md` has run/test commands, file roles, the AI provider table, and the roadmap.

- Local folder is `music/` (not the repo name); workspace rules in `../AI.md` still apply.
- `public/` is static and dependency-free: no build step, no npm packages, ES modules.
  Keep it that way so it deploys as-is to Cloudflare Pages.
- AI prompt wording lives in `public/js/report.js`, shared by "Copy for AI" and the local
  bridge (`bridge/tasks.mjs`, backends in `bridge/providers.mjs`). The browser sends the
  bridge `{ task, input }`, never a prompt.
- Results JSON is a contract (`schema: voice-range/v1`); bump the version on breaking changes.
- `npm test` must pass after touching `public/js/pitch.js` or `notes.js`.
- The user is an experienced audio engineer with no music theory background:
  UI copy pairs note names with Hz and explains music terms plainly.
