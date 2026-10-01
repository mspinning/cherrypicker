import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { GRAPH_URL, MicrosoftAuthService } from './microsoft-auth.service';
import { GraphError } from './microsoft.errors';

const TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 5;
/** Graph limit per $batch request */
const BATCH_SIZE = 20;
/** Immutable ids survive moving a mail to another folder, so the same mail is never imported twice */
const IMMUTABLE_IDS = 'IdType="ImmutableId"';

export interface GraphAddress {
  emailAddress?: { name?: string; address?: string };
}

export interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string | null;
  bodyPreview?: string;
  from?: GraphAddress;
  toRecipients?: GraphAddress[];
  ccRecipients?: GraphAddress[];
  receivedDateTime?: string;
  sentDateTime?: string;
  isDraft?: boolean;
  parentFolderId?: string;
  /** "other" = not in the Focused inbox: newsletters, notifications … */
  inferenceClassification?: 'focused' | 'other';
  webLink?: string;
}

export interface GraphMe {
  id: string;
  displayName?: string;
  mail?: string | null;
  userPrincipalName?: string;
  otherMails?: string[];
  proxyAddresses?: string[];
}

export interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

export interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  start: GraphDateTime;
  end: GraphDateTime;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  location?: { displayName?: string };
  isOnlineMeeting?: boolean;
  onlineMeeting?: { joinUrl?: string } | null;
  organizer?: GraphAddress;
  attendees?: (GraphAddress & { type?: string; status?: { response?: string } })[];
  webLink?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

const MESSAGE_FIELDS = [
  'id',
  'conversationId',
  'subject',
  'bodyPreview',
  'from',
  'toRecipients',
  'ccRecipients',
  'receivedDateTime',
  'sentDateTime',
  'isDraft',
  'parentFolderId',
  'inferenceClassification',
  'webLink',
].join(',');

const EVENT_FIELDS = [
  'id',
  'subject',
  'bodyPreview',
  'start',
  'end',
  'isAllDay',
  'isCancelled',
  'showAs',
  'location',
  'isOnlineMeeting',
  'onlineMeeting',
  'organizer',
  'attendees',
  'webLink',
].join(',');

/**
 * Microsoft Graph with the delegated token of one CRM user. Retries
 * throttling (429, honouring Retry-After) and renews the token once on 401.
 */
@Injectable()
export class GraphClient {
  constructor(private readonly auth: MicrosoftAuthService) {}

