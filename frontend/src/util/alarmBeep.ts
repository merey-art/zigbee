declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export async function playEmergencyBeep(): Promise<void> {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return;

  const ctx = new AudioContextCtor();
  if (ctx.state === "suspended") {
    await ctx.resume();
  }

  const beep = (start: number) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(880, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.8, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.3);
  };

  const now = ctx.currentTime;
  beep(now);
  beep(now + 0.45);
  beep(now + 0.9);
  beep(now + 1.35);

  window.setTimeout(() => {
    void ctx.close().catch(() => undefined);
  }, 2200);
}
