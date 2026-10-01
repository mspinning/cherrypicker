import { Injectable } from '@nestjs/common';
import { PartyEvidence, PartyFacts } from '../crm/crm-merge.service';
import { CrmRelationship } from '../crm/entities/crm-company.entity';
import { LlmService, ToolSpec } from '../llm/llm.service';
import { cleanMailText } from './mail-text';

export const VERDICTS = [
  'customer',
  'prospect',
  'partner',
  'vendor',
  'notification',
  'newsletter',
  'internal',
  'private',
  'unknown',
] as const;
export type Verdict = (typeof VERDICTS)[number];

/** Below this the import rather skips a counterpart than creating a wrong customer */
export const MIN_CONFIDENCE = 0.6;
const OTHER_SUBJECTS = 15;

export interface ClassifierContext {
  ownerName: string;
  ownerEmail: string;
  groupCompanies: { name: string; description: string }[];
}

export interface CounterpartInput {
  domain: string | null;
  label: string;
  inbound: number;
  outbound: number;
  firstAt: Date;
  lastAt: Date;
  participants: PartyEvidence['participants'];
  messages: PartyEvidence['messages'];
}

export interface Assessment {
  verdict: Verdict;
  confidence: number;
  reason: string;
  facts: Omit<PartyFacts, 'relationship'>;
}

const DATE = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });

const TOOL: ToolSpec = {
  name: 'record_assessment',
  description: 'Speichert die Einordnung der Gegenseite und die Stammdaten aus den Mails.',
  parameters: {
    type: 'object',
    properties: {
      relationship: {
        type: 'string',
        enum: [...VERDICTS],
        description: 'Beziehung der Gruppe zur Gegenseite',
      },
      confidence: {
        type: 'number',
        description: 'Sicherheit der Einordnung zwischen 0 und 1',
      },
      reason: {
        type: 'string',
        description: 'Ein Satz: woran die Beziehung erkennbar ist',
      },
      company: {
        type: 'object',
        description: 'Organisation der Gegenseite; Felder leer lassen, wenn sie nicht in den Mails stehen',
        properties: {
          name: { type: 'string', description: 'Offizieller Firmenname inkl. Rechtsform, z. B. aus der Signatur' },
          website: { type: 'string' },
          industry: { type: 'string', description: 'Branche in wenigen Worten' },
          description: { type: 'string', description: 'Was die Firma macht, ein Satz' },
          phone: { type: 'string', description: 'Zentrale Telefonnummer' },
          street: { type: 'string' },
          postal_code: { type: 'string' },
          city: { type: 'string' },
          country: { type: 'string' },
        },
      },
      contacts: {
        type: 'array',
        description: 'Echte Personen der Gegenseite, nur mit Adressen aus der Liste der Beteiligten',
        items: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            job_title: { type: 'string' },
            department: { type: 'string' },
            phone: { type: 'string' },
            mobile: { type: 'string' },
            linkedin_url: { type: 'string' },
          },
          required: ['email'],
        },
      },
      summary: {
        type: 'string',
        description: '1–3 Sätze: worum es in der Geschäftsbeziehung geht und wie der aktuelle Stand ist',
      },
      topics: {
        type: 'array',
        items: { type: 'string' },
        description: 'Bis zu 5 Stichworte zu Themen, Produkten oder Projekten',
      },
    },
    required: ['relationship', 'confidence', 'reason'],
  },
};

/**
 * Decides with the LLM whether a mail counterpart is a customer of the group
 * and reads company and contact data from signatures. Strictly validates the
 * answer: only addresses that really appear in the mails become contacts.
 */
@Injectable()
export class RelationshipClassifier {
  constructor(private readonly llm: LlmService) {}

  get configured(): boolean {
    return this.llm.configured;
  }

  get model(): string {
    return this.llm.model;
  }

  async assess(ctx: ClassifierContext, input: CounterpartInput, texts: Map<string, string>): Promise<Assessment> {
    const raw = await this.llm.callTool({
      system: systemPrompt(ctx),
      user: userPrompt(input, texts),
      tool: TOOL,
    });
    return sanitize(raw, new Set(input.participants.map((p) => p.email)));
  }
}

/**
 * Mails the LLM reads in full: the newest from the counterpart (their
 * signatures carry title, phone, address) and the newest from us (what we
 * do for them).
 */
