import { Injectable, signal } from '@angular/core';
import { LinkedInStep } from './linkedin.models';

/** Must match CHANNEL in chrome-extension/bridge.js */
const CHANNEL = 'cherrypick-linkedin';
const HELLO_TIMEOUT_MS = 800;
// Loading LinkedIn (30 s) plus waiting for the list (20 s) in the extension, with some slack
const CHECK_TIMEOUT_MS = 90_000;
const FOCUS_TIMEOUT_MS = 5_000;

type Reply =
  | { kind: 'progress'; step: LinkedInStep }
  | { kind: 'result'; result: unknown }
  | { kind: 'error'; code: string; message?: string };

/** Error codes from the extension plus 'timeout' when it does not answer. */
export class BridgeError extends Error {
  constructor(readonly code: string) {
    super(`LinkedIn extension: ${code}`);
  }
}

/**
 * Talks to the Chrome extension through its content script on this page
 * (chrome-extension/bridge.js). Without the extension nobody answers.
 */
@Injectable({ providedIn: 'root' })
export class LinkedInBridge {
  private readonly pending = new Map<string, (reply: Reply) => void>();
  private sequence = 0;

  /** Counts the extension's announcements, i.e. it appeared on this page (installed or updated). */
  readonly announced = signal(0);

  constructor() {
    window.addEventListener('message', (event: MessageEvent) => {
      if (event.source !== window || event.origin !== location.origin) return;
      const data = event.data as { channel?: unknown; from?: unknown; id?: unknown; kind?: unknown } | null;
      if (data?.channel !== CHANNEL || data.from !== 'extension') return;
      if (data.kind === 'ready') this.announced.update((n) => n + 1);
      else if (typeof data.id === 'string') this.pending.get(data.id)?.(data as Reply);
    });
  }

  /** Version of the installed extension, null if none answers. */
  async hello(): Promise<string | null> {
    try {
      const result = (await this.request('hello', HELLO_TIMEOUT_MS)) as { version?: unknown } | null;
      return typeof result?.version === 'string' ? result.version : null;
    } catch {
      return null;
    }
  }

  /** Opens LinkedIn in the user's browser and reads the inbox; the raw result is checked by the caller. */
  check(onStep: (step: LinkedInStep) => void): Promise<unknown> {
    return this.request('check', CHECK_TIMEOUT_MS, onStep);
  }

  /** Brings a LinkedIn tab to the front (or opens one). */
  async focus(): Promise<void> {
    await this.request('focus', FOCUS_TIMEOUT_MS);
  }

  private request(type: 'hello' | 'check' | 'focus', timeoutMs: number, onStep?: (step: LinkedInStep) => void): Promise<unknown> {
    const id = `${Date.now().toString(36)}-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const finish = (settle: () => void) => {
        clearTimeout(timer);
        this.pending.delete(id);
        settle();
      };
      const timer = setTimeout(() => finish(() => reject(new BridgeError('timeout'))), timeoutMs);
      this.pending.set(id, (reply) => {
        if (reply.kind === 'progress') onStep?.(reply.step);
        else if (reply.kind === 'result') finish(() => resolve(reply.result));
        else finish(() => reject(new BridgeError(reply.code)));
      });
      window.postMessage({ channel: CHANNEL, from: 'page', id, type }, location.origin);
    });
  }
}
