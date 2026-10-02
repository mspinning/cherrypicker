import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { BridgeError, LinkedInBridge } from './linkedin-bridge';
import { LINKEDIN_URL, LinkedInConversation, LinkedInInbox, LinkedInRun } from './linkedin.models';

const ERRORS: Record<string, string> = {
  busy: 'Die Erweiterung prüft gerade schon. Warte einen Moment.',
  timeout: 'LinkedIn hat nicht rechtzeitig geantwortet. Versuche es noch einmal.',
  tab_closed: 'Der LinkedIn-Tab wurde geschlossen, bevor die Nachrichten gelesen waren.',
  stale: 'Die Erweiterung wurde neu geladen. Lade diese Seite neu und versuche es dann noch einmal.',
  disconnected: 'Die Erweiterung wurde neu geladen. Lade diese Seite neu und versuche es dann noch einmal.',
  layout: 'LinkedIn hat den Posteingang anders aufgebaut als erwartet. Die Erweiterung muss angepasst werden.',
};
const FAILED = 'Die Nachrichten konnten nicht gelesen werden.';

/**
 * LinkedIn messages of the signed-in user, read by the Chrome extension with
 * the browser's own LinkedIn session. Nothing of it goes to the server.
 */
@Injectable({ providedIn: 'root' })
export class LinkedInStore {
  private readonly bridge = inject(LinkedInBridge);
  private readonly auth = inject(AuthService);

  readonly run = signal<LinkedInRun>({ state: 'idle' });
  /** Remembers whose inbox it is, so it never outlives a sign-out or account switch. */
  private readonly last = signal<{ ownerId: string; inbox: LinkedInInbox } | null>(null);

  readonly inbox = computed(() => {
    const last = this.last();
    return last && last.ownerId === this.auth.user()?.id ? last.inbox : null;
  });
  readonly unread = computed(() => this.inbox()?.unread ?? 0);

  constructor() {
    // Installed while the panel waited for it: carry on right away
    effect(() => {
      if (this.bridge.announced() && untracked(this.run).state === 'missing') untracked(() => void this.check());
    });
  }

  async check(): Promise<void> {
    if (this.run().state === 'running') return;
    this.run.set({ state: 'running', step: 'detect' });
    if (!(await this.bridge.hello())) {
      this.run.set({ state: 'missing' });
      return;
    }
    const ownerId = this.auth.user()?.id ?? '';
    try {
      const result = await this.bridge.check((step) => this.run.set({ state: 'running', step }));
      this.apply(result, ownerId);
    } catch (err) {
      this.run.set({ state: 'failed', message: ERRORS[err instanceof BridgeError ? err.code : ''] ?? FAILED });
    }
  }

  async focus(): Promise<void> {
    try {
      await this.bridge.focus();
    } catch {
      window.open(LINKEDIN_URL, '_blank', 'noopener');
    }
  }

  private apply(result: unknown, ownerId: string): void {
    const status = (result as { status?: unknown } | null)?.status;
    if (status === 'ok') {
      this.last.set({ ownerId, inbox: toInbox(result as Record<string, unknown>) });
      this.run.set({ state: 'done' });
    } else if (status === 'signed_out') {
      this.run.set({ state: 'signed-out' });
    } else if (status === 'challenge') {
      this.run.set({ state: 'challenge' });
    } else {
      this.run.set({ state: 'failed', message: ERRORS[String(status)] ?? FAILED });
    }
  }
}

/** The extension reads LinkedIn's page: take only what fits, links only to linkedin.com. */
function toInbox(raw: Record<string, unknown>): LinkedInInbox {
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const conversations: LinkedInConversation[] = (Array.isArray(raw['conversations']) ? raw['conversations'] : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      name: text(c['name']) || 'Unbekannt',
      snippet: text(c['snippet']),
      time: text(c['time']),
      unread: c['unread'] === true,
      unreadCount: typeof c['unreadCount'] === 'number' ? c['unreadCount'] : 0,
      url: text(c['url']).startsWith(LINKEDIN_URL) ? text(c['url']) : null,
    }));
  const unread = typeof raw['unread'] === 'number' ? raw['unread'] : conversations.filter((c) => c.unread).length;
  return { unread, conversations, checkedAt: text(raw['checkedAt']) || new Date().toISOString() };
}
