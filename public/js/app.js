import { createDetector, NoteHold, PitchSmoother, speakingPitch } from './pitch.js';
import { noteInfo, midiToName, midiToFreq, freqToMidi, isBlackKey, guessVoiceType } from './notes.js';
import { openMic, playTone } from './audio.js';
import { aiStatus, aiAsk } from './ai.js';
import { accuracyOf, aiPrompt } from './report.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const label = (midi) => `${midiToName(midi)} <small>${midiToFreq(midi).toFixed(1)} Hz</small>`;
const STORE = 'voiceRange.tests';
const HOLD_MS = 800;     // how long a matched note must be held
const MATCH = 0.5;       // semitones: within 50 cents counts as the note
const LISTEN_MS = 9000;  // give up waiting for a note after this
const TRACE_MS = 8000;   // width of the pitch trace

let mic, detect, playCtx;
const guideHold = new NoteHold();
const freeHold = new NoteHold();
const free = { low: null, high: null };
const trace = [];
let muteUntil = 0;  // ignore the mic while a reference tone plays (and its room tail)
let pending = null; // the ask() currently waiting for a held note
let speech = null;  // voiced frames (MIDI) collected while the person talks
let current = null; // result on screen
let running = false;
let liveTarget = null; // note being tested, shown in the pinned readout and on the graph

// ---------- live input ----------

const smoother = new PitchSmoother();
const VIEW_SPAN = 30;  // semitones visible on the pitch graph
let lastTick = 0, clipUntil = 0, levelDb = -60, viewLo = 40, shownNote = null, inTune = false;

function tick(now) {
  requestAnimationFrame(tick);
  if (now - lastTick < 45) return; // ~22 detections per second is plenty
  lastTick = now;

  const buf = mic.read();
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const r = detect(buf);
  const hz = now < muteUntil ? null : r.hz;

  const smooth = smoother.feed(hz, now);
  showLevel(r.rms, peak, now);
  showPitch(smooth);
  // Graph the steadied pitch, but leave real gaps (breaths) as gaps.
  trace.push({ t: now, midi: hz ? smooth : null });
  while (trace.length && now - trace[0].t > TRACE_MS) trace.shift();

  const fh = freeHold.feed(hz, now);
  if (fh && fh.heldMs >= 500) {
    if (free.low == null || fh.midi < free.low) free.low = fh.midi;
    if (free.high == null || fh.midi > free.high) free.high = fh.midi;
    $('free-low').textContent = midiToName(free.low);
    $('free-high').textContent = midiToName(free.high);
  }

  if (speech && hz) speech.push(freqToMidi(hz));
  const gh = guideHold.feed(hz, now);
  if (pending && gh) {
    if (gh.heldMs >= pending.minMs && (!pending.accept || pending.accept(gh))) {
      pending.done({ hold: { ...gh, hz: midiToFreq(gh.exact) } });
    } else if (pending.target != null && gh.heldMs > 300) {
      hint(offTargetHint(gh.exact, pending.target));
    }
  }
  drawTrace(now, liveTarget);
}

function offTargetHint(sung, target) {
  const diff = sung - target;
  if (Math.abs(diff) <= MATCH) return null;
  const c = Math.round(Math.abs(diff) * 100);
  if (Math.abs(diff) < 1.5) {
    return diff > 0
      ? `Close! A little sharp (${c} cents high). Ease down toward the tone.`
      : `Close! A little flat (${c} cents low). Lift up toward the tone.`;
  }
  const steps = Math.round(Math.abs(diff));
  const dir = diff > 0 ? 'higher' : 'lower';
  if (Math.abs(steps - 12) <= 1) {
    return `You're singing ${midiToName(Math.round(sung))}, one octave ${dir} than the tone. It sounds like the "same" note, which is why it's easy to do. Try to match the tone's actual height.`;
  }
  return `You're on ${midiToName(Math.round(sung))}, ${steps} steps ${dir} than ${midiToName(target)}. Slide ${diff > 0 ? 'down' : 'up'} toward the tone.`;
}

// VU-style ballistics: instant rise, fall at about 20 dB per second.
function showLevel(rms, peak, now) {
  const db = Math.max(-60, 20 * Math.log10(rms || 1e-6));
  levelDb = Math.max(db, levelDb - 0.9);
  $('level-bar').style.width = `${Math.min(100, ((levelDb + 60) / 60) * 100)}%`;
  if (peak > 0.98) clipUntil = now + 1000;
  $('clip').hidden = now > clipUntil;
}

