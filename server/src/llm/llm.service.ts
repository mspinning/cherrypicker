import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';

const TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 3;

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON schema of the arguments */
  parameters: Record<string, unknown>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    /** Configuration problems (model blocked, provider missing): retrying the next item will not help */
    readonly fatal: boolean,
  ) {
    super(message);
  }
}

interface ChatResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string | Record<string, unknown> } }[];
    };
    finish_reason?: string;
  }[];
  error?: { message?: string } | string;
}

/**
 * Chat completions through Bifrost's OpenAI-compatible API. Structured
 * answers come as a forced tool call, which every provider behind Bifrost
 * supports; plain JSON in the text is accepted as a fallback for local models.
 */
@Injectable()
export class LlmService {
  private readonly cfg: AppConfig['llm'];

  constructor(config: ConfigService<AppConfig, true>) {
    this.cfg = config.get('llm', { infer: true });
  }

  get configured(): boolean {
    return !!this.cfg.baseUrl && !!this.cfg.model;
  }

  get model(): string {
    return this.cfg.model;
  }

  /** Makes the model call `tool` and returns its arguments, not yet validated. */
  async callTool(input: { system: string; user: string; tool: ToolSpec; maxTokens?: number }): Promise<Record<string, unknown>> {
    if (!this.configured) throw new LlmError('Kein Sprachmodell konfiguriert (LLM_MODEL).', true);

    const body = {
      model: this.cfg.model,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      tools: [{ type: 'function', function: input.tool }],
      tool_choice: { type: 'function', function: { name: input.tool.name } },
      max_tokens: input.maxTokens ?? 4000,
    };

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.cfg.virtualKey ? { 'x-bf-vk': this.cfg.virtualKey } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2000 * attempt);
          continue;
        }
        throw new LlmError(`Bifrost nicht erreichbar: ${(err as Error).message}`, false);
      }

      const answer = (await res.json().catch(() => null)) as ChatResponse | null;
      if (!res.ok || !answer?.choices) {
        const reason = typeof answer?.error === 'string' ? answer.error : (answer?.error?.message ?? `HTTP ${res.status}`);
        if ((res.status === 429 || res.status >= 500) && !isConfigProblem(reason) && attempt < MAX_ATTEMPTS) {
          await sleep(5000 * attempt);
          continue;
        }
        throw new LlmError(`Bifrost (${this.cfg.model}): ${reason}`, [401, 403, 404].includes(res.status) || isConfigProblem(reason));
      }

      const message = answer.choices[0]?.message;
      const call = message?.tool_calls?.find((c) => c.function?.name === input.tool.name) ?? message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      const parsed =
        typeof args === 'object' && args !== null ? args : (parseJson(typeof args === 'string' ? args : '') ?? parseJson(message?.content ?? ''));
      if (parsed) return parsed;
      if (attempt < MAX_ATTEMPTS) continue;
      throw new LlmError(
        answer.choices[0]?.finish_reason === 'length' ? 'Antwort des Modells abgeschnitten' : 'Antwort des Modells ohne verwertbares Ergebnis',
        false,
      );
    }
  }
}

function isConfigProblem(reason: string): boolean {
  return /not allowed|virtual key|failed to get config|model.*not found|unknown model|unauthori[sz]ed|api key/i.test(reason);
}

/** JSON object from a tool argument or from free text (code fences, a model's <think> block around it). */
function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1)]) {
    if (!candidate.trim()) continue;
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch {
      // try the next candidate
    }
  }
  return null;
}