  async request<T>(userId: string, path: string, options: RequestOptions = {}): Promise<T> {
    const url = urlOf(path);
    let forceRefresh = false;
    let renewed = false;

    for (let attempt = 1; ; attempt++) {
      const token = await this.auth.accessToken(userId, forceRefresh);
      forceRefresh = false;

      let res: Response;
      try {
        res = await fetch(url, {
          method: options.method ?? 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers,
          },
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new GraphError(`Microsoft Graph nicht erreichbar: ${(err as Error).message}`, 0);
      }

      if (res.status === 401 && !renewed) {
        renewed = true;
        forceRefresh = true;
        await res.body?.cancel();
        continue;
      }
      if ([429, 502, 503, 504].includes(res.status) && attempt < MAX_ATTEMPTS) {
        await res.body?.cancel();
        await sleep(retryAfterMs(res.headers.get('retry-after')) ?? backoff(attempt));
        continue;
      }
      if (res.status === 204) return undefined as T;

      const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (!res.ok) {
        throw new GraphError(data?.error?.message ?? `HTTP ${res.status}`, res.status, data?.error?.code);
      }
      return data as T;
    }
  }

  /** Follows @odata.nextLink page by page. */
  async *pages<T>(userId: string, path: string, headers?: Record<string, string>): AsyncGenerator<T[]> {
    let next: string | undefined = path;
    while (next) {
      const page: { value?: T[]; '@odata.nextLink'?: string } = await this.request(userId, next, { headers });
      yield page.value ?? [];
      next = page['@odata.nextLink'];
    }
  }

  /** GET requests through /$batch, 20 per call; throttled parts are retried. Keyed by request id. */
  async batchGet(
    userId: string,
    requests: { id: string; url: string; headers?: Record<string, string> }[],
  ): Promise<Map<string, { status: number; body: unknown }>> {
    const results = new Map<string, { status: number; body: unknown }>();
    for (let i = 0; i < requests.length; i += BATCH_SIZE) {
      let pending = requests.slice(i, i + BATCH_SIZE);
      for (let attempt = 1; pending.length && attempt <= MAX_ATTEMPTS; attempt++) {
        const answer = await this.request<{
          responses: { id: string; status: number; headers?: Record<string, string>; body?: unknown }[];
        }>(userId, '/$batch', {
          method: 'POST',
          body: { requests: pending.map((r) => ({ id: r.id, method: 'GET', url: r.url, headers: r.headers })) },
        });
        const throttled = new Set<string>();
        let wait = 0;
        for (const part of answer.responses ?? []) {
          if ((part.status === 429 || part.status === 503) && attempt < MAX_ATTEMPTS) {
            throttled.add(part.id);
            wait = Math.max(wait, retryAfterMs(part.headers?.['Retry-After'] ?? part.headers?.['retry-after']) ?? 0);
          } else {
            results.set(part.id, { status: part.status, body: part.body });
          }
        }
        pending = pending.filter((r) => throttled.has(r.id));
        if (pending.length) await sleep(wait || backoff(attempt));
      }
    }
    return results;
  }

  // ---------- Mail ----------

  me(userId: string): Promise<GraphMe> {
    return this.request(userId, '/me?$select=id,displayName,mail,userPrincipalName,otherMails,proxyAddresses');
  }

  /** Ids of well-known folders such as junkemail or deleteditems; missing ones are left out. */
  async folderIds(userId: string, names: string[]): Promise<Set<string>> {
    const answers = await this.batchGet(
      userId,
      names.map((name) => ({ id: name, url: `/me/mailFolders/${name}?$select=id`, headers: { Prefer: IMMUTABLE_IDS } })),
    );
    const ids = new Set<string>();
    for (const { status, body } of answers.values()) {
      const id = (body as { id?: string } | undefined)?.id;
      if (status === 200 && id) ids.add(id);
    }
    return ids;
  }

  /** All mails of the mailbox (every folder), newest first, without bodies. */
  messages(userId: string, options: { since?: Date | null; pageSize?: number } = {}): AsyncGenerator<GraphMessage[]> {
    const params = new URLSearchParams({
      $select: MESSAGE_FIELDS,
      $top: String(options.pageSize ?? 100),
      $orderby: 'receivedDateTime desc',
    });
    // $orderby properties must also appear in $filter, in the same order
    if (options.since) params.set('$filter', `receivedDateTime ge ${options.since.toISOString()}`);
    return this.pages<GraphMessage>(userId, `/me/messages?${params.toString()}`, { Prefer: IMMUTABLE_IDS });
  }

  /**
   * Plain text of the given mails. `unique` is only what the sender wrote
   * (without the quoted conversation), `full` the whole body as a fallback.
   */
  async messageTexts(userId: string, ids: string[]): Promise<Map<string, { unique: string; full: string }>> {
    const answers = await this.batchGet(
      userId,
      ids.map((id, index) => ({
        id: String(index),
        url: `/me/messages/${encodeURIComponent(id)}?$select=uniqueBody,body`,
        headers: { Prefer: `outlook.body-content-type="text", ${IMMUTABLE_IDS}` },
      })),
    );
    const texts = new Map<string, { unique: string; full: string }>();
    for (const [index, { status, body }] of answers) {
      if (status !== 200) continue;
      const message = body as { uniqueBody?: { content?: string }; body?: { content?: string } };
      texts.set(ids[Number(index)], { unique: message.uniqueBody?.content ?? '', full: message.body?.content ?? '' });
    }
    return texts;
  }

  // ---------- Calendar ----------

  /** Expanded occurrences (series included) between two points in time, in UTC. */
  async events(userId: string, from: Date, to: Date, limit = 250): Promise<GraphEvent[]> {
    const params = new URLSearchParams({
      startDateTime: from.toISOString(),
      endDateTime: to.toISOString(),
      $select: EVENT_FIELDS,
      $orderby: 'start/dateTime',
      $top: '100',
    });
    const events: GraphEvent[] = [];
    for await (const page of this.pages<GraphEvent>(userId, `/me/calendarView?${params.toString()}`, {
      Prefer: 'outlook.timezone="UTC"',
    })) {
      events.push(...page);
      if (events.length >= limit) break;
    }
    return events.slice(0, limit);
  }

  createEvent(userId: string, event: Record<string, unknown>): Promise<GraphEvent> {
    return this.request(userId, '/me/events', { method: 'POST', body: event, headers: { Prefer: 'outlook.timezone="UTC"' } });
  }

  updateEvent(userId: string, id: string, patch: Record<string, unknown>): Promise<GraphEvent> {
    return this.request(userId, `/me/events/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: patch,
      headers: { Prefer: 'outlook.timezone="UTC"' },
    });
  }

  deleteEvent(userId: string, id: string): Promise<void> {
    return this.request(userId, `/me/events/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
}

/** Only Graph itself: nextLinks come from Graph, but must never redirect the token elsewhere. */
function urlOf(path: string): string {
  if (path.startsWith(`${GRAPH_URL}/`)) return path;
  if (path.startsWith('/')) return `${GRAPH_URL}${path}`;
  throw new Error(`Not a Graph path: ${path}`);
}

function backoff(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 500);
}

function retryAfterMs(header: string | null | undefined): number | undefined {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 120) * 1000 : undefined;
}
