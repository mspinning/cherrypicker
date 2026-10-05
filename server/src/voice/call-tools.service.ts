import { Injectable } from '@nestjs/common';
import { CaptureInput, CrmCaptureService } from '../crm/crm-capture.service';
import { CrmLookupService } from '../crm/crm-lookup.service';
import { CrmRelationship } from '../crm/entities/crm-company.entity';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import { ToolSpec } from '../llm/llm.service';
import { clamp, list, multiline, phone, record, text, uuid, website } from '../llm/tool-args';
import { cleanAddress } from '../mail-import/addresses';
import { TaskKind } from '../tasks/entities/task.entity';
import { TasksService } from '../tasks/tasks.service';
import { User } from '../users/user.entity';
import { VoiceCall, VoiceCallResult } from './entities/voice-call.entity';
import { nextOfficeHour, onWorkday, resolveDay, shortDateTime, spokenDateTime } from './local-time';

/** What a tool needs to know about the call it runs in. */
export interface CallContext {
  call: VoiceCall;
  user: User;
  now: Date;
  /** Filled by the tools that write: what the caller sees after hanging up */
  outcome: VoiceCallResult;
}

export interface CallTool {
  spec: ToolSpec;
  /** What the caller reads while the tool runs */
  label(args: Record<string, unknown>): string;
  /** The result goes back to the model as JSON */
  run(args: Record<string, unknown>, ctx: CallContext): Promise<unknown>;
}

/** Handled by the agent itself: the model says goodbye and the call ends */
export const HANG_UP = 'anruf_beenden';

const KNOWLEDGE_HITS = 4;
const KNOWLEDGE_CHARS = 800;
const MAX_VOCABULARY = 60;

