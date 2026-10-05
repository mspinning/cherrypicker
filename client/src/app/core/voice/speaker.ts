import { Injectable } from '@angular/core';

/** Voices that sound best where several German ones are installed (macOS, iOS, Windows, Android) */
const PREFERRED = [/premium|enhanced|erweitert|natural/i, /^(anna|petra|markus|viktor|yannick)\b/i, /katja|conrad|hedda/i];

/**
 * Reads the assistant's answers out with the device's own voice (Web Speech
 * API). No model and no server involved: Ollama has no text-to-speech, and
 * the voices on phones and Macs are good and instant.
 */
@Injectable({ providedIn: 'root' })
export class Speaker {
  readonly supported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';

  /** Chrome drops utterances nobody holds on to before they end */
  private current?: SpeechSynthesisUtterance;
  private done?: () => void;

  constructor() {
    // Chrome loads its voices asynchronously; asking early has them ready for the first sentence
    if (this.supported) speechSynthesis.getVoices();
  }

  /** iOS only lets a page speak that has spoken during a tap: call this from the tap that starts the call. */
  unlock(): void {
    if (!this.supported) return;
    const silent = new SpeechSynthesisUtterance(' ');
    silent.volume = 0;
    speechSynthesis.speak(silent);
  }

  /** Resolves when the sentence was spoken or `stop` cut it off. */
  say(text: string): Promise<void> {
    this.stop();
    if (!this.supported || !text.trim()) return Promise.resolve();

    return new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = germanVoice();
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang ?? 'de-DE';
      utterance.rate = 1.05;

      // Some browsers never report the end; nobody should wait for a silent phone
      const timeout = setTimeout(() => finish(), 4000 + text.length * 110);
      const finish = () => {
        clearTimeout(timeout);
        if (this.current !== utterance) return;
        this.current = undefined;
        this.done = undefined;
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      this.current = utterance;
      this.done = finish;
      speechSynthesis.speak(utterance);
    });
  }

  stop(): void {
    if (!this.supported) return;
    // Safari swallows the next sentence after a cancel with nothing to cancel
    if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
    this.done?.();
  }
}

/** A German voice that runs on the device; network voices come last, they send the text to their vendor. */
function germanVoice(): SpeechSynthesisVoice | undefined {
  const german = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('de'));
  const rank = (voice: SpeechSynthesisVoice) => {
    const preferred = PREFERRED.findIndex((pattern) => pattern.test(voice.name));
    return (voice.localService ? 0 : 100) + (preferred < 0 ? PREFERRED.length : preferred) * 10 + (voice.lang.toLowerCase().endsWith('de') ? 0 : 1);
  };
  return german.sort((a, b) => rank(a) - rank(b))[0];
}
