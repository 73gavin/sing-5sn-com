// AI tasks. The browser names a task and sends data; prompts are built here, server side,
// so the page cannot send arbitrary prompts. The wording itself lives in
// public/js/report.js, shared with the page's "Copy for AI" button.
// Each task: { system, prompt(input) -> string } and throws on bad input.

import { COACH_INSTRUCTIONS, resultsText } from '../public/js/report.js';

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
};
