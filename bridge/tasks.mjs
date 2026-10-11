// AI tasks. The browser names a task and sends data; prompts are built here, server side,
// so the page cannot send arbitrary prompts. The wording itself lives in
// public/js/report.js, shared with the page's "Copy for AI" button.
// Each task: { system, prompt(input) -> string } and throws on bad input.

import { COACH_INSTRUCTIONS, resultsText, VERSE_FIT_INSTRUCTIONS, verseFitPrompt } from '../public/js/report.js';

const isResult = (r) => r && r.schema === 'voice-range/v1' && Array.isArray(r.notes);

export const tasks = {
  'explain-range': {
    system: COACH_INSTRUCTIONS,
    prompt(input) {
      const list = Array.isArray(input) ? input : [input];
      if (!list.length || list.length > 20 || !list.every(isResult)) throw new Error('expected voice-range/v1 results');
      return `My results:\n\n${list.map(resultsText).join('\n\n')}`;
    },
  },
  // Splits a verse printed below the music into one syllable per melody note. The page checks
  // the answer (same number of notes, same words) before using it.
  'fit-verse': {
    system: VERSE_FIT_INSTRUCTIONS,
    prompt(input) {
      const { template, words } = input || {};
      if (!Array.isArray(template) || !template.length || template.length > 600 || !template.every((x) => typeof x === 'string' && x.length < 40)) {
        throw new Error('expected template: a list of syllables');
      }
      if (typeof words !== 'string' || !words.trim() || words.length > 3000) throw new Error('expected words: the verse');
      return verseFitPrompt({ template, words });
    },
  },
};
