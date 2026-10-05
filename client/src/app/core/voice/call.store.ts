import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Subscription, firstValueFrom } from 'rxjs';
import { API_URL, AuthService } from '../auth/auth.service';
import { Microphone, MicrophoneProblem } from './microphone';
import { Speaker } from './speaker';
import { VoiceApi } from './voice-api.service';
import { CallResult, VoiceEvent } from './voice.models';

export type CallPhase =
  /** No call */
  | 'idle'
  | 'connecting'
  /** Waiting for the user to speak, or hearing them */
  | 'listening'
  /** The recording is with the server */
  | 'thinking'
  /** The assistant's answer is read out */
  | 'speaking'
  /** Hung up; the assistant writes customers and tasks */
  | 'wrapping'
  /** What the call left behind */
  | 'summary'
  /** The call never started */
  | 'failed';

export interface CallLine {
  who: 'user' | 'cherry';
  text: string;
}

const MIC_PROBLEMS: Record<MicrophoneProblem, string> = {
  denied: 'Kein Zugriff aufs Mikrofon. Gib es im Browser frei oder tippe einfach.',
  unavailable: 'Das Mikrofon gibt es nur über HTTPS oder localhost. Tippe einfach.',
};

/**
 * A voice call with the assistant "Cherry": the user tells what happened with
 * a customer, the assistant answers, and after hanging up it writes customers
 * and tasks. One call at a time; the call screen shows this state.
 */
@Injectable({ providedIn: 'root' })
export class CallStore {
  private readonly api = inject(VoiceApi);
  private readonly auth = inject(AuthService);
  private readonly mic = inject(Microphone);
  private readonly speaker = inject(Speaker);

  /** The server has the models for calls; the call button shows only then */
  readonly available = signal(false);

  readonly phase = signal<CallPhase>('idle');
  /** What was said, oldest first */
  readonly lines = signal<CallLine[]>([]);
  /** What the assistant is doing while the user waits */
  readonly step = signal('');
  /** Everything it did after hanging up */
  readonly steps = signal<string[]>([]);
  readonly seconds = signal(0);
  readonly micOn = signal(true);
  readonly speakerOn = signal(true);
  /** Why the user has to type; null if the microphone works */
  readonly micProblem = signal<string | null>(null);
  readonly typing = signal(false);
  readonly result = signal<CallResult | null>(null);
  readonly error = signal<string | null>(null);
  /** Counts calls that created tasks, so "Heute" knows when to reload */
  readonly tasksCreated = signal(0);

  readonly level = this.mic.level;
  readonly hearing = this.mic.hearing;
  readonly open = computed(() => this.phase() !== 'idle');
  /** The user and the assistant are talking */
  readonly live = computed(() => ['listening', 'thinking', 'speaking'].includes(this.phase()));
  readonly canSpeak = this.speaker.supported;

  private callId: string | null = null;
  private turn?: Subscription;
  private timer?: ReturnType<typeof setInterval>;
  private wakeLock?: { release(): Promise<void> };
  /** Changes with every call, so answers of an old one are ignored */
  private generation = 0;

  constructor() {
    effect(() => {
      // A call belongs to the signed-in user and never outlives the session
      if (!this.auth.session()) untracked(() => this.reset());
    });
    // Closing the tab is hanging up: the server still turns what was said into tasks
    window.addEventListener('pagehide', () => this.hangUpForGood());
  }

  /** Asks the server once whether calls are set up. */
  checkAvailability(): void {
    this.api.status().subscribe({
      next: (status) => this.available.set(status.available),
      error: () => this.available.set(false),
    });
  }

  /** Call this directly from the tap: browsers only hand out microphone and voice during one. */
  async start(): Promise<void> {
    if (this.open()) return;
    this.reset();
    const generation = this.generation;
    this.phase.set('connecting');
    this.speaker.unlock();

    const microphone = this.mic.open();
    let greeting: string;
    try {
      const call = await firstValueFrom(this.api.start(Intl.DateTimeFormat().resolvedOptions().timeZone));
      if (generation !== this.generation) return;
      this.callId = call.id;
      greeting = call.greeting;
    } catch (err) {
      if (generation !== this.generation) return;
      // The permission prompt may still be open
      void microphone.finally(() => this.mic.close());
      this.error.set(messageOf(err, 'Cherry ist gerade nicht erreichbar.'));
      this.phase.set('failed');
      return;
    }

    const problem = await microphone;
    if (generation !== this.generation) return this.mic.close();
    if (problem) {
      this.micProblem.set(MIC_PROBLEMS[problem]);
      this.micOn.set(false);
      this.typing.set(true);
    }

    this.timer = setInterval(() => this.seconds.update((s) => s + 1), 1000);
    void this.keepAwake();
    this.lines.set([{ who: 'cherry', text: greeting }]);
    if (await this.say(greeting)) this.listen();
  }

  /** Ends the utterance now instead of waiting for a pause, or cuts the assistant off. */
  tapOrb(): void {
    if (this.phase() === 'speaking') {
      this.speaker.stop();
    } else if (this.phase() === 'listening') {
      this.mic.finishNow();
    }
  }

  toggleMic(): void {
    if (this.micProblem()) return;
    this.micOn.update((on) => !on);
    if (this.phase() === 'listening') this.listen();
  }

  toggleSpeaker(): void {
    this.speakerOn.update((on) => !on);
    if (!this.speakerOn()) this.speaker.stop();
  }

  toggleTyping(): void {
    this.typing.update((on) => !on);
  }