// The note name only changes once the pitch is clearly nearer another note, and the
// in-tune color has a dead band, so neither flickers on a held note with vibrato.
function showPitch(midi) {
  const note = $('note');
  if (midi == null) {
    note.classList.add('stale');
    $('hz').textContent = 'listening...';
    return;
  }
  note.classList.remove('stale');
  if (shownNote == null || Math.abs(midi - shownNote) > 0.65) shownNote = Math.round(midi);
  const cents = Math.max(-50, Math.min(50, Math.round((midi - shownNote) * 100)));
  note.textContent = midiToName(shownNote);
  $('hz').textContent = `${midiToFreq(midi).toFixed(1)} Hz | ${cents > 0 ? '+' : ''}${cents} cents`;
  if (Math.abs(cents) < 10) inTune = true;
  else if (Math.abs(cents) > 20) inTune = false;
  const needle = $('cents-needle');
  needle.style.left = `${50 + cents}%`;
  needle.style.background = inTune ? 'var(--comfy)' : 'var(--reach)';
}

function drawTrace(now, target) {
  const c = $('trace');
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight || 220;
  if (c.width !== Math.round(w * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = h * dpr;
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const color = (name) => css.getPropertyValue(name).trim();
  // The view stays put and only jumps to re-center when the target or the voice
  // gets within 4 semitones of an edge.
  const focus = target ?? smoother.value;
  if (focus != null && (focus < viewLo + 4 || focus > viewLo + VIEW_SPAN - 4)) viewLo = Math.round(focus - VIEW_SPAN / 2);
  const span = VIEW_SPAN;
  const lo = viewLo;
  const y = (m) => h - ((m - lo) / span) * h;

  g.font = '11px system-ui, sans-serif';
  for (let m = Math.ceil(lo); m <= lo + span; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    g.strokeStyle = color('--line');
    g.globalAlpha = isC ? 1 : isBlackKey(m) ? 0.25 : 0.55;
    g.beginPath();
    g.moveTo(0, y(m));
    g.lineTo(w, y(m));
    g.stroke();
    if (isC) {
      g.globalAlpha = 1;
      g.fillStyle = color('--muted');
      g.fillText(midiToName(m), 4, y(m) - 3);
    }
  }
  g.globalAlpha = 1;

  if (target != null) {
    g.strokeStyle = color('--accent');
    g.setLineDash([6, 4]);
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, y(target));
    g.lineTo(w, y(target));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = color('--accent');
    g.fillText(`target ${midiToName(target)}`, w - 70, y(target) - 5);
  }

  g.strokeStyle = color('--comfy');
  g.lineWidth = 3;
  g.lineJoin = 'round';
  g.beginPath();
  let drawing = false;
  for (const p of trace) {
    if (p.midi == null) {
      drawing = false;
      continue;
    }
    const x = w - ((now - p.t) / TRACE_MS) * w;
    if (drawing) g.lineTo(x, y(p.midi));
    else g.moveTo(x, y(p.midi));
    drawing = true;
  }
  g.stroke();
  g.lineWidth = 1;
}

// ---------- step UI ----------

function setStep(title, html) {
  $('step-title').textContent = title;
  $('step-body').innerHTML = html;
}

function setTarget(midi) {
  liveTarget = midi;
  $('live-target').innerHTML = midi == null ? '' : `target <b>${midiToName(midi)}</b> ${midiToFreq(midi).toFixed(1)} Hz`;
}

function hint(text) {
  $('step-hint').textContent = text || '';
}

// Wait for a held note (hold: { minMs, target?, accept? }), a button/key choice, a condition
// (`until`, polled), or a timeout. Resolves with { hold } | { choice } | { ready } | { timeout }.
function ask({ hold, choices = [], timeoutMs, until }) {
  return new Promise((resolve) => {
    const actions = $('actions');
    const keys = {};
    let timer, poll;
    const onKey = (e) => {
      const k = e.key.toLowerCase();
      if (k in keys) {
        e.preventDefault();
        done({ choice: keys[k] });
      }
    };
    const done = (value) => {
      document.removeEventListener('keydown', onKey);
      clearTimeout(timer);
      clearInterval(poll);
      pending = null;
      actions.replaceChildren();
      hint(null);
      resolve(value);
    };
    actions.replaceChildren();
    for (const c of choices) {
      const b = document.createElement('button');
      b.innerHTML = c.label + (c.key ? `<kbd>${c.key === 'enter' ? 'Enter' : c.key.toUpperCase()}</kbd>` : '');
      if (c.primary) b.className = 'primary';
      b.onclick = () => done({ choice: c.value });
      actions.append(b);
      if (c.key) keys[c.key] = c.value;
    }
    document.addEventListener('keydown', onKey);
    if (timeoutMs) timer = setTimeout(() => done({ timeout: true }), timeoutMs);
    if (until) poll = setInterval(() => until() && done({ ready: true }), 100);
    if (hold) {
      guideHold.reset();
      pending = { ...hold, done };
    }
  });
}

async function reference(midi, seconds = 1.0) {
  muteUntil = performance.now() + seconds * 1000 + 300;
  await playTone(mic.ctx, midiToFreq(midi), seconds);
  await sleep(300);
  guideHold.reset();
}

// ---------- the test ----------

async function runTest() {
  if (running) return;
  running = true;
  document.body.classList.add('testing'); // pins the readout to the top and buttons to the bottom
  try {
    await testSteps();
  } finally {
    running = false;
    setTarget(null);
    document.body.classList.remove('testing');
  }
}

async function testSteps() {
  $('results').hidden = true;
  $('step').hidden = false;
  $('live').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const { home, speaking } = await findHome();

  const notes = [];
  await walk(-1, home, notes);
  const lightVoice = await walk(+1, home, notes);
  $('step').hidden = true;
  const result = summarize(home, notes, lightVoice, speaking);
  if (result) {
    saveResult(result);
    showResult(result);
  } else {
    setStep('Not enough notes', '<p>The test needs at least one rated note. Give it another go.</p>');
    $('step').hidden = false;
    await ask({ choices: [{ label: 'Start over', value: 1, primary: true }] });
    return testSteps();
  }
}

// Step 2: measure the speaking voice from a natural phrase, then let the person nudge it.
const SPEAK_MS = 3500; // enough voiced speech for a stable median

async function findHome() {
  const title = '1. Your speaking voice';
  for (;;) {
    setStep(title, `<p>Say this out loud two or three times, in your normal talking voice, like you're
      chatting with a friend:</p>
      <p class="target">"We were away a year ago."</p>
      <p class="hint">Every sound in that sentence is voiced, so the app can follow your pitch the whole time.
      The middle of your speaking pitch is a comfortable place to start singing.</p>`);
    speech = [];
    await ask({
      until: () => speech.length * 45 >= SPEAK_MS, // ~45 ms per frame
      timeoutMs: 20000,
      choices: [{ label: "I'm done talking", value: 'done', key: 'enter' }],
    });
    const spoken = speakingPitch(speech);
    speech = null;
    if (spoken == null) {
      setStep(title, `<p>I didn't hear enough talking to measure. Things to try:</p><ul>
        <li>If the <b>input level</b> bar above didn't move at all, the mic is muted or blocked. Check the mic icon in the address bar.</li>
        <li>If the bar moved but no note name showed, speak a little louder or closer, at a normal pace.</li></ul>`);
      await ask({ choices: [{ label: 'Try again', value: 1, key: 'enter', primary: true }] });
      continue;
    }

    const speaking = Math.round(spoken);
    let home = Math.max(36, Math.min(79, speaking));
    for (;;) {
      const moved = home - speaking;
      const note = moved === 0 ? 'the middle of your speaking voice'
        : `${Math.abs(moved)} step${Math.abs(moved) > 1 ? 's' : ''} ${moved > 0 ? 'above' : 'below'} your speaking voice`;
      setStep(title, `<p>Your speaking voice centers on <b>${fmt(noteInfo(speaking))}</b>.</p>
        <p>The test will start on:</p><p class="target">${label(home)}</p>
        <p class="hint">That's ${note}. Tap <b>Hear it</b> and hum along. If it feels too low or too high,
        move it a step, then tap <b>Start here</b>.</p>`);
      const c = await ask({ choices: [
        { label: 'Start here', value: 'ok', key: 'enter', primary: true },
        { label: 'Hear it', value: 'hear', key: 'h' },
        { label: 'Lower', value: -1 },
        { label: 'Higher', value: 1 },
        { label: 'Say it again', value: 'again', key: 'r' },
      ] });
      if (c.choice === 'ok') return { home, speaking };
      if (c.choice === 'again') break;
      if (c.choice === 'hear') await reference(home, 1.2);
      else home = Math.max(36, Math.min(79, home + c.choice));
    }
  }
}

const INTRO = {
  down: `<p>I'll play a note, then you sing it back on "ahh" and hold it for about a second.
    Each note is one step lower than the last. Then you tell me how it felt.</p>
    <p>Get within 50 cents (half a step) of the tone and it counts. The hint line tells you if
    you're a little high or low.</p>
    <p>Low notes get quiet and breathy; that's fine. Growly, crackly "vocal fry" doesn't count.
    Stop when you can't make a clear note.</p>`,
  up: `<p>Same again, going up one step at a time from your starting note.</p>
    <p>Near the top your normal voice will start to feel tight. When it does, I'll show you how to
    switch to your <b>light voice</b> (falsetto), which usually goes much higher.
    Stop before anything hurts or squeaks.</p>`,
};

const LIGHT_VOICE = `<p><b>What is "light voice"?</b> Your voice has two main modes. Your everyday speaking
  voice (singers call it chest voice) is full and buzzy. Above it is a lighter mode called falsetto or
  head voice: thinner, softer, and airier.</p>
  <p>You already know it. It's the voice you use to imitate a cartoon character or a small child, a
  surprised "whoo!", an owl's "hoo hoo", or the Bee Gees singing "Stayin' Alive".</p>
  <p class="hint">In audio terms: chest voice is harmonically rich, like a sawtooth. Light voice is much
  closer to a sine wave or a flute.</p>
  <p><b>Try it now:</b> don't push harder, get quieter. Sigh "hooo" and slide it upward like a siren,
  and watch the pitch line above. Where the sound suddenly thins out (it may crack or jump a little),
  you've switched into light voice. It will sound weak, maybe silly. That's exactly right.</p>
  <p>Then we'll go back to where it got hard and sing those notes again in light voice. Rate them
  <b>Light (falsetto)</b>.</p>`;

async function walk(dir, home, notes) {
  const up = dir > 0;
  const title = up ? '3. Going up' : '2. Going down';
  setStep(title, INTRO[up ? 'up' : 'down']);
  await ask({ choices: [{ label: 'Start', value: 1, key: 'enter', primary: true }] });

  // Going up, hitting the top of the normal voice offers the light voice once (if it has
  // not shown up already), then a choice to keep going; going down still stops there.
  let strained = 0, lightOffered = false, lightMode = false, lightDeclined = false;
  const record = (n) => {
    const i = notes.findIndex((x) => x.midi === n.midi && x.direction === n.direction);
    if (i >= 0) notes.splice(i, 1);
    notes.push(n);
  };
  const lightSeen = () => notes.some((n) => n.rating === 'light');

  // Returns the note to continue from, or null to finish this direction.
  async function atTheTop(midi, reason) {
    if (!up) return null;
    if (!lightOffered && !lightSeen()) {
      lightOffered = true;
      setStep(title, LIGHT_VOICE);
      const c = await ask({ choices: [
        { label: 'Try light voice', value: 'light', key: 'enter', primary: true },
        { label: 'Finish going up', value: 'done', key: '0' },
      ] });
      if (c.choice === 'done') {
        lightDeclined = true;
        return null;
      }
      lightMode = true;
      strained = 0;
      return reason === 'cant' ? midi : midi - 1; // back to the first strained note
    }
    if (reason === 'cant') return null;
    setStep(title, `<p>Two strained notes in a row. Your voice is working hard up here.</p>
      <p>Keep going only if it doesn't hurt. Resting is fine too; your range is already recorded.</p>`);
    const c = await ask({ choices: [
      { label: 'Finish going up', value: 'done', key: 'enter', primary: true },
      { label: 'Keep going', value: 'more', key: '1' },
    ] });
    strained = 0;
    return c.choice === 'more' ? midi + 1 : null;
  }

  for (let midi = up ? home + 1 : home; midi >= 28 && midi <= 100; midi += dir) {
    const voiceTip = lightMode ? '<p class="hint">Light voice: soft and airy, like a sigh.</p>' : '';
    let res;
    for (;;) {
      setTarget(midi);
      setStep(title, `<p>Listen...</p><p class="target">${label(midi)}</p>${voiceTip}`);
      await reference(midi);
      setStep(title, `<p>Your turn: sing it back on "${lightMode ? 'ooh' : 'ahh'}" and hold it.</p><p class="target">${label(midi)}</p>${voiceTip}`);
      res = await ask({
        hold: { minMs: HOLD_MS, target: midi, accept: (h) => Math.abs(h.exact - midi) <= MATCH },
        timeoutMs: LISTEN_MS,
        choices: [{ label: 'Play again', value: 'replay', key: 'r' }, { label: "Can't reach it", value: 'cant', key: '0' }],
      });
      if (res.timeout) {
        setStep(title, `<p>I didn't catch a steady ${midiToName(midi)} within 50 cents.</p>
          <p class="hint">Listen again and match the tone's exact height. Small slides up or down help you find it.</p>`);
        res = await ask({ choices: [{ label: 'Try again', value: 'replay', key: 'r', primary: true }, { label: "Can't reach it", value: 'cant', key: '0' }] });
      }
      if (res.choice !== 'replay') break;
    }
    if (res.choice === 'cant') {
      const next = await atTheTop(midi, 'cant');
      if (next == null) break;
      midi = next - dir;
      continue;
    }

    const sung = res.hold;
    const off = Math.round((sung.exact - midi) * 100);
    const how = Math.abs(off) < 10 ? 'right on pitch' : `${Math.abs(off)} cents ${off > 0 ? 'sharp' : 'flat'}`;
    setStep(title, `<p>Got it (${how}). How did <b>${midiToName(midi)}</b> feel?</p>`);
    const rate = await ask({
      choices: [
        { label: 'Easy', value: 'easy', key: '1' },
        { label: 'OK', value: 'ok', key: '2' },
        { label: 'Strained', value: 'strained', key: '3' },
        ...(up ? [{ label: 'Light (falsetto)', value: 'light', key: '4' }] : []),
        { label: 'Redo this note', value: 'redo', key: 'r' },
      ],
    });
    if (rate.choice === 'redo') {
      midi -= dir;
      continue;
    }
    record({ ...noteInfo(midi), sungHz: Math.round(sung.hz * 10) / 10, cents: off, rating: rate.choice, direction: up ? 'up' : 'down' });
    strained = rate.choice === 'strained' ? strained + 1 : 0;
    if (strained >= 2) {
      const next = await atTheTop(midi, 'strained');
      if (next == null) break;
      midi = next - dir;
    }
  }
  setTarget(null);
  if (!up) return null;
  return lightSeen() ? 'used' : lightMode ? 'tried' : lightDeclined ? 'declined' : 'not-offered';
}

function summarize(home, notes, lightVoice, speaking) {
  if (!notes.length) return null;
  const rating = new Map(notes.map((n) => [n.midi, n.rating]));
  const comfy = (m) => ['easy', 'ok'].includes(rating.get(m));
  const all = notes.map((n) => n.midi);
  const chest = notes.filter((n) => n.rating !== 'light').map((n) => n.midi);
  const light = notes.filter((n) => n.rating === 'light').map((n) => n.midi);

  let comfortable = null;
  if (comfy(home)) {
    let lo = home, hi = home;
    while (comfy(lo - 1)) lo--;
    while (comfy(hi + 1)) hi++;
    comfortable = { low: noteInfo(lo), high: noteInfo(hi), semitones: hi - lo };
  }
  const range = (list) => list.length && { low: noteInfo(Math.min(...list)), high: noteInfo(Math.max(...list)), semitones: Math.max(...list) - Math.min(...list) };

  return {
    schema: 'voice-range/v1',
    date: new Date().toISOString(),
    home: noteInfo(home),
    speaking: speaking != null ? noteInfo(speaking) : null,
    comfortable,
    full: range(all),
    chest: range(chest) || null,
    light: range(light) || null,
    lightVoice,
    voiceTypeGuess: chest.length ? guessVoiceType(Math.min(...chest), Math.max(...chest)) : null,
    freeSinging: free.low != null ? { low: noteInfo(free.low), high: noteInfo(free.high) } : null,
    notes: notes.sort((a, b) => a.midi - b.midi),
  };
}

// ---------- results ----------

const fmt = (n) => `${n.name} (${n.hz} Hz)`;
const octaves = (st) => (st / 12).toFixed(1);

function showResult(r) {
  current = r;
  const rows = [];
  if (r.comfortable) rows.push(['Comfortable range', `<b>${fmt(r.comfortable.low)} to ${fmt(r.comfortable.high)}</b>, ${r.comfortable.semitones} semitones`]);
  rows.push(['Full range', `${fmt(r.full.low)} to ${fmt(r.full.high)}, ${r.full.semitones} semitones (${octaves(r.full.semitones)} octaves)`]);
  if (r.light) rows.push(['Light voice (falsetto)', `${fmt(r.light.low)} to ${fmt(r.light.high)}`]);
  const acc = accuracyOf(r);
  const lean = (c, word) => (c == null ? null : `${word}: ${Math.abs(c) < 10 ? 'right on' : `${Math.abs(c)} cents ${c > 0 ? 'sharp' : 'flat'}`}`);
  rows.push(['Pitch matching', `${[lean(acc.down, 'going down'), lean(acc.up, 'going up')].filter(Boolean).join(', ')}
    <span class="hint">(average; 100 cents = 1 semitone. Under 20 is very good, 20-50 is normal for beginners.)</span>`]);
  if (r.speaking) rows.push(['Speaking voice', fmt(r.speaking)]);
  rows.push(['Starting note', fmt(r.home)]);
  if (r.voiceTypeGuess) rows.push(['Closest voice type', `${r.voiceTypeGuess} <span class="hint">(rough label only)</span>`]);
  rows.push(['Tested', new Date(r.date).toLocaleString()]);

  let advice = '';
  if (r.comfortable) {
    const c = r.comfortable;
    advice = `<p>Songs whose melody stays between <b>${c.low.name}</b> and <b>${c.high.name}</b> will feel natural to you.
      A typical pop melody spans 12-18 semitones, and any song can be moved (transposed) up or down to fit.</p>`;
    if (c.semitones < 12) advice += `<p>Your comfortable span is ${c.semitones} semitones, a little narrow for most songs.
      That's normal for new singers, and it usually widens with regular practice.</p>`;
  } else {
    advice = `<p>Your starting note wasn't rated easy or OK, so there's no comfortable range yet. Try again when warmed up.</p>`;
  }
  if (!r.light) advice += `<p>No light voice (falsetto) notes yet. Most people have several more notes up there.
    Next time, when the high notes get tight, choose <b>Try light voice</b>.</p>`;

  $('summary').innerHTML = `<dl class="summary-grid">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${advice}`;
  drawKeyboard(r);
  $('ai-output').hidden = true;
  $('results').hidden = false;
  $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawKeyboard(r) {
  const rated = new Map(r.notes.map((n) => [n.midi, n.rating]));
  const cls = { easy: 'comfy', ok: 'comfy', strained: 'reach', light: 'light' };
  // Whole octaves around the tested range, at least three so keys stay readable on phones.
  let lo = r.full.low.midi - 3, hi = r.full.high.midi + 3;
  lo -= ((lo % 12) + 12) % 12;  // start on a C
  hi += 11 - (((hi % 12) + 12) % 12); // end on a B
  while (hi - lo + 1 < 36) hi += 12;

  const kb = $('keyboard');
  kb.replaceChildren();
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!isBlackKey(m)) whites.push(m);
  const ww = 100 / whites.length;

  let wi = 0;
  for (let m = lo; m <= hi; m++) {
    const key = document.createElement('div');
    const black = isBlackKey(m);
    key.className = `key ${black ? 'black' : 'white'} ${cls[rated.get(m)] || ''} ${m === r.home.midi ? 'is-home' : ''}`;
    key.title = `${midiToName(m)} ${midiToFreq(m).toFixed(1)} Hz${rated.has(m) ? ' - ' + rated.get(m) : ''}`;
    if (black) {
      key.style.left = `${wi * ww - ww * 0.3}%`;
      key.style.width = `${ww * 0.6}%`;
    } else {
      if (m % 12 === 0) key.innerHTML = `<span class="label">${midiToName(m)}</span>`;
      wi++;
    }
    kb.append(key);
  }
}

async function hearRange() {
  const r = current;
  if (!r?.comfortable) return;
  const ctx = mic?.ctx || (playCtx ||= new AudioContext());
  const seq = [r.comfortable.low.midi, r.home.midi, r.comfortable.high.midi];
  muteUntil = performance.now() + seq.length * 900 + 300;
  for (const m of seq) await playTone(ctx, midiToFreq(m), 0.8);
}

// Copy or share a ready-made prompt so results work with any AI app the person already uses.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function flash(btn, text) {
  const was = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = was), 2500);
}

