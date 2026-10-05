import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LlmError } from '../llm/llm.service';
import { User } from '../users/user.entity';
import { CallAgent } from './call-agent.service';
import { CallContext } from './call-tools.service';
import { CallStartedDto, VoiceEvent, VoiceStatusDto } from './dto/voice.dto';
import { VoiceCall, VoiceCallResult, VoiceCallStatus } from './entities/voice-call.entity';
import { validTimeZone } from './local-time';
import { SpeechToTextService } from './speech-to-text.service';
import { inspectWav } from './wav';

/** Shorter recordings are a click or a cough */
const MIN_SECONDS = 0.3;
/** One utterance; the client cuts off earlier */
const MAX_SECONDS = 180;
/** Below this the microphone delivered (almost) digital silence */
const MIN_PEAK = 0.01;
/** Product names for the transcription, read from the knowledge base */
const MAX_PRODUCT_NAMES = 25;

type Emit = (event: VoiceEvent) => void;

/**
 * Voice calls with the assistant: start, one request per thing the caller
 * says, and the wrap-up after hanging up. Requests of one call run strictly
 * one after another, so the wrap-up always sees the last sentence.
 */
@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);
  /** Per call: the request that currently runs, the next one waits for it */
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    @InjectRepository(VoiceCall) private readonly calls: Repository<VoiceCall>,
    private readonly speech: SpeechToTextService,
    private readonly agent: CallAgent,
    private readonly dataSource: DataSource,
  ) {}

  status(): VoiceStatusDto {
    if (!this.speech.configured) return { available: false, reason: 'Kein Modell für die Spracherkennung konfiguriert (VOICE_STT_MODEL).' };
    if (!this.agent.configured) return { available: false, reason: 'Kein Sprachmodell für den Assistenten konfiguriert (LLM_MODEL).' };
    return { available: true, reason: null };
  }

  async start(user: User, timeZone: string | undefined): Promise<CallStartedDto> {
    const status = this.status();
    if (!status.available) throw new ServiceUnavailableException(status.reason);

    const greeting = `Hallo${user.firstName.trim() ? ` ${user.firstName.trim()}` : ''}, hier ist Cherry. Was gibt es Neues?`;
    const now = new Date();
    const call = this.calls.create({
      userId: user.id,
      timeZone: validTimeZone(timeZone),
      startedAt: now,
      turns: [{ role: 'assistant', text: greeting, at: now.toISOString() }],
      vocabulary: [],
    });
    await this.agent.open(call, user, greeting);
    await this.calls.save(call);

    // Both models load while the greeting is read out
    void this.speech.warmUp();
    void this.agent.warmUp();
    return { id: call.id, greeting };
  }

  /** The caller's own call while it is still running. */
  async requireActive(userId: string, id: string): Promise<VoiceCall> {
    const call = await this.calls.findOne({ where: { id, userId } });
    if (!call) throw new NotFoundException('Anruf nicht gefunden');
    if (call.status !== VoiceCallStatus.Active) throw new ConflictException('Der Anruf ist schon beendet');
    return call;
  }

  /** Checks a recording before anything is answered: wrong files are a plain 400. */
  checkAudio(file: Buffer): { silent: boolean } {
    const info = inspectWav(file);
    if (!info) throw new BadRequestException('Die Aufnahme muss eine WAV-Datei mit 16 Bit PCM sein');
    if (info.seconds > MAX_SECONDS) throw new BadRequestException('Die Aufnahme ist zu lang');
    return { silent: info.seconds < MIN_SECONDS || info.peak < MIN_PEAK };
  }

  /** One thing the caller said (`audio`) or typed (`text`): transcribe, let the agent answer. */
  turn(user: User, id: string, input: { audio?: Buffer; text?: string }, emit: Emit): Promise<void> {
    return this.exclusive(id, async () => {
      const call = await this.requireActive(user.id, id);

      let said = input.text ?? '';
      if (input.audio) {
        if (this.checkAudio(input.audio).silent) return emit({ type: 'silence' });
        said = await this.speech.transcribe(input.audio, [...call.vocabulary, ...(await this.ownNames())]);
      }
      if (!said) return emit({ type: 'silence' });
      emit({ type: 'heard', text: said });
      call.turns.push({ role: 'user', text: said, at: new Date().toISOString() });

      // Saved only once the agent answered: after an error the caller simply says it again
      const reply = await this.agent.reply(this.context(call, user), said, (label) => emit({ type: 'step', label }));
      call.turns.push({ role: 'assistant', text: reply.text, at: new Date().toISOString() });
      await this.calls.save(call);
      emit({ type: 'reply', text: reply.text, hangup: reply.hangup });
    });
  }

  /** Hangs up and lets the agent write customers and tasks. */
  finish(user: User, id: string, emit: Emit): Promise<void> {
    return this.exclusive(id, async () => {
      const call = await this.requireActive(user.id, id);
      call.status = VoiceCallStatus.Wrapping;
      call.endedAt = new Date();
      await this.calls.save(call);

      const ctx = this.context(call, user);
      try {
        // Hung up without a word: nothing to do
        if (call.turns.some((turn) => turn.role === 'user')) await this.agent.wrapUp(ctx, (label) => emit({ type: 'step', label }));
        call.status = VoiceCallStatus.Done;
      } catch (err) {
        this.logger.error(`Wrap-up of call ${call.id} failed: ${(err as Error).message}`);
        call.status = VoiceCallStatus.Failed;
        call.error = (err as Error).message.slice(0, 2000);
      }
      // Also after a failure: what was created until then exists
      call.result = ctx.outcome;
      await this.calls.save(call);

      if (call.status === VoiceCallStatus.Failed) {
        emit({ type: 'error', message: 'Der Anruf konnte nicht vollständig verarbeitet werden.' });
      }
      emit({ type: 'result', result: ctx.outcome });
    });
  }

  /** What the caller may read of an error. */
  messageOf(err: unknown): string {
    if (err instanceof LlmError) {
      this.logger.warn(err.message);
      return err.fatal ? 'Das Sprachmodell ist nicht richtig eingerichtet.' : 'Das Sprachmodell antwortet gerade nicht.';
    }
    this.logger.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return 'Das hat nicht geklappt.';
  }

  /**
   * Names of our own that the caller will say and no speech model can spell:
   * the group's companies and the product names our knowledge sources start
   * with ("HUB.KI – KI-Plattform für Unternehmen" → "HUB.KI").
   */
  private async ownNames(): Promise<string[]> {
    const titles = await this.dataSource.query<{ title: string }[]>(
      `SELECT title FROM knowledge_sources WHERE type <> 'document' ORDER BY created_at DESC LIMIT 200`,
    );
    const products = titles
      .map(({ title }) => title.split(/\s+[|–—:-]\s+|:\s+/)[0].trim())
      .filter((name) => name.length >= 2 && name.length <= 40);
    return [...(await this.agent.ownCompanies()).map((c) => c.name), ...new Set(products)].slice(0, MAX_PRODUCT_NAMES);
  }

  private context(call: VoiceCall, user: User): CallContext {
    const outcome: VoiceCallResult = { summary: '', customers: [], tasks: [] };
    return { call, user, now: new Date(), outcome };
  }

  private exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    const result = (this.running.get(id) ?? Promise.resolve()).then(work, work);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    this.running.set(id, settled);
    void settled.then(() => {
      if (this.running.get(id) === settled) this.running.delete(id);
    });
    return result;
  }
}
