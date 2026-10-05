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

export type ChatPart =
  | { type: 'text'; text: string }
  /** Base64 audio for models that hear, e.g. Gemma 4 via Ollama */
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' } };

/** One message of a chat in the OpenAI format: what goes to Bifrost and, for answers, back into the next request. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatPart[] | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  /** On `tool` messages: the call this is the result of */
  tool_call_id?: string;
}

export interface ChatInput {
  messages: ChatMessage[];
  /** Offered to the model, which decides itself whether to call any */
  tools?: ToolSpec[];
  /** Another model than LLM_MODEL */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** "none" turns a reasoning model's thinking off: an answer after one second instead of ten */
  reasoning?: 'none' | 'low' | 'medium' | 'high';
  timeoutMs?: number;
}

export interface ChatOutput {
  /** Text of the answer, without a model's <think> block */
  content: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  /** The answer as the next request needs it in `messages` */
  message: ChatMessage;
  /** The answer hit `maxTokens` */
  truncated: boolean;
}

interface ChatChoice {
  message?: {
    content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string | Record<string, unknown> } }[];
  };
  finish_reason?: string;
}

interface ChatResponse {
  choices?: ChatChoice[];
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

  /** A gateway is set up; `chat` then also runs with other models than LLM_MODEL */
  get hasGateway(): boolean {
    return !!this.cfg.baseUrl;
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
      const choice = await this.complete(body, TIMEOUT_MS);
      const message = choice.message;
      const call = message?.tool_calls?.find((c) => c.function?.name === input.tool.name) ?? message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      const parsed =
        typeof args === 'object' && args !== null ? args : (parseJson(typeof args === 'string' ? args : '') ?? parseJson(message?.content ?? ''));
      if (parsed) return parsed;
      if (attempt < MAX_ATTEMPTS) continue;
      throw new LlmError(
        choice.finish_reason === 'length' ? 'Antwort des Modells abgeschnitten' : 'Antwort des Modells ohne verwertbares Ergebnis',
        false,
      );
    }
  }

  /**
   * One step of a conversation: the model answers in text or asks for tools.
   * The caller runs the tools, appends `message` and the results and asks again.
   */
  async chat(input: ChatInput): Promise<ChatOutput> {
    const model = input.model || this.cfg.model;
    if (!this.cfg.baseUrl || !model) throw new LlmError('Kein Sprachmodell konfiguriert (LLM_MODEL).', true);

    const choice = await this.complete(
      {
        model,
        messages: input.messages,
        ...(input.tools?.length ? { tools: input.tools.map((tool) => ({ type: 'function', function: tool })) } : {}),
        max_tokens: input.maxTokens ?? 2000,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.reasoning ? { reasoning_effort: input.reasoning } : {}),
      },
      input.timeoutMs ?? TIMEOUT_MS,
    );

    const content = stripThinking(choice.message?.content ?? '');
    const toolCalls = (choice.message?.tool_calls ?? [])
      .filter((call) => call.function?.name)
      .map((call, i) => {
        const raw = call.function!.arguments;
        return {
          id: call.id || `call_${i}`,
          name: call.function!.name!,
          args: typeof raw === 'object' && raw !== null ? raw : (parseJson(raw ?? '') ?? {}),
        };
      });
    return {
      content,
      toolCalls,
      message: {
        role: 'assistant',
        content,
        ...(toolCalls.length
          ? {
              tool_calls: toolCalls.map((call) => ({
                id: call.id,
                type: 'function' as const,
                function: { name: call.name, arguments: JSON.stringify(call.args) },
              })),
            }
          : {}),
      },
      truncated: choice.finish_reason === 'length',
    };
  }

  /** Sends one request; network errors, rate limits and server errors are retried. */
  private async complete(body: { model: string } & Record<string, unknown>, timeoutMs: number): Promise<ChatChoice> {
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
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(2000 * attempt);
          continue;
        }
        throw new LlmError(`Bifrost nicht erreichbar: ${(err as Error).message}`, false);
      }

      const answer = (await res.json().catch(() => null)) as ChatResponse | null;
      if (!res.ok || !answer?.choices?.length) {
        const reason = typeof answer?.error === 'string' ? answer.error : (answer?.error?.message ?? `HTTP ${res.status}`);
        if ((res.status === 429 || res.status >= 500) && !isConfigProblem(reason) && attempt < MAX_ATTEMPTS) {
          await sleep(5000 * attempt);
          continue;
        }
        throw new LlmError(`Bifrost (${body.model}): ${reason}`, [401, 403, 404].includes(res.status) || isConfigProblem(reason));
      }
      return answer.choices[0];
    }
  }
}

function isConfigProblem(reason: string): boolean {
  return /not allowed|virtual key|failed to get config|model.*not found|unknown model|unauthori[sz]ed|api key|not supported/i.test(reason);
}

function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** JSON object from a tool argument or from free text (code fences, a model's <think> block around it). */
function parseJson(text: string): Record<string, unknown> | null {
  const cleaned = stripThinking(text);
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
