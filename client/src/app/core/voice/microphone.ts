import { Injectable, signal } from '@angular/core';
import { encodeWav } from './wav';

/** What the transcription model takes */
const SAMPLE_RATE = 16_000;
/** Kept from before somebody starts to speak, so the first syllable is not cut off */
const PRE_ROLL_MS = 400;
/** This much voice in a row counts as speech, less is a click or a cough */
const START_MS = 130;
/** A pause this long ends the utterance */
const END_SILENCE_MS = 1300;
/** Silence kept at the end of a recording */
const TAIL_MS = 300;
const MIN_SPEECH_MS = 300;
/** Somebody who talks without a pause is sent in pieces */
const MAX_UTTERANCE_MS = 90_000;
/** Loudness (RMS, 0–1) below which nothing counts as voice, however quiet the room */
const MIN_THRESHOLD = 0.012;
const LEVEL_INTERVAL_MS = 60;

/** Runs in the audio thread and hands the microphone signal over in blocks of 2048 samples. */
const TAP_PROCESSOR = `
class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2048);
    this.filled = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      this.block[this.filled++] = input[i];
      if (this.filled === this.block.length) {
        this.port.postMessage(this.block.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
`;

export type MicrophoneProblem =
  /** The user or the browser said no */
  | 'denied'
  /** No microphone, or the page is not served over HTTPS / localhost */
  | 'unavailable';

/**
 * The microphone during a voice call. Listens without a button: it notices
 * when somebody starts and stops speaking and hands every utterance over as a
 * WAV recording (16 kHz mono). Nothing is recorded while it is paused.
 */
@Injectable({ providedIn: 'root' })
export class Microphone {
  /** 0–1, how loud it is right now; drives the animation on the call screen */
  readonly level = signal(0);
  /** Somebody is speaking */
  readonly hearing = signal(false);

  private stream?: MediaStream;
  private context?: AudioContext;
  private onUtterance?: (recording: Blob) => void;
  private listening = false;

  // Resampling to 16 kHz
  private ratio = 1;
  private carry = new Float32Array(0);

  // Speech detection
  private noise = 0.004;
  private preRoll: Int16Array[] = [];
  private preRollMs = 0;
  private utterance: Int16Array[] = [];
  private utteranceMs = 0;
  private voicedMs = 0;
  private runMs = 0;
  private silenceMs = 0;
  private levelAt = 0;