export function pickMessages(messages: PartyEvidence['messages'], inbound = 4, outbound = 2): PartyEvidence['messages'] {
  const picked = [
    ...messages.filter((m) => m.direction === 'in').slice(0, inbound),
    ...messages.filter((m) => m.direction === 'out').slice(0, outbound),
  ];
  return picked.sort((a, b) => b.at.localeCompare(a.at));
}

function systemPrompt(ctx: ClassifierContext): string {
  const companies = ctx.groupCompanies.length
    ? ctx.groupCompanies.map((c) => `- ${c.name}${c.description ? `: ${c.description}` : ''}`).join('\n')
    : '- (keine Firmen hinterlegt)';
  return `Du pflegst ein B2B-CRM. Das Postfach gehört ${ctx.ownerName} <${ctx.ownerEmail}>. Wir, das sind die Firmen dieser Gruppe:
${companies}

Du bekommst den Mailverkehr mit EINER Gegenseite (eine Organisation oder eine Einzelperson) und entscheidest, welche Beziehung wir zu ihr haben.

Kategorien:
- customer: kauft oder kaufte bei uns. Erkennbar an Aufträgen, laufenden Projekten, Abstimmungen zur Umsetzung, Rechnungen oder Angeboten VON UNS an sie, Support, den wir leisten.
- prospect: konkretes Interesse an unseren Leistungen, aber noch kein Auftrag erkennbar. Erkennbar an Anfragen an uns, Angeboten von uns, Terminen zur Bedarfsklärung.
- partner: arbeitet mit uns zusammen, ohne bei uns zu kaufen (Kooperation, Subunternehmer, Reseller, Freelancer für uns).
- vendor: verkauft uns etwas oder erbringt Leistungen für uns. Software und SaaS (z. B. OpenAI, GitHub, Microsoft), Hosting, Steuerberatung, Agenturen, Recruiter, Versicherungen, Banken, Kaltakquise an uns.
- notification: automatische System-, Konto-, Sicherheits-, Rechnungs- oder Versandmails.
- newsletter: Newsletter, Marketing, Einladungen zu Events oder Webinaren.
- internal: gehört zu unserer Gruppe.
- private: privater Kontakt ohne geschäftlichen Bezug.
- unknown: zu wenig Hinweise für eine Einordnung.

Regeln:
- Ins CRM kommen nur echte Kundenbeziehungen (customer, prospect). Im Zweifel nimm unknown: ein übersehener Kunde ist weniger schlimm als ein Dienstleister im CRM.
- Wer uns etwas verkaufen will, ist vendor, nie prospect. Rechnungen AN uns sprechen für vendor, Rechnungen VON uns für customer.
- confidence: 0.9 und mehr nur bei eindeutigen Belegen, 0.6 bis 0.8 bei klaren Indizien, darunter bei Vermutungen.
- Übernimm nur Angaben, die in den Mails stehen (Signaturen, Kopfzeilen, Text). Erfinde nichts und rate keine Adressen, Telefonnummern oder Webseiten. Lass unbekannte Felder weg.
- contacts: nur echte Personen der Gegenseite mit einer Adresse aus der Liste „Beteiligte der Gegenseite“. Keine Sammeladressen (info@, rechnung@, support@) und niemand aus unserer Gruppe. Namen und Positionen aus der Signatur übernehmen.
- reason und summary auf Deutsch, sachlich, ohne Floskeln. Keine vertraulichen Details wie Preise oder Passwörter in die summary.
- Antworte ausschließlich über das Tool ${TOOL.name}.`;
}

function userPrompt(input: CounterpartInput, texts: Map<string, string>): string {
  const lines: string[] = [];
  lines.push('## Gegenseite');
  lines.push(input.domain ? `Domain: ${input.domain}` : `Einzelperson mit privater Mailadresse: ${input.label}`);
  lines.push(
    `Mails: ${input.inbound} von der Gegenseite, ${input.outbound} von uns an sie, ${DATE.format(input.firstAt)} bis ${DATE.format(input.lastAt)}`,
  );
  lines.push('', 'Beteiligte der Gegenseite:');
  for (const p of input.participants.slice(0, 25)) {
    lines.push(`- ${p.name ? `${p.name} ` : ''}<${p.email}>: schrieb uns ${p.inbound}, bekam von uns ${p.outbound}`);
  }

  const read = new Set(texts.keys());
  const full = input.messages.filter((m) => read.has(m.id));
  if (full.length) {
    lines.push('', '## Mails (neueste zuerst)');
    for (const m of full) {
      lines.push(
        '',
        `### ${m.direction === 'in' ? 'Eingang' : 'Ausgang'} · ${DATE.format(new Date(m.at))} · von ${m.from} an ${m.to.slice(0, 4).join(', ')}${m.to.length > 4 ? ' …' : ''}`,
        `Betreff: ${m.subject || '(ohne Betreff)'}`,
        texts.get(m.id) || m.preview,
      );
    }
  }

  const others = input.messages.filter((m) => !read.has(m.id)).slice(0, OTHER_SUBJECTS);
  if (others.length) {
    lines.push('', '## Weitere Mails (nur Betreff und Anfang)');
    for (const m of others) {
      lines.push(`- ${m.direction === 'in' ? 'Eingang' : 'Ausgang'} ${DATE.format(new Date(m.at))}: ${m.subject || '(ohne Betreff)'} – ${m.preview.slice(0, 140)}`);
    }
  }
  return lines.join('\n');
}

