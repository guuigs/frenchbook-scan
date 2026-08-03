/**
 * Retour sonore du poste de scan.
 *
 * Safari sur iOS n'expose pas `navigator.vibrate` : il n'y a aucun retour
 * haptique possible depuis le navigateur. Le son porte donc seul la
 * confirmation, ce qui impose deux choses : des timbres nettement distincts
 * entre succès, attention et échec, et un retour visuel plein écran assez fort
 * pour être perçu du coin de l'œil quand l'entrepôt est bruyant.
 */

type Tone = { frequency: number; duration: number; gain?: number };

const TONES: Record<"success" | "attention" | "failure", Tone[]> = {
  success: [{ frequency: 1046, duration: 0.09 }],
  attention: [
    { frequency: 784, duration: 0.1 },
    { frequency: 784, duration: 0.1 },
  ],
  failure: [{ frequency: 196, duration: 0.32, gain: 0.28 }],
};

let context: AudioContext | null = null;
let enabled = true;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/**
 * iOS interdit de produire du son sans geste utilisateur préalable. On crée et
 * on débloque le contexte audio au moment où l'opérateur démarre le scan.
 */
export function unlockAudio(): void {
  if (typeof window === "undefined") return;
  if (!context) {
    const Constructor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
    if (!Constructor) return;
    context = new Constructor();
  }
  void context.resume();
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

export function play(kind: keyof typeof TONES): void {
  if (!enabled || !context || context.state !== "running") return;

  let startAt = context.currentTime;
  for (const tone of TONES[kind]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "sine";
    oscillator.frequency.value = tone.frequency;

    // Enveloppe courte : un signal net coupé brutalement produit un clic
    // désagréable au bout de quelques centaines de scans.
    const peak = tone.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + tone.duration);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + tone.duration + 0.02);

    startAt += tone.duration + 0.05;
  }
}
