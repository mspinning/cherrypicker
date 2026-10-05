import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { LlmService } from '../llm/llm.service';

/** What the model answers when nobody speaks; without it, it would make something up from the name list */
const SILENCE = '[stille]';
const MAX_HINTS = 60;
/** A dictation in the user's waiting time: no retries worth minutes */
const TIMEOUT_MS = 60_000;

/**
 * Writes down what was said in a recording. Runs as a chat completion with
 * audio input on a model that hears (Gemma 4 E4B via Ollama): Bifrost's own
 * transcription endpoint does not reach Ollama, and a chat prompt can carry
 * the names the speaker is likely to mention.
 */
@Injectable()
export class SpeechToTextService {
  private readonly model: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly llm: LlmService,
  ) {
    this.model = config.get('voice', { infer: true }).sttModel;
  }

  get configured(): boolean {
    return !!this.model;
  }

  /** `names`: companies, people and products that may come up, as spelling hints. Empty string if nobody speaks. */
  async transcribe(wav: Buffer, names: string[]): Promise<string> {
    const hints = [...new Set(names.map((name) => name.trim()).filter(Boolean))].slice(0, MAX_HINTS);
    const reply = await this.llm.chat({
      model: this.model,
      temperature: 0,
      reasoning: 'none',
      maxTokens: 2000,
      timeoutMs: TIMEOUT_MS,
      messages: [
        {
          role: 'system',
          content:
            `Du bist ein Diktiergerät. Gib wörtlich wieder, was in der Aufnahme gesagt wird, ohne Kommentar und ohne Anführungszeichen. ` +
            `Mailadressen, Telefonnummern und Zahlen schreibst du in Ziffern und Zeichen. ` +
            `Ist keine Sprache zu hören, antworte nur mit ${SILENCE}.` +
            (hints.length ? `\n\nMögliche Eigennamen (nur verwenden, wenn sie wirklich gesagt werden): ${hints.join(', ')}.` : ''),
        },
        {
          role: 'user',
          content: [
            { type: 'input_audio', input_audio: { data: wav.toString('base64'), format: 'wav' } },
            { type: 'text', text: 'Transkribiere die Aufnahme.' },
          ],
        },
      ],
    });
    const text = reply.content.replace(/\s+/g, ' ').trim();
    return text.toLowerCase().includes(SILENCE) || !/[\p{L}\p{N}]/u.test(text) ? '' : text;
  }

  /** Loads the model, so the first sentence of a call does not wait for it. */
  async warmUp(): Promise<void> {
    if (!this.configured) return;
    await this.llm
      .chat({ model: this.model, reasoning: 'none', maxTokens: 1, timeoutMs: TIMEOUT_MS, messages: [{ role: 'user', content: 'Hallo' }] })
      .catch(() => undefined);
  }
}
