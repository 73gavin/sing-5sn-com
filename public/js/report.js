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

// ---------- song practice takes ----------

// A take (schema song-take/v1) as plain text: the song, the overall numbers, and each note.
export function songTakeText(t) {
  const s = t.summary;
  const key = t.shift ? `, moved ${Math.abs(t.shift)} semitones ${t.shift > 0 ? 'up' : 'down'} from the written key` : '';
  const lines = [
    `Song practice take, ${new Date(t.date).toLocaleString()}`,
    `- Song: ${t.title}, ${Math.round(t.bpm * t.speed)} beats per minute (${Math.round(t.speed * 100)}% of written speed${key})`,
    ...(t.part ? [`- Part sung: ${t.part}${t.verse ? `, verse ${t.verse}` : ''}; playing while I sang: ${t.playing}`] : []),
    `- On pitch (within 50 cents): ${s.inTune} of ${s.notes} notes; ${s.sharp} sharp, ${s.flat} flat, ${s.missed} not heard${s.octave ? `, ${s.octave} sung an octave away` : ''}`,
  ];
  if (s.typicalCents != null) lines.push(`- Pitch: typical miss ${s.typicalCents} cents, average ${signed(s.avgCents)} cents (100 cents = 1 semitone; negative = flat)`);
  if (s.timed) lines.push(`- Timing: ${s.onTime} of ${s.timed} timed notes started on time, ${s.early} early, ${s.late} late; average start ${signed(s.avgOnsetMs)} ms (negative = early)`);
  lines.push(`- Each note (bar, target, lyric, cents off, start in ms vs the beat): ${t.notes.map((n) => {
    const where = `bar ${n.bar} ${n.name}${n.lyric ? ` "${n.lyric}"` : ''}`;
    if (n.missed) return `${where} not heard`;
    const oct = n.octave ? ` (octave ${n.octave > 0 ? 'up' : 'down'})` : '';
    return `${where} ${signed(n.cents)}c${oct} ${n.onsetMs == null ? 'start unclear' : `${signed(n.onsetMs)}ms`}`;
  }).join('; ')}`);
  return lines.join('\n');
}

export const SONG_COACH_INSTRUCTIONS = `Act as a warm, practical vocal coach. I sang along to a song in a free open
source app. It played a count-in, listened to my voice, and measured each note: how far off pitch I was
(in cents; 100 cents = 1 semitone, within 50 counts as on pitch) and when I started it compared to the
beat (in milliseconds; on time is within about a third of the note). I have no music theory background.

Rules:
- Always pair note names with frequencies, e.g. "A3 (220 Hz)".
- Only use facts from my take. Do not invent measurements.
- Under 350 words. Short headings, bullets, bold for key points.
- The measurements can be thrown off by a noisy room or the app's own sound reaching the mic, so treat
  single odd notes with caution and focus on patterns.

Cover:
1. How the take went overall, in plain words, starting with what went well.
2. Pitch: any pattern (flat or sharp overall, worse on high or low notes, worse on leaps), and one
   simple exercise for it.
3. Timing: any pattern (early, late, rushing or dragging phrases), and one simple exercise for it.
4. The two or three spots to practice first, by bar and lyric, and how to practice them.`;

export function songPrompt(take) {
  return `${SONG_COACH_INSTRUCTIONS}\n\nMy take:\n\n${songTakeText(take)}`;
}

// ---------- fitting a verse printed below the music to the notes ----------

export const VERSE_FIT_INSTRUCTIONS = `You split hymn verses into syllables, one per melody note, so the words can be shown
under the notes. You get the first verse already split, one slot per note, and the words of
another verse sung to the same tune. Return the new verse split the same way.

Rules:
- Return only a JSON array of strings, exactly as many as the slots given. No other text.
- One slot per note, in order. Split a word across notes by syllable, ending each part of a
  split word except the last with "-" (for example "ev-", "'ry"), like the first verse.
- Use "_" for a note where the previous syllable is held (no new syllable). Put "_" where the
  new verse's words need it; it may differ from the first verse.
- Keep every word and punctuation mark of the new verse, in order, spelled as given. Do not add,
  drop, or change words.`;

// input: { template: [first verse, one slot per note], words: the new verse }
export function verseFitPrompt({ template, words }) {
  return `First verse, ${template.length} slots:\n${JSON.stringify(template)}\n\nNew verse:\n${words}\n\nReturn the new verse as a JSON array of exactly ${template.length} strings.`;
}