  /** Asks for the microphone. Call it from the tap that starts the call. */
  async open(): Promise<MicrophoneProblem | null> {
    if (this.stream) return null;
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) return 'unavailable';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      return (err as DOMException).name === 'NotAllowedError' || (err as DOMException).name === 'SecurityError' ? 'denied' : 'unavailable';
    }

    try {
      const context = await this.connect(this.stream);
      this.context = context;
      this.ratio = context.sampleRate / SAMPLE_RATE;
      return null;
    } catch {
      this.close();
      return 'unavailable';
    }
  }

  /** From now on every utterance goes to `onUtterance`. */
  listen(onUtterance: (recording: Blob) => void): void {
    this.onUtterance = onUtterance;
    this.reset();
    this.listening = true;
    void this.context?.resume();
  }

  /** Stops listening and drops what was heard so far (while the assistant thinks or talks). */
  pause(): void {
    this.listening = false;
    this.reset();
  }

  /** Ends the utterance now instead of waiting for a pause. false if nobody has said anything yet. */
  finishNow(): boolean {
    if (!this.listening || this.voicedMs < MIN_SPEECH_MS) return false;
    this.emit();
    return true;
  }

  close(): void {
    this.pause();
    this.onUtterance = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    void this.context?.close();
    this.context = undefined;
  }

  /** A context at 16 kHz lets the browser resample; where it refuses (Firefox), `feed` does it. */
  private async connect(stream: MediaStream): Promise<AudioContext> {
    let lastError: unknown;
    for (const options of [{ sampleRate: SAMPLE_RATE }, {}] as AudioContextOptions[]) {
      const context = new AudioContext(options);
      try {
        const url = URL.createObjectURL(new Blob([TAP_PROCESSOR], { type: 'application/javascript' }));
        await context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
        const tap = new AudioWorkletNode(context, 'pcm-tap', { numberOfOutputs: 1 });
        tap.port.onmessage = (event: MessageEvent<Float32Array>) => this.feed(event.data);
        // Nodes are only processed on the way to an output; the gain keeps the microphone off the speakers
        const mute = new GainNode(context, { gain: 0 });
        context.createMediaStreamSource(stream).connect(tap).connect(mute).connect(context.destination);
        return context;
      } catch (err) {
        lastError = err;
        void context.close();
      }
    }
    throw lastError;
  }

  /** One block from the audio thread, at the context's sample rate. */
  private feed(block: Float32Array): void {
    if (!this.listening) {
      if (this.level()) this.level.set(0);
      return;
    }
    const samples = this.resample(block);
    if (!samples.length) return;

    let energy = 0;
    const pcm = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
      const sample = Math.max(-1, Math.min(1, samples[i]));
      energy += sample * sample;
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const loudness = Math.sqrt(energy / samples.length);
    const ms = (samples.length / SAMPLE_RATE) * 1000;
    const voiced = loudness > Math.max(MIN_THRESHOLD, this.noise * 3);
    this.showLevel(loudness);

    if (!this.hearing()) {
      // The room's own noise, measured while nobody speaks
      if (!voiced) this.noise = Math.min(0.05, this.noise * 0.95 + loudness * 0.05);
      this.preRoll.push(pcm);
      this.preRollMs += ms;
      while (this.preRollMs - (this.preRoll[0].length / SAMPLE_RATE) * 1000 > PRE_ROLL_MS) {
        this.preRollMs -= (this.preRoll.shift()!.length / SAMPLE_RATE) * 1000;
      }
      this.runMs = voiced ? this.runMs + ms : 0;
      if (this.runMs >= START_MS) {
        this.hearing.set(true);
        this.utterance = this.preRoll;
        this.utteranceMs = this.preRollMs;
        this.voicedMs = this.runMs;
        this.silenceMs = 0;
        this.preRoll = [];
        this.preRollMs = 0;
      }
      return;
    }

    this.utterance.push(pcm);
    this.utteranceMs += ms;
    if (voiced) {
      this.voicedMs += ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += ms;
    }
    if (this.silenceMs >= END_SILENCE_MS || this.utteranceMs >= MAX_UTTERANCE_MS) this.emit();
  }

  private emit(): void {
    // Cut the pause that ended the utterance, up to a short tail
    let cut = Math.max(0, this.silenceMs - TAIL_MS);
    const chunks = [...this.utterance];
    while (chunks.length > 1 && cut >= (chunks[chunks.length - 1].length / SAMPLE_RATE) * 1000) {
      cut -= (chunks.pop()!.length / SAMPLE_RATE) * 1000;
    }
    const enough = this.voicedMs >= MIN_SPEECH_MS;
    this.reset();
    if (enough) this.onUtterance?.(encodeWav(chunks, SAMPLE_RATE));
  }

  private reset(): void {
    this.preRoll = [];
    this.preRollMs = 0;
    this.utterance = [];
    this.utteranceMs = 0;
    this.voicedMs = 0;
    this.runMs = 0;
    this.silenceMs = 0;
    this.carry = new Float32Array(0);
    this.hearing.set(false);
    this.level.set(0);
  }

  /** Averages `ratio` input samples into one: enough of a low-pass for speech. */
  private resample(block: Float32Array): Float32Array {
    if (this.ratio === 1) return block;
    const input = new Float32Array(this.carry.length + block.length);
    input.set(this.carry);
    input.set(block, this.carry.length);

    const count = Math.floor(input.length / this.ratio);
    const output = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const from = Math.floor(i * this.ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * this.ratio));
      let sum = 0;
      for (let j = from; j < to; j++) sum += input[j];
      output[i] = sum / (to - from);
    }
    this.carry = input.slice(Math.floor(count * this.ratio));
    return output;
  }

  /** Rises at once, falls slowly, and only touches the signal a few times per second. */
  private showLevel(loudness: number): void {
    const now = performance.now();
    if (now - this.levelAt < LEVEL_INTERVAL_MS) return;
    this.levelAt = now;
    const target = Math.min(1, loudness * 7);
    const current = this.level();
    this.level.set(target > current ? target : current * 0.75 + target * 0.25);
  }
}
