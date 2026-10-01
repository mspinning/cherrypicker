import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

const VERSION = 'v1';

/**
 * AES-256-GCM for secrets at rest (OAuth refresh tokens) and for the OAuth
 * state that travels through the browser. The `purpose` is bound as
 * associated data, so a token can never be replayed as a state or vice versa.
 */
@Injectable()
export class SecretBox {
  private readonly logger = new Logger(SecretBox.name);
  private readonly key: Buffer | null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.key = deriveKey(config.get('integrations', { infer: true }).encryptionKey);
    if (!this.key) {
      this.logger.warn('INTEGRATIONS_ENCRYPTION_KEY is not set, mailbox connections are disabled');
    }
  }

  get configured(): boolean {
    return this.key !== null;
  }

  seal(plain: string, purpose: string): string {
    const key = this.requireKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(purpose));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
  }

  /** Throws on tampered data, a wrong purpose or a changed key. */
  open(sealed: string, purpose: string): string {
    const key = this.requireKey();
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Unknown secret format');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('INTEGRATIONS_ENCRYPTION_KEY is not set');
    return this.key;
  }
}

/** 32 random bytes as base64 (`openssl rand -base64 32`); any other long passphrase is hashed. */
function deriveKey(raw: string): Buffer | null {
  const value = raw.trim();
  if (!value) return null;
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 32 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return decoded;
  if (value.length < 32) {
    throw new Error('INTEGRATIONS_ENCRYPTION_KEY is too short: use 32 random bytes as base64 (openssl rand -base64 32)');
  }
  return createHash('sha256').update(value).digest();
}
