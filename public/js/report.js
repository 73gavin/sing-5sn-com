// Turns a result into plain text and an AI prompt. Shared by the page ("Copy for AI",
// "Share") and the local bridge (bridge/tasks.mjs), so every route to a model asks the
// same question with the same data.

const fmt = (n) => `${n.name} (${n.hz} Hz)`;
const cents = (n) => n.cents ?? Math.round(1200 * Math.log2(n.sungHz / n.hz));
const signed = (c) => `${c > 0 ? '+' : ''}${c}`;

// Average cents off target per direction, plus the typical (absolute) miss.
// Works on older results that predate the stored `cents` field.
export function accuracyOf(r) {
  const avg = (list) => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
  const by = (dir) => r.notes.filter((n) => n.direction === dir).map(cents);
  return { up: avg(by('up')), down: avg(by('down')), typical: avg(r.notes.map((n) => Math.abs(cents(n)))) };
}

const LIGHT = {
  used: 'used during the test',
  tried: 'tried after a coaching tip, but no notes were rated light',
  declined: 'offered but not tried',
  'not-offered': 'not reached',
};

export function resultsText(r) {
  const a = accuracyOf(r);
  const lines = [`Vocal range test, ${new Date(r.date).toLocaleString()}`];
  if (r.speaking) lines.push(`- Speaking voice (median pitch while talking): ${fmt(r.speaking)}`);
  lines.push(`- Starting note for the test: ${fmt(r.home)}`);
  lines.push(r.comfortable
    ? `- Comfortable range (notes rated easy or OK): ${fmt(r.comfortable.low)} to ${fmt(r.comfortable.high)}, ${r.comfortable.semitones} semitones`
    : '- Comfortable range: none (starting note was not rated easy or OK)');
  lines.push(`- Full range reached: ${fmt(r.full.low)} to ${fmt(r.full.high)}, ${r.full.semitones} semitones`);
  lines.push(r.light
    ? `- Light voice (falsetto) range: ${fmt(r.light.low)} to ${fmt(r.light.high)}`
    : `- Light voice (falsetto): none recorded${r.lightVoice ? `; ${LIGHT[r.lightVoice]}` : ''}`);
  if (r.voiceTypeGuess) lines.push(`- Closest classical voice type (app's rough guess): ${r.voiceTypeGuess}`);
  const dir = (c, word) => (c == null ? null
    : Math.abs(c) < 5 ? `${word} on pitch on average (${signed(c)} cents)`
    : `${word} ${Math.abs(c)} cents ${c > 0 ? 'sharp' : 'flat'} on average`);
  lines.push(`- Pitch matching: ${[dir(a.up, 'going up'), dir(a.down, 'going down')].filter(Boolean).join(', ')}; typical miss ${a.typical} cents (100 cents = 1 semitone)`);
  lines.push(`- Each note (target, direction, how it felt, cents off target): ${r.notes.map((n) => `${n.name} ${n.direction} ${n.rating} ${signed(cents(n))}`).join('; ')}`);
  return lines.join('\n');
}

export const COACH_INSTRUCTIONS = `Act as a warm, practical vocal coach. I took a vocal range test in a free
open source app (it plays a note, I sing it back, the app measures my pitch, and I rate how it felt).
I have no music theory background. Please explain my results.

Rules:
- Always pair note names with frequencies, e.g. "A2 (110 Hz)".
- Only use facts from my results. Do not invent measurements.
- Under 400 words. Short headings, bullets, bold for key notes.
- No medical claims. If notes were strained, suggest rest and a voice professional if pain persists.

Cover:
1. What my range means: comfortable vs full range, in plain words.
2. Voice type: the closest label, stressing it is rough and does not limit what I can sing.
3. Pitch matching: what my cents numbers mean and one simple exercise to sing more in tune.
4. Light voice: if no light voice (falsetto) notes were recorded, explain what it is in everyday terms
   with familiar examples, and exactly how to find it next time.
5. Songs to try: five well-known songs whose melody usually sits inside my comfortable range in the
   original key, with artist, noting any that would need moving up or down. Say plainly that song
   keys from memory can be wrong.
6. If more than one test is included, briefly compare them.`;

export function aiPrompt(results) {
  return `${COACH_INSTRUCTIONS}\n\nMy results:\n\n${results.map(resultsText).join('\n\n')}`;
}
