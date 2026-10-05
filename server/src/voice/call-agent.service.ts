import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { GroupCompany } from '../knowledge/entities/group-company.entity';
import { ChatMessage, LlmService } from '../llm/llm.service';
import { User } from '../users/user.entity';
import { CallContext, CallTool, CallTools, HANG_UP } from './call-tools.service';
import { VoiceCall, VoiceCallResult } from './entities/voice-call.entity';
import { describeNow, isoDate } from './local-time';

/** Lookups before an answer; more means the model is going in circles */
const TALK_STEPS = 4;
/** A call about three customers needs about ten tool calls */
const WRAP_UP_STEPS = 16;
/**
 * What somebody says who is done. Models like to hang up as soon as they
 * have understood everything; without one of these the call goes on.
 */
const FAREWELL =
  /(?<!\p{L})(tsch[üu]ss?|tschau|ciao|bye|servus|ade|bis (bald|dann|sp[äa]ter|morgen|gleich)|wiederh[öo]ren|das war('?s| es| alles)|das wars|war alles|war's|mehr (hab|habe) ich nicht|nichts (mehr|weiter)|kein(e|en)? weiteren?|fertig|leg(e|st)? auf|auflegen|reicht|passt|nein|n[eö]e?|danke)(?!\p{L})/iu;

export interface CallReply {
  /** What the assistant says, ready to be read out */
  text: string;
  /** The assistant said goodbye */
  hangup: boolean;
}

/**
 * The assistant on the other end of a voice call. While the caller talks it
 * listens, looks up who they mean and answers in a sentence or two. After
 * they hung up it turns the conversation into CRM entries and tasks for them.
 * Both happen in one chat (`call.messages`), so nothing has to be said twice.
 */
@Injectable()
export class CallAgent {
  private readonly logger = new Logger(CallAgent.name);
  private readonly model: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly llm: LlmService,
    private readonly tools: CallTools,
    @InjectRepository(GroupCompany) private readonly groupCompanies: Repository<GroupCompany>,
  ) {
    this.model = config.get('voice', { infer: true }).agentModel;
  }

  get configured(): boolean {
    return this.llm.hasGateway && !!this.model;
  }

  /** Our own companies: what "we" means in the call, and names the caller will say. */
  async ownCompanies(): Promise<GroupCompany[]> {
    return this.groupCompanies.find({ order: { name: 'ASC' } });
  }

  /** Starts the chat: who is calling, what the assistant is there for. */
  async open(call: VoiceCall, user: User, greeting: string): Promise<void> {
    call.messages = [
      { role: 'system', content: systemPrompt(user, await this.ownCompanies(), call.timeZone, call.startedAt) },
      { role: 'assistant', content: greeting },
    ];
  }

  /** Answers what the caller just said. */
  async reply(ctx: CallContext, said: string, onStep: (label: string) => void): Promise<CallReply> {
    ctx.call.messages.push({ role: 'user', content: said });
    const answer = await this.run(ctx, this.tools.talking, { steps: TALK_STEPS, maxTokens: 500, mayHangUp: FAREWELL.test(said) }, onStep);
    return { text: speakable(answer.text) || 'Alles klar, ist notiert. Noch etwas?', hangup: answer.hangup };
  }

  /** After the call: writes customers, notes and tasks; `ctx.outcome` collects what was created. */
  async wrapUp(ctx: CallContext, onStep: (label: string) => void): Promise<VoiceCallResult> {
    ctx.call.messages.push({ role: 'user', content: wrapUpPrompt(ctx.user) });
    const answer = await this.run(ctx, this.tools.wrappingUp, { steps: WRAP_UP_STEPS, maxTokens: 4000 }, onStep);
    ctx.outcome.summary = speakable(answer.text);
    return ctx.outcome;
  }

  /** Loads the model, so the first answer of a call does not wait for it. */
  async warmUp(): Promise<void> {
    if (!this.configured) return;
    await this.llm
      .chat({ model: this.model, reasoning: 'none', maxTokens: 1, timeoutMs: 60_000, messages: [{ role: 'user', content: 'Hallo' }] })
      .catch(() => undefined);
  }

  /** Lets the model call tools until it answers in words. */
  private async run(
    ctx: CallContext,
    tools: CallTool[],
    options: { steps: number; maxTokens: number; mayHangUp?: boolean },
    onStep: (label: string) => void,
  ): Promise<CallReply> {
    const messages = ctx.call.messages;
    for (let step = 0; step <= options.steps; step++) {
      const answer = await this.llm.chat({
        model: this.model,
        messages,
        // Out of steps: without tools the model has to come to an end
        tools: step < options.steps ? tools.map((tool) => tool.spec) : undefined,
        maxTokens: options.maxTokens,
        temperature: 0.3,
        // Somebody is waiting: thinking turns one second per answer into ten and did not change the results
        reasoning: 'none',
      });
      messages.push(answer.message);
      if (!answer.toolCalls.length) return { text: answer.content, hangup: false };

      let goodbye: string | null = null;
      for (const call of answer.toolCalls) {
        const tool = tools.find((t) => t.spec.name === call.name);
        let result: unknown;
        if (!tool) {
          result = { fehler: `Das Werkzeug ${call.name} gibt es hier nicht.` };
        } else if (call.name === HANG_UP && !options.mayHangUp) {
          result = { fehler: 'Der Anrufer hat sich nicht verabschiedet. Antworte ihm und frag, ob noch etwas ist.' };
        } else {
          const label = tool.label(call.args);
          if (label) onStep(label);
          try {
            result = await tool.run(call.args, ctx);
          } catch (err) {
            this.logger.warn(`Tool ${call.name} failed in call ${ctx.call.id}: ${(err as Error).message}`);
            result = { fehler: 'Das hat gerade nicht geklappt.' };
          }
          if (call.name === HANG_UP) goodbye = typeof call.args.abschied === 'string' ? call.args.abschied : answer.content;
        }
        messages.push(toolResult(call.id, result));
      }
      if (goodbye !== null) return { text: goodbye || 'Alles klar, bis bald!', hangup: true };
    }
    return { text: '', hangup: false };
  }
}

