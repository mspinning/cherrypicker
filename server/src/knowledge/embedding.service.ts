import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

export interface EmbeddingState {
  model: string;
  dimensions: number;
  configured: boolean;
  /** Last failed call; cleared by the next successful one */
  lastError: string | null;
  lastErrorAt: Date | null;
}

const TIMEOUT_MS = 120_000;

/** Embeddings through Bifrost's OpenAI-compatible /v1/embeddings endpoint. */
@Injectable()
export class EmbeddingService {
  private readonly cfg: AppConfig['embedding'];
  private lastError: { message: string; at: Date } | null = null;

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('embedding', { infer: true });
  }

  get model(): string {
    return this.cfg.model;
  }

  get configured(): boolean {
    return !!this.cfg.baseUrl && !!this.cfg.model;
  }

  state(): EmbeddingState {
    return {
      model: this.cfg.model,
      dimensions: this.cfg.dimensions,
      configured: this.configured,
      lastError: this.lastError?.message ?? null,
      lastErrorAt: this.lastError?.at ?? null,
    };
  }

  /** One vector per input, in the same order. */
  async embed(inputs: string[]): Promise<number[][]> {
    try {
      const vectors = await this.request(inputs);
      this.lastError = null;
      return vectors;
    } catch (err) {
      this.lastError = { message: (err as Error).message, at: new Date() };
      throw err;
    }
  }

  private async request(inputs: string[]): Promise<number[][]> {
    if (!this.configured) {
      throw new Error('Kein Embedding-Modell konfiguriert (BIFROST_URL, EMBEDDING_MODEL).');
    }

    let response: Response;
    try {
      response = await fetch(`${this.cfg.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.virtualKey ? { 'x-bf-vk': this.cfg.virtualKey } : {}),
        },
        body: JSON.stringify({ model: this.cfg.model, input: inputs, encoding_format: 'float' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Bifrost nicht erreichbar: ${(err as Error).message}`);
    }

    const body = (await response.json().catch(() => null)) as {
      data?: { embedding: number[]; index: number }[];
      error?: { message?: string };
    } | null;
    if (!response.ok || !body?.data) {
      const reason = body?.error?.message ?? `HTTP ${response.status}`;
      if (!this.cfg.virtualKey && /virtual key/i.test(reason)) {
        throw new Error('Bifrost verlangt einen Virtual Key: in der Bifrost-UI anlegen und als BIFROST_VIRTUAL_KEY in .env eintragen.');
      }
      throw new Error(`Bifrost (${this.cfg.model}): ${reason}`);
    }

    const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== inputs.length) {
      throw new Error(`Bifrost lieferte ${vectors.length} statt ${inputs.length} Vektoren.`);
    }
    const wrong = vectors.find((v) => v.length !== this.cfg.dimensions);
    if (wrong) {
      throw new Error(
        `${this.cfg.model} liefert ${wrong.length} Dimensionen, erwartet sind ${this.cfg.dimensions} (EMBEDDING_DIMENSIONS).`,
      );
    }
    return vectors;
  }
}
