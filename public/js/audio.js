// Mic input and reference tones (Web Audio).

export async function openMic() {
  // Browser voice processing (echo cancel, noise suppression, AGC) smears pitch and level.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096; // ~85 ms at 48 kHz: room for 1.7 periods of 40 Hz (E1) beyond the YIN window
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);

  return {
    ctx,
    sampleRate: ctx.sampleRate,
    read() {
      analyser.getFloatTimeDomainData(buf);
      return buf;
    },
    close() {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
    },
  };
}

// A soft organ-like tone. Harmonics let small phone speakers convey low notes they
// cannot physically reproduce (the ear fills in the missing fundamental).
// `bright` extends low notes' harmonics into the range small speakers can play; see toneHarmonics.
export function playTone(ctx, hz, seconds = 1.2, bright = false) {
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(0.25, now + 0.04);
  out.gain.setValueAtTime(0.25, now + seconds - 0.15);
  out.gain.linearRampToValueAtTime(0, now + seconds);
  out.connect(ctx.destination);

  const osc = organ(ctx, hz, out, bright);
  osc.start(now);
  osc.stop(now + seconds);
  return new Promise((resolve) => (osc.onended = resolve));
}

// The same tone, sounding until the returned release() is called, like a held piano key.
// 40 ms attack and 150 ms release, so short taps and key-ups don't click.
export function holdTone(ctx, hz, bright = false) {
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(0.25, now + 0.04);
  out.connect(ctx.destination);

  const osc = organ(ctx, hz, out, bright);
  osc.start(now);
  return function release() {
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(0, t + 0.15);
    osc.stop(t + 0.16);
  };
}

function organ(ctx, hz, out, bright) {
  const { real, imag } = toneHarmonics(hz, bright);
  const wave = ctx.createPeriodicWave(real, imag);
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = hz;
  osc.connect(out);
  return osc;
}

// Fourier coefficients (index = harmonic number) for the reference tone.
// Plain: six harmonics, so an E1 (41.2 Hz) tops out near 250 Hz, which laptop and phone
// speakers barely play. Bright: notes below about 165 Hz get harmonics up to about 1 kHz
// (at most 32), with a gentler roll-off the lower the note. Schroeder phases keep the peaks
// low; all-cosine harmonics would stack into one spike, and since Web Audio normalizes the
// wave's peak, the tone would come out quieter.
export function toneHarmonics(hz, bright = false) {
  const n = bright ? Math.max(6, Math.min(32, Math.ceil(1000 / hz))) : 6;
  const real = new Float32Array(n + 1);
  const imag = new Float32Array(n + 1);
  if (n === 6) {
    real.set([0, 1, 0.5, 0.33, 0.2, 0.12, 0.08]);
    return { real, imag };
  }
  const p = 1 - (0.4 * (n - 6)) / 26; // 1/h^p roll-off: 1/h at 7 harmonics, 1/h^0.6 at 32
  for (let h = 1; h <= n; h++) {
    const a = h ** -p;
    const phase = (Math.PI * h * h) / n;
    real[h] = a * Math.cos(phase);
    imag[h] = a * Math.sin(phase);
  }
  return { real, imag };
}