function toolResult(callId: string, result: unknown): ChatMessage {
  return { role: 'tool', tool_call_id: callId, content: JSON.stringify(result) };
}

/** Models like to format; a voice reads "Sternchen Sternchen" out loud. */
function speakable(value: string): string {
  return value
    .replace(/[*_#`>]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);
}

function systemPrompt(user: User, companies: GroupCompany[], zone: string, now: Date): string {
  const name = user.firstName.trim() || 'der Anrufer';
  const us = companies.length
    ? companies.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')
    : '- (keine Firmen hinterlegt)';
  return `Du bist Cherry, die Sprachassistentin im CRM „Cherrypick“. ${`${user.firstName} ${user.lastName}`.trim() || user.email} arbeitet im Vertrieb und ruft dich an, um von Kundenkontakten zu erzählen, zum Beispiel von einem Gespräch auf einer Messe, oder um einen neuen Kunden anlegen zu lassen. Aus dem Anruf entstehen Einträge im CRM und Aufgaben für ${name}.

Wir, das sind die Firmen dieser Gruppe:
${us}

Heute ist ${describeNow(zone, now)} (${isoDate(zone, now)}).

So führst du den Anruf:
- Was ${name} sagt, kommt aus einer Spracherkennung. Namen können falsch geschrieben sein; im Zweifel gilt die Schreibweise aus dem CRM.
- Fällt der Name einer Firma oder Person, schau mit kunden_suchen nach, ob es sie schon gibt. Jeden Namen nur einmal suchen.
- Fragt ${name} nach unseren Produkten, Leistungen oder Preisen, nutze wissen_suchen.
- Antworte wie am Telefon: ein bis zwei kurze Sätze, per Du, ohne Aufzählungen, Sonderzeichen oder Emojis. Deine Antwort wird vorgelesen.
- Sag knapp, was du verstanden hast und was du daraus machst: Kunde anlegen oder ergänzen, das Gespräch notieren, welche Aufgaben du vorbereitest. Wiederhole nicht alles.
- Stelle höchstens eine Rückfrage pro Antwort und nur, wenn etwas Wichtiges fehlt: wie die Person heißt, zu welcher Firma sie gehört oder was als Nächstes passieren soll. Nach Mailadresse oder Telefonnummer fragst du höchstens einmal im ganzen Anruf. Frag nichts, was schon gesagt wurde, und frag nicht nach, wenn alles klar ist.
- Während des Anrufs speicherst du nichts. Angelegt wird erst nach dem Auflegen, sag also „ich lege an“ und nicht „ich habe angelegt“.
- Auflegen: Nur wenn ${name} sich verabschiedet oder sagt, dass nichts mehr kommt („das war's“, „nein danke“, „tschüss“), rufst du ${HANG_UP} auf. Nie von dir aus, auch wenn alles klar ist: Dann fragst du, ob noch etwas ist.`;
}

function wrapUpPrompt(user: User): string {
  const name = user.firstName.trim() || 'der Anrufer';
  return `[Der Anruf ist beendet, ${name} hört dich nicht mehr.]

Setze jetzt um, was besprochen wurde:
1. Rufe für jeden Kunden, um den es ging, einmal kunde_speichern auf, auch wenn es ihn schon gibt (dann mit seiner id aus kunden_suchen), damit die Notiz zum Gespräch an ihm hängt. Kennst du die id nicht, such vorher mit kunden_suchen. Trage nur ein, was im Anruf gesagt wurde; erfinde keine Adressen, Mailadressen, Telefonnummern oder Positionen.
2. Lege für jeden nächsten Schritt, den ${name} genannt hat oder der sich klar aus dem Gespräch ergibt, mit aufgabe_anlegen eine Aufgabe an, eine pro Schritt. Schreibe den Entwurf so, dass ${name} ihn nur noch freigeben muss: Mails mit Anrede, zwei bis drei kurzen Absätzen und dem Gruß „Viele Grüße“ und „${name}“ in der Zeile darunter, für Anrufe einen Leitfaden mit drei bis vier nummerierten Punkten. Sieze den Kunden, außer ${name} duzt ihn erkennbar. Geht es um unsere Produkte oder Leistungen, hol dir die Fakten vorher mit wissen_suchen. In den Entwurf gehört nur, was dort steht oder im Anruf gesagt wurde: keine erfundenen Preise, Termine, Zusagen, Vorteile oder Anhänge. Fehlt etwas, das ${name} noch eintragen muss, setze einen Platzhalter in eckige Klammern, zum Beispiel [Preis]. Die begruendung sprichst du ${name} per Du an.
3. Antworte am Ende mit ein bis zwei Sätzen an ${name}: wen du angelegt oder ergänzt hast und welche Aufgaben jetzt unter „Heute“ warten. Nenne Termine so, wie aufgabe_anlegen sie zurückmeldet.

Werkzeuge, die nicht aufeinander warten müssen, rufst du im selben Schritt auf. Wurde nichts Verwertbares gesagt, lege nichts an und sag das in einem Satz.`;
}