/** Graph text bodies of the picked mails, cleaned for the prompt. */
export function promptTexts(raw: Map<string, { unique: string; full: string }>): Map<string, string> {
  return new Map([...raw].map(([id, body]) => [id, cleanMailText(body.unique, body.full)]));
}

// ---------- Validation ----------

function str(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || /^(n\/?a|unbekannt|unknown|null|none|-|–)$/i.test(text)) return undefined;
  return text.slice(0, max);
}

function phone(value: unknown): string | undefined {
  const text = str(value, 60);
  return text && /\d{4,}/.test(text.replace(/[\s()./-]/g, '')) ? text : undefined;
}

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function website(value: unknown): string | undefined {
  const text = str(value, 300);
  if (!text || /\s|@/.test(text)) return undefined;
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    return url.hostname.includes('.') ? `${url.protocol}//${url.hostname}${url.pathname === '/' ? '' : url.pathname}` : undefined;
  } catch {
    return undefined;
  }
}

function sanitize(raw: Record<string, unknown>, participants: Set<string>): Assessment {
  const verdict = (VERDICTS as readonly string[]).includes(String(raw.relationship)) ? (raw.relationship as Verdict) : 'unknown';
  const confidenceRaw = typeof raw.confidence === 'number' ? raw.confidence : Number(raw.confidence);
  const confidence = Number.isFinite(confidenceRaw) ? Math.min(1, Math.max(0, confidenceRaw > 1 ? confidenceRaw / 100 : confidenceRaw)) : 0.5;

  const c = (raw.company && typeof raw.company === 'object' ? raw.company : {}) as Record<string, unknown>;
  const company = {
    name: str(c.name, 200),
    website: website(c.website),
    industry: str(c.industry, 150),
    description: str(c.description, 1000),
    phone: phone(c.phone),
    street: str(c.street, 200),
    postalCode: str(c.postal_code, 20),
    city: str(c.city, 120),
    country: str(c.country, 80),
  };

  const seen = new Set<string>();
  const contacts: PartyFacts['contacts'] = [];
  for (const item of Array.isArray(raw.contacts) ? raw.contacts.slice(0, 40) : []) {
    if (!item || typeof item !== 'object') continue;
    const k = item as Record<string, unknown>;
    const email = typeof k.email === 'string' ? k.email.trim().toLowerCase() : '';
    // Only addresses from the mails: the model must not invent or swap them
    if (!participants.has(email) || seen.has(email)) continue;
    seen.add(email);
    const linkedin = str(k.linkedin_url, 300);
    const landline = phone(k.phone);
    const mobile = phone(k.mobile);
    contacts.push({
      email,
      firstName: str(k.first_name, 100),
      lastName: str(k.last_name, 100),
      jobTitle: str(k.job_title, 150),
      department: str(k.department, 150),
      phone: landline,
      // The same number in both fields is the one from the signature, not a mobile
      mobile: mobile && digits(mobile) !== digits(landline ?? '') ? mobile : undefined,
      linkedinUrl: linkedin && /linkedin\.com\//i.test(linkedin) ? website(linkedin) : undefined,
    });
  }

  const topics = (Array.isArray(raw.topics) ? raw.topics : [])
    .map((t) => str(t, 60))
    .filter((t): t is string => !!t)
    .slice(0, 6);

  return {
    verdict,
    confidence,
    reason: str(raw.reason, 500) ?? '',
    facts: {
      company: Object.values(company).some(Boolean) ? company : null,
      contacts,
      summary: str(raw.summary, 1200),
      topics,
    },
  };
}

export function isCustomerVerdict(verdict: string): verdict is CrmRelationship {
  return verdict === CrmRelationship.Customer || verdict === CrmRelationship.Prospect;
}