/** How a day is named on the phone; `resolveDay` turns it into a date */
const DAYS = ['heute', 'morgen', 'uebermorgen', 'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const WEEKS = ['diese', 'naechste', 'uebernaechste'] as const;
const WEEKDAY_WORD = /montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag/i;

const TASK_KINDS: Record<string, TaskKind> = {
  mail: TaskKind.Mail,
  anruf: TaskKind.Call,
  angebot: TaskKind.Offer,
  termin: TaskKind.Meeting,
};

/**
 * The hands of the call agent. While the caller talks it may only look
 * things up; customers and tasks are written after they hung up, so a name
 * the caller corrects mid-call never reaches the CRM.
 */
@Injectable()
export class CallTools {
  /** For the conversation */
  readonly talking: CallTool[];
  /** For the work after the call */
  readonly wrappingUp: CallTool[];

  constructor(
    private readonly lookup: CrmLookupService,
    private readonly capture: CrmCaptureService,
    private readonly knowledge: KnowledgeSearchService,
    private readonly tasks: TasksService,
  ) {
    const findCustomers = this.findCustomers();
    const searchKnowledge = this.searchKnowledge();
    this.talking = [findCustomers, searchKnowledge, this.hangUp()];
    this.wrappingUp = [findCustomers, searchKnowledge, this.saveCustomer(), this.createTask()];
  }

  private findCustomers(): CallTool {
    return {
      spec: {
        name: 'kunden_suchen',
        description:
          'Schaut im CRM nach, ob es eine Firma oder Person schon gibt. Findet auch ähnlich geschriebene Namen. Liefert Treffer mit ihrer id.',
        parameters: {
          type: 'object',
          properties: {
            firma: { type: 'string', description: 'Firmenname, ohne Rechtsform' },
            person: { type: 'string', description: 'Vor- und Nachname oder nur der Nachname' },
          },
        },
      },
      label: (args) => `Suche ${[text(args.firma, 80), text(args.person, 80)].filter(Boolean).join(' · ') || 'Kunden'} im CRM`,
      run: async (args, ctx) => {
        const company = text(args.firma, 200);
        const person = text(args.person, 200);
        if (!company && !person) return { fehler: 'Gib firma oder person an.' };
        const found = await this.lookup.find({ company, person });
        remember(ctx.call, [...found.companies.map((c) => c.name), ...found.contacts.map((k) => k.fullName)]);
        return {
          firmen: found.companies.map((c) => ({
            id: c.id,
            name: c.name,
            beziehung: c.relationship === CrmRelationship.Customer ? 'Kunde' : 'Interessent',
            ...(c.industry ? { branche: c.industry } : {}),
            ...(c.city ? { ort: c.city } : {}),
            ansprechpartner: c.contacts.map((k) => ({ id: k.id, name: k.fullName, ...(k.jobTitle ? { position: k.jobTitle } : {}) })),
          })),
          personen: found.contacts.map((k) => ({
            id: k.id,
            name: k.fullName,
            ...(k.jobTitle ? { position: k.jobTitle } : {}),
            ...(k.email ? { email: k.email } : {}),
            ...(k.company ? { firma: k.company.name, firma_id: k.company.id } : {}),
          })),
          ...(found.companies.length || found.contacts.length ? {} : { hinweis: 'Nichts gefunden, also neu für das CRM.' }),
        };
      },
    };
  }

  private searchKnowledge(): CallTool {
    return {
      spec: {
        name: 'wissen_suchen',
        description:
          'Sucht in unserer Wissensbasis: was wir anbieten, Leistungen, Produkte, Preise, Referenzen. Für Fragen des Anrufers und für die Fakten in Mail-Entwürfen.',
        parameters: {
          type: 'object',
          properties: { frage: { type: 'string', description: 'Wonach gesucht wird, als Frage oder Stichworte' } },
          required: ['frage'],
        },
      },
      label: () => 'Schaue in der Wissensbasis nach',
      run: async (args) => {
        const query = text(args.frage, 1000);
        if (!query) return { fehler: 'Die frage fehlt.' };
        const { hits } = await this.knowledge.search({ query, limit: KNOWLEDGE_HITS });
        return {
          treffer: hits.map((hit) => ({
            quelle: hit.source.title,
            firma: hit.company.name,
            text: hit.content.length > KNOWLEDGE_CHARS ? `${hit.content.slice(0, KNOWLEDGE_CHARS)} …` : hit.content,
          })),
          ...(hits.length ? {} : { hinweis: 'Dazu steht nichts in der Wissensbasis.' }),
        };
      },
    };
  }

  private hangUp(): CallTool {
    return {
      spec: {
        name: HANG_UP,
        description: 'Beendet den Anruf, wenn der Anrufer fertig ist oder sich verabschiedet. Danach werden Kunden und Aufgaben angelegt.',
        parameters: {
          type: 'object',
          properties: { abschied: { type: 'string', description: 'Ein kurzer Satz zum Abschied, der noch vorgelesen wird' } },
          required: ['abschied'],
        },
      },
      label: () => '',
      run: () => Promise.resolve({ aufgelegt: true }),
    };
  }

  private saveCustomer(): CallTool {
    return {
      spec: {
        name: 'kunde_speichern',
        description:
          'Legt einen Kunden im CRM an oder ergänzt ihn (Firma und/oder Ansprechpartner) und hängt die Notiz zum Gespräch an. Vorhandene Angaben werden nie überschrieben. Einmal pro Kunde aufrufen.',
        parameters: {
          type: 'object',
          properties: {
            firma: {
              type: 'object',
              description: 'Die Organisation; bei Privatpersonen weglassen',
              properties: {
                id: { type: 'string', description: 'id aus kunden_suchen, wenn es die Firma schon gibt' },
                name: { type: 'string', description: 'Firmenname, mit Rechtsform, falls genannt' },
                beziehung: {
                  type: 'string',
                  enum: ['kunde', 'interessent'],
                  description: 'kunde: kauft schon bei uns. interessent: hat Interesse, aber noch keinen Auftrag',
                },
                branche: { type: 'string' },
                beschreibung: { type: 'string', description: 'Was die Firma macht, ein Satz' },
                webseite: { type: 'string' },
                telefon: { type: 'string' },
                strasse: { type: 'string' },
                plz: { type: 'string' },
                ort: { type: 'string' },
                land: { type: 'string' },
              },
            },
            kontakt: {
              type: 'object',
              description: 'Die Person, um die es ging',
              properties: {
                id: { type: 'string', description: 'id aus kunden_suchen, wenn es die Person schon gibt' },
                vorname: { type: 'string' },
                nachname: { type: 'string' },
                position: { type: 'string' },
                abteilung: { type: 'string' },
                email: { type: 'string' },
                telefon: { type: 'string', description: 'Festnetz' },
                mobil: { type: 'string' },
              },
            },
            notiz: {
              type: 'object',
              description: 'Was der Anrufer über das Gespräch mit dem Kunden berichtet hat',
              properties: {
                titel: { type: 'string', description: 'z. B. „Gespräch auf der Hannover Messe“' },
                text: { type: 'string', description: 'Zwei bis vier Sätze: Anlass, Interesse des Kunden, was vereinbart wurde' },
              },
              required: ['titel', 'text'],
            },
            themen: { type: 'array', items: { type: 'string' }, description: 'Bis zu drei Stichworte: Produkte oder Themen, um die es ging' },
          },
        },
      },
      label: (args) => {
        const k = record(args.kontakt);
        const name = [text(k.vorname, 60), text(k.nachname, 60)].filter(Boolean).join(' ') || text(record(args.firma).name, 80);
        return name ? `Speichere ${name} im CRM` : 'Speichere den Kunden im CRM';
      },
      run: async (args, ctx) => {
        const f = record(args.firma);
        const k = record(args.kontakt);
        const n = record(args.notiz);
        const email = text(k.email, 320);
        const company: NonNullable<CaptureInput['company']> = {
          id: uuid(f.id),
          name: text(f.name, 200),
          relationship: f.beziehung === 'kunde' ? CrmRelationship.Customer : f.beziehung === 'interessent' ? CrmRelationship.Prospect : undefined,
          industry: text(f.branche, 150),
          description: text(f.beschreibung, 1000),
          website: website(f.webseite),
          phone: phone(f.telefon),
          street: text(f.strasse, 200),
          postalCode: text(f.plz, 20),
          city: text(f.ort, 120),
          country: text(f.land, 80),
        };
        const contact: NonNullable<CaptureInput['contact']> = {
          id: uuid(k.id),
          firstName: text(k.vorname, 100),
          lastName: text(k.nachname, 100),
          jobTitle: text(k.position, 150),
          department: text(k.abteilung, 150),
          email: (email && cleanAddress(email)) || undefined,
          phone: phone(k.telefon),
          mobile: phone(k.mobil),
        };
        const hasCompany = !!(company.id || company.name);
        const hasContact = !!(contact.id || contact.firstName || contact.lastName || contact.email);
        if (!hasCompany && !hasContact) return { fehler: 'Es fehlt der Firmenname oder der Name der Person.' };

        const title = text(n.titel, 200);
        const body = multiline(n.text, 2000);
        const saved = await this.capture.capture({
          userId: ctx.user.id,
          at: ctx.call.startedAt,
          company: hasCompany ? company : undefined,
          contact: hasContact ? contact : undefined,
          topics: list(args.themen, 3, 60),
          note: title && body ? { title, text: body, externalId: `voice:${ctx.call.id}:${ctx.outcome.customers.length + 1}` } : undefined,
        });
        if (!saved.company && !saved.contact) return { fehler: 'Für eine neue Person braucht es mindestens einen Namen.' };

        const known = ctx.outcome.customers.find(
          (c) => (c.company?.id ?? null) === (saved.company?.id ?? null) && (c.contact?.id ?? null) === (saved.contact?.id ?? null),
        );
        // A second call for the same customer does not make them "known before the call"
        if (known) known.note ??= saved.noteSaved ? title! : null;
        else ctx.outcome.customers.push({ company: saved.company, contact: saved.contact, note: saved.noteSaved ? title! : null });
        return {
          gespeichert: true,
          ...(saved.company ? { firma: { id: saved.company.id, name: saved.company.name, neu: saved.company.created } } : {}),
          ...(saved.contact ? { kontakt: { id: saved.contact.id, name: saved.contact.fullName, neu: saved.contact.created } } : {}),
          notiz: saved.noteSaved,
        };
      },
    };
  }

  private createTask(): CallTool {
    return {
      spec: {
        name: 'aufgabe_anlegen',
        description:
          'Legt für den Anrufer eine Aufgabe an: einen nächsten Schritt mit einem Kunden samt fertigem Entwurf. Sie erscheint bei ihm unter „Heute“ und er gibt sie frei oder verwirft sie.',
        parameters: {
          type: 'object',
          properties: {
            art: {
              type: 'string',
              enum: Object.keys(TASK_KINDS),
              description: 'mail: eine Mail schreiben. anruf: anrufen. angebot: ein Angebot schicken. termin: einen Termin vereinbaren',
            },
            titel: { type: 'string', description: 'Der Auftrag in einem Satz, z. B. „Thomas Becker Infos zur Lagerverwaltung schicken“' },
            kontakt: { type: 'string', description: 'Vor- und Nachname der Person beim Kunden' },
            position: { type: 'string', description: 'Ihre Position, falls bekannt' },
            firma: { type: 'string', description: 'Ihre Firma; bei Privatpersonen weglassen' },
            tag: {
              type: 'string',
              enum: DAYS,
              description:
                'Wann es erledigt sein soll: der Tag oder Wochentag, so wie er genannt wurde. Das Datum dazu rechnet das CRM aus. Weglassen, wenn kein Tag genannt wurde',
            },
            woche: {
              type: 'string',
              enum: WEEKS,
              description:
                'Nur zu einem Wochentag: „nächsten Mittwoch“ und „nächste Woche Mittwoch“ sind naechste, „übernächsten Freitag“ ist uebernaechste. Bei „am Freitag“ oder „bis Freitag“ weglassen',
            },
            datum: {
              type: 'string',
              description: 'Statt tag, nur wenn ein Kalenderdatum genannt wurde („am 3. November“, „Ende des Monats“): JJJJ-MM-TT. Nie für Wochentage',
            },
            in_tagen: { type: 'integer', description: 'Statt tag, nur bei einer Frist wie „in drei Tagen“ oder „in zwei Wochen“ (14). Nie für Wochentage' },
            uhrzeit: { type: 'string', description: 'Die genannte Uhrzeit als HH:MM („halb drei“ am Nachmittag: 14:30). Weglassen, wenn keine genannt wurde' },
            betreff: { type: 'string', description: 'Betreff der Mail oder Einladung; bei Anrufen weglassen' },
            entwurf: {
              type: 'string',
              description: 'Der fertige Text: bei mail, angebot und termin die Mail mit Anrede und Gruß, bei anruf ein Leitfaden mit nummerierten Punkten',
            },
            begruendung: { type: 'string', description: 'Ein bis zwei Sätze an den Anrufer, per Du: warum diese Aufgabe jetzt sinnvoll ist („Du hast … zugesagt“)' },
            zitat: { type: 'string', description: 'Die Stelle aus dem Anruf, auf die sie zurückgeht, möglichst wörtlich' },
            sicherheit: {
              type: 'integer',
              description: 'Wie sicher der Anrufer das will, 0 bis 100: ab 90, wenn er es ausdrücklich gesagt hat, 60 bis 80, wenn es nur naheliegt',
            },
            deal_wert: { type: 'string', description: 'Nur wenn ein Betrag genannt wurde, z. B. „48.000 €“' },
            phase: { type: 'string', description: 'Stand der Beziehung in ein, zwei Worten, z. B. „Erstkontakt“, „Angebot“, „Verlängerung“' },
          },
          required: ['art', 'titel', 'kontakt', 'entwurf', 'begruendung'],
        },
      },
      label: (args) => `Lege Aufgabe an: ${text(args.titel, 80) ?? '…'}`,
      run: async (args, ctx) => {
        const kind = TASK_KINDS[String(args.art).toLowerCase()];
        const title = text(args.titel, 300);
        const draft = multiline(args.entwurf, 20_000);
        const company = text(args.firma, 200);
        const contact = text(args.kontakt, 200) ?? company;
        if (!kind) return { fehler: `art muss eines von ${Object.keys(TASK_KINDS).join(', ')} sein.` };
        if (!title || !draft || !contact) return { fehler: 'titel, kontakt und entwurf sind Pflicht.' };
        if (ctx.outcome.tasks.some((t) => t.kind === kind && t.title.toLowerCase() === title.toLowerCase())) {
          return { hinweis: 'Diese Aufgabe gibt es aus diesem Anruf schon.' };
        }

        const zone = ctx.call.timeZone;
        const quote = text(args.zitat, 400);
        const named = DAYS.find((d) => d === String(args.tag).toLowerCase());
        const inDays = Number.isInteger(args.in_tagen) && Number(args.in_tagen) >= 0 && Number(args.in_tagen) < 1000 ? `+${args.in_tagen}` : undefined;
        const day = named ?? text(args.datum, 40) ?? inDays;
        // Models count days instead of naming them, and count wrong: "Thursday next week" came back as Monday
        if (!named && day && WEEKDAY_WORD.test(`${quote} ${title}`)) {
          return { fehler: 'Im Anruf wurde ein Wochentag genannt. Gib ihn als tag an, mit woche, statt datum oder in_tagen.' };
        }
        const parsed = day ? resolveDay(zone, ctx.now, { day, week: WEEKS.find((w) => w === args.woche), time: text(args.uhrzeit, 10) }) : null;
        // Guessing a day would put the task on the wrong one without anybody noticing
        if (day && !parsed) return { fehler: 'datum muss die Form JJJJ-MM-TT haben.' };
        const wanted = parsed && onWorkday(zone, parsed);
        const dueAt = wanted && wanted > ctx.now ? wanted : nextOfficeHour(zone, ctx.now);
        const confidence = clamp(Number(args.sicherheit), 85);
        const reason = multiline(args.begruendung, 1000) ?? '';

        const task = await this.tasks.create(ctx.user.id, {
          kind,
          title,
          contactName: contact,
          contactRole: text(args.position, 150) ?? null,
          companyName: company ?? null,
          dealValue: text(args.deal_wert, 60) ?? null,
          stage: text(args.phase, 60) ?? null,
          lastContactAt: ctx.call.startedAt,
          confidence,
          dueAt,
          subject: kind === TaskKind.Call ? null : (text(args.betreff, 300) ?? null),
          draft,
          summary: reason,
          evidence: [{ source: 'Dein Anruf', text: quote ? `„${quote.replace(/^[„"“]+|[“"”]+$/g, '')}“` : reason, weight: confidence }],
          approvalNote: `Aus deinem Anruf mit Cherry vom ${shortDateTime(zone, ctx.call.startedAt)}. Mit der Freigabe ist die Aufgabe eingeplant; verschickt oder gebucht wird noch nichts von allein.`,
        });
        ctx.outcome.tasks.push({
          id: task.id,
          kind: task.kind,
          title: task.title,
          contactName: task.contactName,
          companyName: task.companyName,
          dueAt: task.dueAt.toISOString(),
        });
        return { angelegt: true, faellig: spokenDateTime(zone, dueAt) };
      },
    };
  }
}

/** Names that came up: the transcription spells them right from now on. */
function remember(call: VoiceCall, names: string[]): void {
  call.vocabulary = [...new Set([...names, ...call.vocabulary])].slice(0, MAX_VOCABULARY);
}
