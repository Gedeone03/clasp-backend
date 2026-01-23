let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) audioCtx = new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * iOS/Safari: l'audio in pagina viene permesso solo dopo un gesto utente.
 * Chiama questa funzione (es. su pointerdown) per sbloccare l'audio.
 */
export async function unlockAudio(): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // ignore
    }
  }

  // “ping” quasi inaudibile per sbloccare la pipeline audio
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.01);
  } catch {
    // ignore
  }
}

export async function playNotificationBeep(): Promise<void> {
  const ctx = getCtx();
  if (!ctx) return;

  try {
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
  } catch {
    // ignore
  }

  // beep breve
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.value = 880; // A5
  gain.gain.value = 0.12;

  osc.connect(gain);
  gain.connect(ctx.destination);

  const now = ctx.currentTime;
  osc.start(now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
  osc.stop(now + 0.13);
}