async function copyForAi(btn, results) {
  await copyText(aiPrompt(results));
  flash(btn, 'Copied. Paste into any AI chat.');
}

async function shareForAi(results) {
  try {
    await navigator.share({ title: 'My vocal range results', text: aiPrompt(results) });
  } catch {
    // cancelled
  }
}

function exportResult() {
  const blob = new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `voice-range-${current.date.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------- history ----------

const loadAll = () => JSON.parse(localStorage.getItem(STORE) || '[]');

function saveResult(r) {
  const all = loadAll();
  all.unshift(r);
  localStorage.setItem(STORE, JSON.stringify(all.slice(0, 50)));
  renderHistory();
}

function renderHistory() {
  const all = loadAll();
  $('history').hidden = !all.length;
  const list = $('history-list');
  list.replaceChildren();
  all.forEach((r, i) => {
    const li = document.createElement('li');
    const c = r.comfortable ? `comfortable ${r.comfortable.low.name}-${r.comfortable.high.name}, ` : '';
    li.innerHTML = `<span>${new Date(r.date).toLocaleDateString()}: ${c}full ${r.full.low.name}-${r.full.high.name}${r.voiceTypeGuess ? ` (${r.voiceTypeGuess})` : ''}</span>`;
    const view = document.createElement('button');
    view.textContent = 'View';
    view.onclick = () => showResult(r);
    const del = document.createElement('button');
    del.textContent = 'Delete';
    del.onclick = () => {
      const next = loadAll();
      next.splice(i, 1);
      localStorage.setItem(STORE, JSON.stringify(next));
      renderHistory();
    };
    const span = document.createElement('span');
    span.append(view, ' ', del);
    li.append(span);
    list.append(li);
  });
}

// ---------- AI ----------

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// Just enough markdown for short model answers: headings, bullets, bold.
function renderMarkdown(md) {
  const html = [];
  let list = false;
  for (const raw of escapeHtml(md).split('\n')) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    const bullet = line.match(/^\s*[-*]\s+(.*)/);
    if (bullet && !list) { html.push('<ul>'); list = true; }
    if (!bullet && list) { html.push('</ul>'); list = false; }
    if (bullet) html.push(`<li>${bullet[1]}</li>`);
    else if (/^#{1,6}\s/.test(line)) html.push(`<h3>${line.replace(/^#+\s/, '')}</h3>`);
    else if (line.trim()) html.push(`<p>${line}</p>`);
  }
  if (list) html.push('</ul>');
  return html.join('');
}

async function askAi() {
  const out = $('ai-output');
  const btn = $('ask-ai');
  btn.disabled = true;
  out.hidden = false;
  out.innerHTML = '<p class="hint">Thinking... this can take 10-30 seconds.</p>';
  try {
    const { text, provider, model } = await aiAsk('explain-range', current);
    out.innerHTML = renderMarkdown(text) + `<p class="hint">Answer from ${escapeHtml(provider)}${model ? ' / ' + escapeHtml(model) : ''}. AI can be wrong, especially about which key a song is in.</p>`;
  } catch (e) {
    out.innerHTML = `<p class="error">AI request failed: ${escapeHtml(e.message)}</p>`;
  } finally {
    btn.disabled = false;
  }
}

// ---------- start ----------

async function start() {
  try {
    mic = await openMic();
  } catch (e) {
    const err = $('mic-error');
    err.hidden = false;
    err.textContent = e.name === 'NotAllowedError'
      ? 'Microphone access was blocked. Allow it from the icon in the address bar, then try again.'
      : `Could not open the microphone: ${e.message}`;
    return;
  }
  detect = createDetector({ sampleRate: mic.sampleRate });
  $('intro').hidden = true;
  $('live').hidden = false;
  requestAnimationFrame(tick);
  runTest();
}

$('start').onclick = start;
$('retest').onclick = () => (mic ? runTest() : start());
$('hear').onclick = hearRange;
$('export').onclick = exportResult;
$('ask-ai').onclick = askAi;
$('copy-ai').onclick = (e) => copyForAi(e.currentTarget, [current]);
$('copy-all').onclick = (e) => copyForAi(e.currentTarget, loadAll().slice(0, 10).reverse());
if (navigator.share) {
  $('share-ai').hidden = false;
  $('share-ai').onclick = () => shareForAi([current]);
}
renderHistory();
aiStatus().then((s) => ($('ask-ai').hidden = !s?.ok));
