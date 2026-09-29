import { lookup as dnsLookup, LookupAddress, LookupOptions } from 'node:dns';
import { IncomingMessage, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ExtractionError } from './text-extractor';

export interface FetchedPage {
  /** After redirects */
  url: string;
  contentType: string;
  charset?: string;
  body: Buffer;
}

const MAX_BYTES = 10 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; CherrypickBot/1.0; knowledge import)';

/**
 * The server sits in the same network as Postgres, Keycloak and Bifrost.
 * Only public addresses may be fetched, checked on every connect (so DNS
 * rebinding and redirects to internal hosts are caught as well).
 */
const PRIVATE = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv4');
}
// IPv4-mapped IPv6 (::ffff:10.0.0.1) is checked against the IPv4 rules by BlockList itself;
// a ::ffff:0:0/96 rule would match every IPv4 address.
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(net, prefix, 'ipv6');
}

function isPrivate(address: string): boolean {
  const family = isIP(address);
  return family === 0 || PRIVATE.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '');
    const list = addresses as LookupAddress[];
    if (!list.length || list.some((a) => isPrivate(a.address))) {
      return callback(Object.assign(new Error(`${hostname} zeigt auf eine interne Adresse`), { code: 'EPRIVATE' }), '');
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

/** Checks a URL typed by a user; returns the normalized form or null. */
export function normalizeUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.') || url.username || url.password) {
    return null;
  }
  url.hash = '';
  return url.toString();
}

export async function fetchPage(input: string): Promise<FetchedPage> {
  let url = new URL(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new ExtractionError('Weiterleitung auf ein nicht unterstütztes Protokoll.');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && isPrivate(host)) {
      throw new ExtractionError('Interne Adressen können nicht abgerufen werden.');
    }

    const response = await get(url);
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      url = new URL(response.headers.location, url);
      continue;
    }
    if (status >= 400) {
      response.resume();
      throw new ExtractionError(`Die Seite antwortet mit HTTP ${status}.`);
    }

    const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
    return {
      url: url.toString(),
      contentType: contentType.split(';')[0].trim(),
      charset: /charset=["']?([\w-]+)/.exec(contentType)?.[1],
      body: await readBody(response),
    };
  }
  throw new ExtractionError('Zu viele Weiterleitungen.');
}

function get(url: URL): Promise<IncomingMessage> {
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup: safeLookup as never,
        timeout: TIMEOUT_MS,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8,*/*;q=0.5',
          'Accept-Language': 'de,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
        },
      },
      resolve,
    );
    req.on('timeout', () => req.destroy(new ExtractionError('Die Seite antwortet nicht (Zeitüberschreitung).')));
    req.on('error', (err: NodeJS.ErrnoException) => reject(toExtractionError(err)));
    req.end();
  });
}

function readBody(response: IncomingMessage): Promise<Buffer> {
  const encoding = String(response.headers['content-encoding'] ?? '').toLowerCase();
  const stream =
    encoding === 'gzip'
      ? response.pipe(createGunzip())
      : encoding === 'deflate'
        ? response.pipe(createInflate())
        : encoding === 'br'
          ? response.pipe(createBrotliDecompress())
          : response;

  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    const fail = (err: NodeJS.ErrnoException) => {
      response.destroy();
      reject(toExtractionError(err));
    };
    stream.on('data', (part: Buffer) => {
      size += part.length;
      if (size > MAX_BYTES) return fail(new ExtractionError('Die Seite ist größer als 10 MB.'));
      parts.push(part);
    });
    stream.on('end', () => resolve(Buffer.concat(parts)));
    stream.on('error', fail);
    // pipe() does not forward errors of the source stream (connection reset mid-body)
    if (stream !== response) response.on('error', fail);
  });
}

function toExtractionError(err: NodeJS.ErrnoException): Error {
  if (err instanceof ExtractionError) return err;
  switch (err.code) {
    case 'EPRIVATE':
      return new ExtractionError('Interne Adressen können nicht abgerufen werden.');
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return new ExtractionError('Die Domain wurde nicht gefunden.');
    case 'ECONNREFUSED':
      return new ExtractionError('Der Server lehnt die Verbindung ab.');
    case 'ECONNRESET':
      return new ExtractionError('Der Server hat die Verbindung abgebrochen.');
    default:
      return new ExtractionError(`Die Seite konnte nicht geladen werden (${err.code ?? err.message}).`);
  }
}