  /** What the user typed instead of saying it. */
  sendText(text: string): void {
    const said = text.trim();
    if (!said || !['listening', 'speaking'].includes(this.phase())) return;
    this.speaker.stop();
    this.lines.update((lines) => [...lines, { who: 'user', text: said }]);
    this.send(said);
  }

  /** Ends the call; with something said, the assistant now writes customers and tasks. */
  hangUp(): void {
    if (!this.live() && this.phase() !== 'connecting') return;
    const id = this.callId;
    const talked = this.lines().some((line) => line.who === 'user');
    this.endConversation();

    if (!id || !talked) {
      // Nothing to work on; the server just closes the call
      if (id) this.api.finish(id).subscribe({ error: () => {} });
      this.reset();
      return;
    }

    const generation = this.generation;
    this.phase.set('wrapping');
    this.turn = this.api.finish(id).subscribe({
      next: (event) => {
        if (event.type === 'step') {
          if (generation === this.generation) this.steps.update((steps) => [...steps, event.label]);
        } else if (event.type === 'error') {
          if (generation === this.generation) this.error.set(event.message);
        } else if (event.type === 'result') {
          if (event.result.tasks.length) this.tasksCreated.update((n) => n + 1);
          if (generation !== this.generation) return;
          this.result.set(event.result);
          this.phase.set('summary');
        }
      },
      error: (err: unknown) => {
        if (generation !== this.generation) return;
        this.error.set(messageOf(err, 'Der Anruf konnte nicht verarbeitet werden.'));
        this.phase.set('summary');
      },
    });
  }

  /** Closes the call screen. A wrap-up still running goes on in the background. */
  close(): void {
    if (this.live() || this.phase() === 'connecting') return this.hangUp();
    // Not unsubscribed: its result still tells "Heute" about new tasks
    if (this.phase() === 'wrapping') this.turn = undefined;
    this.reset();
  }

  /** The page goes away mid-call; `keepalive` lets the request outlive it. */
  private hangUpForGood(): void {
    const token = this.auth.session()?.accessToken;
    if (!this.callId || !this.live() || !token) return;
    void fetch(`${API_URL}/voice/calls/${this.callId}/finish`, {
      method: 'POST',
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    }).catch(() => {});
  }

  // ---- Conversation ----

  private listen(): void {
    this.phase.set('listening');
    this.step.set('');
    if (this.micOn()) this.mic.listen((recording) => this.send(recording));
    else this.mic.pause();
  }

  private send(input: Blob | string): void {
    const id = this.callId;
    if (!id) return;
    const generation = this.generation;
    this.mic.pause();
    this.phase.set('thinking');
    this.step.set('');

    let answered = false;
    this.turn?.unsubscribe();
    this.turn = this.api.say(id, input).subscribe({
      next: (event) => {
        if (generation !== this.generation) return;
        answered ||= event.type === 'reply' || event.type === 'silence' || event.type === 'error';
        this.handle(event, typeof input === 'string');
      },
      error: (err: unknown) => {
        if (generation === this.generation) this.misheard(messageOf(err, 'Das ist nicht angekommen.'));
      },
      complete: () => {
        if (generation === this.generation && !answered) this.listen();
      },
    });
  }

  private handle(event: VoiceEvent, typed: boolean): void {
    switch (event.type) {
      case 'heard':
        if (!typed) this.lines.update((lines) => [...lines, { who: 'user', text: event.text }]);
        break;
      case 'step':
        this.step.set(event.label);
        break;
      case 'silence':
        this.listen();
        break;
      case 'reply':
        this.lines.update((lines) => [...lines, { who: 'cherry', text: event.text }]);
        void this.say(event.text).then((stillThere) => {
          if (!stillThere) return;
          if (event.hangup) this.hangUp();
          else this.listen();
        });
        break;
      case 'error':
        this.misheard(event.message);
        break;
    }
  }

  /** Reads the answer out. false if the call ended or moved on in the meantime. */
  private async say(text: string): Promise<boolean> {
    const generation = this.generation;
    this.phase.set('speaking');
    this.step.set('');
    this.mic.pause();
    if (this.speakerOn()) await this.speaker.say(text);
    return generation === this.generation && this.phase() === 'speaking';
  }

  /** The turn failed: say so on screen and keep the call going. */
  private misheard(reason: string): void {
    this.lines.update((lines) => [...lines, { who: 'cherry', text: `${reason} Sag es bitte noch einmal.` }]);
    this.listen();
  }

  // ---- Helpers ----

  /** Microphone, voice and timer off; what was said stays on screen. */
  private endConversation(): void {
    this.turn?.unsubscribe();
    this.turn = undefined;
    this.speaker.stop();
    this.mic.close();
    clearInterval(this.timer);
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = undefined;
    this.typing.set(false);
    this.step.set('');
  }

  private reset(): void {
    this.generation++;
    this.endConversation();
    this.callId = null;
    this.phase.set('idle');
    this.lines.set([]);
    this.steps.set([]);
    this.seconds.set(0);
    this.micOn.set(true);
    this.micProblem.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  /** Phones must not lock the screen in the middle of a sentence. */
  private async keepAwake(): Promise<void> {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
    try {
      this.wakeLock = await wakeLock?.request('screen');
    } catch {
      // Battery saver or an old browser: the call works without
    }
  }
}

/** The stream answers with text, so server errors arrive as unparsed JSON. */
function messageOf(err: unknown, fallback: string): string {
  if (!(err instanceof HttpErrorResponse)) return fallback;
  if (err.status === 0) return 'Keine Verbindung zum Server.';
  let body: unknown = err.error;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return fallback;
    }
  }
  const message = (body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && (err.status < 500 || err.status === 503) ? message : fallback;
}
