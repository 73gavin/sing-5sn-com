// Mic input and reference tones (Web Audio).

export async function openMic() {
  // Browser voice processing (echo cancel, noise suppression, AGC) smears pitch and level.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096; // ~85 ms at 48 kHz: two periods of the lowest note we track
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
export function playTone(ctx, hz, seconds = 1.2) {
  const now = ctx.currentTime;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(0.25, now + 0.04);
  out.gain.setValueAtTime(0.25, now + seconds - 0.15);
  out.gain.linearRampToValueAtTime(0, now + seconds);
  out.connect(ctx.destination);

  const real = new Float32Array([0, 1, 0.5, 0.33, 0.2, 0.12, 0.08]);
  const wave = ctx.createPeriodicWave(real, new Float32Array(real.length));
  const osc = ctx.createOscillator();
  osc.setPeriodicWave(wave);
  osc.frequency.value = hz;
  osc.connect(out);
  osc.start(now);
  osc.stop(now + seconds);
  return new Promise((resolve) => (osc.onended = resolve));
}
