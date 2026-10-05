import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CrmMergeService, MergeResult, PartyEvidence } from '../crm/crm-merge.service';
import { CrmActivity, CrmActivityDirection } from '../crm/entities/crm-activity.entity';
import { CrmCompanyDomain } from '../crm/entities/crm-company-domain.entity';
import { CrmCompany, CrmRelationship } from '../crm/entities/crm-company.entity';
import { CrmContact } from '../crm/entities/crm-contact.entity';
import { CrmNote } from '../crm/entities/crm-note.entity';
import { CrmPartyDecision, PartyDecider } from '../crm/entities/crm-party-decision.entity';
import { parseDisplayName } from '../crm/people';
import { GraphAddress, GraphClient, GraphMessage } from '../integrations/microsoft/graph-client.service';
import { KnowledgeSearchService } from '../knowledge/knowledge-search.service';
import { LlmAnswerError } from '../llm/llm.service';
import { cleanAddress, domainOf, isAutomatedAddress, isKnownService, registrableDomain } from '../mail-import/addresses';
import { MailAggregator, MailGroup, partyOf, ScanContext } from '../mail-import/mail-aggregator';
import { cleanMailText, quotedHistory } from '../mail-import/mail-text';
import { MailboxContext } from '../mail-import/mailbox-context.service';
import {
  Assessment,
  ClassifierContext,
  isCustomerVerdict,
  MIN_CONFIDENCE,
  pickMessages,
  promptTexts,
  RelationshipClassifier,
} from '../mail-import/relationship-classifier.service';
import { Task, TaskEvidence, TaskStatus } from '../tasks/entities/task.entity';
import { NewTask, TasksService } from '../tasks/tasks.service';
import { User } from '../users/user.entity';
import { isOfficeTime, nextOfficeHour, shortDateTime } from '../voice/local-time';
import { MailSyncItem, MailSyncOutcome, SyncDecider } from './entities/mail-sync-item.entity';
import { MailSyncState } from './entities/mail-sync-state.entity';
import { NextStepService, ProposedStep, StepInput } from './next-step.service';

/** Mail servers hand a mail over a little after the time it carries: the last minutes are read again */
const OVERLAP_MS = 5 * 60_000;
/** After a long pause (server down, sync switched off) older mails are history, not news */
const MAX_CATCH_UP_MS = 7 * 86_400_000;
const PAGE_SIZE = 100;
/** Junk, trash and unsent mail say nothing about customers */
const SKIP_FOLDERS = ['junkemail', 'deleteditems', 'drafts', 'outbox'];
/** Earlier non-customer decisions this sure are not asked again */
const MEMORY_CONFIDENCE = 0.75;
const KNOWLEDGE_HITS = 4;
const KNOWLEDGE_CHARS = 900;
const HISTORY_ITEMS = 6;
const NOTES = 3;
/** Out-of-office notes and answers to meeting invitations: written by a machine in a customer's name */
const AUTOMATIC_SUBJECT =
  /^\s*(automatische antwort|abwesenheits?notiz|abwesend|out of office|automatic reply|auto[- ]?reply|zugesagt|angenommen|abgelehnt|mit vorbehalt|accepted|declined|tentative(ly accepted)?)\s*:/i;
/** Due times are German office hours, whatever zone the server runs in */
const TIME_ZONE = 'Europe/Berlin';

type Message = PartyEvidence['messages'][number];

export interface CheckResult {
  /** Incoming mails from outside the group */
  checked: number;
  customers: number;
  tasks: number;
}

/** The user switched the sync off or disconnected the mailbox while a check ran. */
export class CheckStopped extends Error {}

/** How the counterpart of a mail stands to us. */
interface Party {
  /** Customer or prospect: its mails are worth a closer look */
  relationship: CrmRelationship | null;
  verdict: string | null;
  decidedBy: SyncDecider;
  reason: string;
  /** Set when the LLM just classified the counterpart */
  assessment: Assessment | null;
  /** What the CRM remembered about the counterpart before */
  decision: CrmPartyDecision | null;
}

interface Run {
  userId: string;
  now: Date;
  scan: ScanContext;
  /** The mails as Graph delivered them, for what the grouping drops (to and cc apart) */
  raw: Map<string, GraphMessage>;
  result: CheckResult;
  context?: Promise<{ classifier: ClassifierContext; user: User }>;
}

/**
 * One look into one mailbox: reads the mails that arrived since the last
 * look and decides for each counterpart what follows. New customers and
 * prospects go into the CRM the same way the import writes them; a mail
 * that holds an opportunity becomes a task with a drafted reply on "Heute".
 */
@Injectable()
export class MailboxCheck {
  private readonly logger = new Logger(MailboxCheck.name);

  constructor(
    @InjectRepository(MailSyncItem) private readonly items: Repository<MailSyncItem>,
    @InjectRepository(MailSyncState) private readonly states: Repository<MailSyncState>,
    @InjectRepository(CrmPartyDecision) private readonly decisions: Repository<CrmPartyDecision>,
    @InjectRepository(CrmCompany) private readonly companies: Repository<CrmCompany>,
    @InjectRepository(CrmContact) private readonly contacts: Repository<CrmContact>,
    @InjectRepository(CrmActivity) private readonly activities: Repository<CrmActivity>,
    @InjectRepository(CrmNote) private readonly notes: Repository<CrmNote>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly graph: GraphClient,
    private readonly mailbox: MailboxContext,
    private readonly classifier: RelationshipClassifier,
    private readonly merger: CrmMergeService,
    private readonly steps: NextStepService,
    private readonly knowledge: KnowledgeSearchService,
    private readonly tasks: TasksService,
  ) {}

  /** Without a chat model nothing can be decided */
  get configured(): boolean {
    return this.classifier.configured;
  }

  /**
   * Handles every mail received since `checkedUntil` that no earlier run has
   * seen. Throws when the mailbox or the LLM is not reachable; what was
   * handled until then stays handled, the rest is picked up by the next run.
   */
  async run(userId: string, checkedUntil: Date, now = new Date()): Promise<CheckResult> {
    const since = new Date(Math.max(checkedUntil.getTime() - OVERLAP_MS, now.getTime() - MAX_CATCH_UP_MS));
    const [scan, skipFolders] = await Promise.all([this.mailbox.scan(userId), this.graph.folderIds(userId, SKIP_FOLDERS)]);

    const aggregator = new MailAggregator(scan);
    const raw = new Map<string, GraphMessage>();
    for await (const page of this.graph.messages(userId, { since, pageSize: PAGE_SIZE })) {
      for (const message of page) {
        if (message.isDraft || (message.parentFolderId && skipFolders.has(message.parentFolderId))) continue;
        // Mails among colleagues and from machines involve nobody outside: they are dropped here
        if (aggregator.add(message)) raw.set(message.id, message);
      }
    }

    const run: Run = { userId, now, scan, raw, result: { checked: 0, customers: 0, tasks: 0 } };
    if (!raw.size) return run.result;

    const seen = await this.seen(userId, [...raw.keys()]);
    for (const group of aggregator.result()) {
      // A mail with several counterparts is decided once, with the one it came from (or went to first)
      const own = group.messages.filter((m) => !seen.has(m.id) && ownerOf(m, scan) === group.key);
      if (!own.length) continue;
      await this.ensureWanted(userId);
      await this.handleGroup(run, group, own);
    }
    return run.result;
  }

  // ---------- One counterpart ----------

  private async handleGroup(run: Run, group: MailGroup, own: Message[]): Promise<void> {
    // Only real people of the counterpart count as "wrote to us"
    const inbound = own.filter((m) => m.direction === 'in' && group.participants.has(m.from));
    const rest = own.filter((m) => !inbound.includes(m));

    let party: Party;
    try {
      party = await this.resolveParty(run, group);
    } catch (err) {
      if (!(err instanceof LlmAnswerError)) throw err;
      await this.record(own.map((m) => this.item(run, group, m, { outcome: MailSyncOutcome.Failed, reason: err.message })));
      await this.count(run, { checked: inbound.length });
      return;
    }
    const decided = { verdict: party.verdict, decidedBy: party.decidedBy };

    if (!party.relationship) {
      if (party.assessment) await this.remember(group, party, null);
      await this.record(own.map((m) => this.item(run, group, m, { ...decided, outcome: MailSyncOutcome.Skipped, reason: party.reason })));
      await this.count(run, { checked: inbound.length });
      return;
    }

    const merge = await this.merger.merge(
      { userId: run.userId, domain: group.domain, participants: [...group.participants.values()], messages: group.messages },
      { company: null, contacts: [], topics: [], ...party.assessment?.facts, relationship: party.relationship },
    );
    if (party.assessment) await this.remember(group, party, merge.companyId);
    // A private customer has no company; there the new person is the new customer
    const created = merge.companyCreated || (!merge.companyId && merge.contactsCreated > 0);
    const company = await this.companyOf(group, merge);
    await this.count(run, { customers: created ? 1 : 0 });

    // The first mail recorded carries the news of the new customer
    let announce = created;
    const announced = (): boolean => {
      const first = announce;
      announce = false;
      return first;
    };

    for (const mails of byConversation(inbound)) {
      const [newest, ...older] = mails;
      const handled = await this.handleMail(run, group, company, created, newest);
      const isNews = announced();
      // Nothing to do, but a new customer: that is the news of this mail, and why it is one
      const onlyNew = isNews && handled.outcome === MailSyncOutcome.None;
      await this.record([
        this.item(run, group, newest, {
          ...decided,
          outcome: onlyNew ? MailSyncOutcome.Customer : handled.outcome,
          reason: onlyNew ? party.reason || handled.reason : handled.reason,
          taskId: handled.taskId,
          companyId: company?.id ?? null,
          customerCreated: isNews,
        }),
        ...older.map((m) =>
          this.item(run, group, m, {
            ...decided,
            outcome: MailSyncOutcome.None,
            reason: 'Eine neuere Mail derselben Unterhaltung wurde geprüft.',
            companyId: company?.id ?? null,
          }),
        ),
      ]);
      await this.count(run, { checked: mails.length, tasks: handled.taskId ? 1 : 0 });
    }

    await this.record(
      rest.map((m) => {
        const isNews = announced();
        return this.item(run, group, m, {
          ...decided,
          outcome: isNews ? MailSyncOutcome.Customer : MailSyncOutcome.None,
          reason: isNews ? party.reason : null,
          companyId: company?.id ?? null,
          customerCreated: isNews,
        });
      }),
    );
  }

  /** Customer, or not worth a look? The CRM, rules and earlier decisions answer first, then the LLM. */
  private async resolveParty(run: Run, group: MailGroup): Promise<Party> {
    const decision = await this.decisions.findOneBy({ key: group.key });
    const skip = (verdict: string, decidedBy: SyncDecider, reason: string): Party => ({
      relationship: null,
      verdict,
      decidedBy,
      reason,
      assessment: null,
      decision,
    });

    if (decision?.decidedBy === PartyDecider.User) {
      return skip(decision.verdict, 'user', decision.reason || 'Aus dem CRM entfernt und für künftige Mails ignoriert.');
    }
    const known = await this.knownRelationship(group);
    if (known) return { relationship: known, verdict: known, decidedBy: 'crm', reason: 'Schon im CRM.', assessment: null, decision };

    if (group.domain && isKnownService(group.domain)) return skip('vendor', 'rule', 'Bekannter Dienst oder Anbieter.');
    if (group.outbound === 0 && group.otherInbound >= Math.max(1, group.inbound * 0.8)) {
      return skip('newsletter', 'rule', 'Nur eingehende Mails, von Outlook unter „Sonstige“ einsortiert.');
    }
    // "unknown" was a lack of evidence, and every new mail is new evidence
    if (decision && !isCustomerVerdict(decision.verdict) && decision.verdict !== 'unknown' && decision.confidence >= MEMORY_CONFIDENCE) {
      return skip(decision.verdict, 'memory', decision.reason);
    }

    const { classifier } = await this.context(run);
    const picked = pickMessages(group.messages);
    const texts = promptTexts(await this.graph.messageTexts(run.userId, picked.map((m) => m.id)));
    const assessment = await this.classifier.assess(
      classifier,
      {
        domain: group.domain,
        label: group.label,
        inbound: group.inbound,
        outbound: group.outbound,
        firstAt: new Date(group.firstAt),
        lastAt: new Date(group.lastAt),
        participants: [...group.participants.values()],
        messages: group.messages,
      },
      texts,
    );
    return {
      relationship: assessment.confidence >= MIN_CONFIDENCE && isCustomerVerdict(assessment.verdict) ? assessment.verdict : null,
      verdict: assessment.verdict,
      decidedBy: 'llm',
      reason: assessment.reason,
      assessment,
      decision,
    };
  }

  /**
   * A business domain is known through its company. A freemail address is
   * known through the person; a person alone does not make a business domain
   * known, otherwise the merge would invent a company for it.
   */
  private async knownRelationship(group: MailGroup): Promise<CrmRelationship | null> {
    if (group.domain) {
      const company = await this.companies
        .createQueryBuilder('c')
        .innerJoin(CrmCompanyDomain, 'd', 'd.company_id = c.id')
        .where('d.domain = :domain', { domain: group.domain })
        .getOne();
      return company?.relationship ?? null;
    }
    const contact = await this.contactByEmail(group.label);
    if (!contact) return null;
    const company = contact.companyId ? await this.companies.findOneBy({ id: contact.companyId }) : null;
    return company?.relationship ?? CrmRelationship.Prospect;
  }

  /** Same memory as the import; a verdict from one mail does not replace one that rested on many. */
  private async remember(group: MailGroup, party: Party, companyId: string | null): Promise<void> {
    const assessment = party.assessment!;
    if (!party.relationship && party.decision && party.decision.messageCount > group.messageCount) return;
    await this.decisions.upsert(
      {
        key: group.key,
        verdict: assessment.verdict,
        confidence: assessment.confidence,
        reason: assessment.reason,
        decidedBy: PartyDecider.Llm,
        messageCount: group.messageCount,
        companyId,
      },
      ['key'],
    );
  }

  private async companyOf(group: MailGroup, merge: MergeResult): Promise<CrmCompany | null> {
    if (merge.companyId) return this.companies.findOneBy({ id: merge.companyId });
    // A known person with a private address may still belong to a company
    const contact = group.domain ? null : await this.contactByEmail(group.label);
    return contact?.companyId ? this.companies.findOneBy({ id: contact.companyId }) : null;
  }

  // ---------- One mail ----------

  /** Is the newest mail of a conversation an opportunity? Then a task with a draft is created. */
  private async handleMail(
    run: Run,
    group: MailGroup,
    company: CrmCompany | null,
    companyIsNew: boolean,
    mail: Message,
  ): Promise<{ outcome: MailSyncOutcome; reason: string; taskId?: string }> {
    const answered = group.messages.some(
      (m) => m.direction === 'out' && !!m.conversationId && m.conversationId === mail.conversationId && m.at > mail.at,
    );
    if (answered) return { outcome: MailSyncOutcome.None, reason: 'Schon beantwortet.' };
    if (AUTOMATIC_SUBJECT.test(mail.subject)) return { outcome: MailSyncOutcome.None, reason: 'Automatische Antwort oder Antwort auf eine Termineinladung.' };
    if (mail.conversationId && (await this.hasOpenTask(run.userId, mail.conversationId))) {
      return { outcome: MailSyncOutcome.None, reason: 'Zu dieser Unterhaltung wartet schon eine Aufgabe unter „Heute“.' };
    }

    try {
      const contact = await this.contactByEmail(mail.from);
      const input = await this.stepInput(run, group, company, companyIsNew, contact, mail);
      const { step, reason, senderJobTitle } = await this.steps.assess(input);
      // Known customers are not classified again: this is where a new person's position comes from
      if (senderJobTitle && contact && !contact.jobTitle) {
        await this.contacts.update(contact.id, { jobTitle: senderJobTitle });
        input.sender.jobTitle = senderJobTitle;
      }
      if (!step) return { outcome: MailSyncOutcome.None, reason };
      const task = await this.tasks.create(run.userId, taskFrom(input, step, reason, run.now));
      return { outcome: MailSyncOutcome.Task, reason, taskId: task.id };
    } catch (err) {
      // Only this mail is lost; anything else (LLM or mailbox down) stops the run and is tried again
      if (!(err instanceof LlmAnswerError)) throw err;
      return { outcome: MailSyncOutcome.Failed, reason: err.message };
    }
  }

  private async stepInput(
    run: Run,
    group: MailGroup,
    company: CrmCompany | null,
    companyIsNew: boolean,
    contact: CrmContact | null,
    mail: Message,
  ): Promise<StepInput> {
    const { classifier, user } = await this.context(run);
    const body = (await this.graph.messageTexts(run.userId, [mail.id])).get(mail.id);
    const text = body ? cleanMailText(body.unique, body.full, 3000) : mail.preview;

    const [history, notes, knowledge] = await Promise.all([
      company || contact
        ? this.activities.find({
            where: company ? { userId: run.userId, companyId: company.id } : { userId: run.userId, contactId: contact!.id },
            order: { occurredAt: 'DESC' },
            take: HISTORY_ITEMS + 1,
          })
        : [],
      company || contact
        ? this.notes.find({
            where: company ? { companyId: company.id } : { contactId: contact!.id },
            order: { occurredAt: 'DESC' },
            take: NOTES,
          })
        : [],
      this.searchKnowledge(`${mail.subject}\n${text}`),
    ]);

    const original = run.raw.get(mail.id);
    const to = addressesOf(original?.toRecipients);
    const cc = addressesOf(original?.ccRecipients);
    const isOwn = (address: string) => run.scan.ownAddresses.has(address);
    return {
      owner: { firstName: user.firstName, fullName: classifier.ownerName, email: classifier.ownerEmail },
      groupCompanies: classifier.groupCompanies,
      now: run.now,
      timeZone: TIME_ZONE,
      sender: {
        name: contact?.fullName || senderName(group, mail),
        email: mail.from,
        jobTitle: contact?.jobTitle ?? null,
      },
      company: company && {
        name: company.name,
        relationship: company.relationship,
        isNew: companyIsNew,
        industry: company.industry,
        summary: company.summary,
        topics: company.topics ?? [],
      },
      mail: {
        subject: mail.subject,
        at: new Date(mail.at),
        text,
        quoted: body ? quotedHistory(body.full) : '',
        to,
        cc,
        ownerInCc: cc.some(isOwn) && !to.some(isOwn),
      },
      history: history
        .filter((a) => a.externalId !== mail.id)
        .slice(0, HISTORY_ITEMS)
        .map((a) => ({
          at: a.occurredAt,
          direction: a.direction === CrmActivityDirection.In ? ('in' as const) : ('out' as const),
          subject: a.subject,
          preview: a.preview,
        })),
      notes: notes.map((n) => ({ at: n.occurredAt, title: n.title, text: n.text })),
      knowledge,
    };
  }

  /** What we offer on the subject of the mail, so the draft states facts instead of guesses. */
  private async searchKnowledge(query: string): Promise<StepInput['knowledge']> {
    try {
      const { hits } = await this.knowledge.search({ query: query.slice(0, 1000), limit: KNOWLEDGE_HITS });
      return hits.map((hit) => ({
        source: hit.source.title,
        company: hit.company.name,
        text: hit.content.length > KNOWLEDGE_CHARS ? `${hit.content.slice(0, KNOWLEDGE_CHARS)} …` : hit.content,
      }));
    } catch (err) {
      this.logger.warn(`Knowledge search for a mail draft failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async hasOpenTask(userId: string, conversationId: string): Promise<boolean> {
    return this.items
      .createQueryBuilder('i')
      .innerJoin(Task, 't', 't.id = i.task_id')
      .where('i.user_id = :userId AND i.conversation_id = :conversationId AND t.status = :open', {
        userId,
        conversationId,
        open: TaskStatus.Open,
      })
      .getExists();
  }

  // ---------- Helpers ----------

  private contactByEmail(email: string): Promise<CrmContact | null> {
    return this.contacts.createQueryBuilder('k').where('k.email = :email OR :email = ANY(k.other_emails)', { email }).getOne();
  }

  /** Who the mailbox belongs to and who "we" are; only read when a counterpart needs the LLM. */
  private context(run: Run): Promise<{ classifier: ClassifierContext; user: User }> {
    run.context ??= Promise.all([this.mailbox.classifier(run.userId), this.users.findOneByOrFail({ id: run.userId })]).then(
      ([classifier, user]) => ({ classifier, user }),
    );
    return run.context;
  }

  private async seen(userId: string, ids: string[]): Promise<Set<string>> {
    const rows = await this.dataSource.query<{ message_id: string }[]>(
      'SELECT message_id FROM mail_sync_items WHERE user_id = $1 AND message_id = ANY($2::text[])',
      [userId, ids],
    );
    return new Set(rows.map((row) => row.message_id));
  }

  private item(run: Run, group: MailGroup, mail: Message, outcome: Partial<MailSyncItem>): Partial<MailSyncItem> {
    return {
      userId: run.userId,
      messageId: mail.id,
      conversationId: mail.conversationId,
      direction: mail.direction,
      fromEmail: mail.from,
      fromName: senderName(group, mail),
      subject: mail.subject,
      receivedAt: new Date(mail.at),
      ...outcome,
    };
  }

  /** The unique index drops what a parallel or repeated run already wrote. */
  private async record(rows: Partial<MailSyncItem>[]): Promise<void> {
    if (!rows.length) return;
    await this.items.createQueryBuilder().insert().into(MailSyncItem).values(rows).orIgnore().execute();
  }

  /** Counted as it happens, so the profile shows a running check moving. */
  private async count(run: Run, delta: Partial<CheckResult>): Promise<void> {
    const { checked = 0, customers = 0, tasks = 0 } = delta;
    run.result.checked += checked;
    run.result.customers += customers;
    run.result.tasks += tasks;
    if (!checked && !customers && !tasks) return;
    await this.dataSource.query(
      `UPDATE mail_sync_states
       SET messages_checked = messages_checked + $2, customers_created = customers_created + $3, tasks_created = tasks_created + $4
       WHERE user_id = $1`,
      [run.userId, checked, customers, tasks],
    );
  }

  private async ensureWanted(userId: string): Promise<void> {
    const state = await this.states.findOne({ select: { enabled: true }, where: { userId } });
    if (!state?.enabled) throw new CheckStopped();
  }
}

/** The counterpart a mail is decided with: its sender, or for our own mails the first recipient outside. */
function ownerOf(mail: Message, scan: ScanContext): string | null {
  const isOurs = (address: string) => scan.ownAddresses.has(address) || scan.internalDomains.has(registrableDomain(domainOf(address)));
  const address = mail.direction === 'in' ? mail.from : mail.to.find((a) => !isOurs(a) && !isAutomatedAddress(a));
  return address ? partyOf(address).key : null;
}

/** Mails of one conversation together, newest first; conversations in the order of their newest mail. */
function byConversation(mails: Message[]): Message[][] {
  const conversations = new Map<string, Message[]>();
  for (const mail of [...mails].sort((a, b) => b.at.localeCompare(a.at))) {
    const key = mail.conversationId ?? mail.id;
    conversations.set(key, [...(conversations.get(key) ?? []), mail]);
  }
  return [...conversations.values()];
}

/** "Thiel, Markus (Hansa)" as the mail header has it becomes "Markus Thiel". */
function senderName(group: MailGroup, mail: Message): string {
  const raw = group.participants.get(mail.from)?.name ?? '';
  const { firstName, lastName } = parseDisplayName(raw, mail.from);
  return `${firstName} ${lastName}`.trim() || raw;
}

function addressesOf(recipients: GraphAddress[] | undefined): string[] {
  return (recipients ?? []).map((r) => cleanAddress(r.emailAddress?.address)).filter((a): a is string => !!a);
}

function taskFrom(input: StepInput, step: ProposedStep, reason: string, now: Date): NewTask {
  const sender = input.sender.name || input.sender.email;
  const { company, mail } = input;
  const relationship = company?.relationship === CrmRelationship.Customer ? 'Kunde' : 'Interessent';
  const evidence: TaskEvidence[] = [
    { source: 'Postfach', text: step.quote ? `„${step.quote}“` : `${mail.subject || 'Mail'} vom ${shortDateTime(input.timeZone, mail.at)}`, weight: step.confidence },
  ];
  if (company) {
    evidence.push({
      source: 'CRM',
      text: company.isNew ? `${company.name} ist neu und jetzt als ${relationship} angelegt.` : company.summary || `${company.name} ist ${relationship}.`,
      weight: company.relationship === CrmRelationship.Customer ? 70 : 55,
    });
  }
  if (input.knowledge.length) {
    const sources = [...new Set(input.knowledge.map((k) => k.source))].slice(0, 3);
    evidence.push({ source: 'Wissensbasis', text: `Für den Entwurf gelesen: ${sources.join(', ')}`, weight: 40 });
  }
  return {
    kind: step.kind,
    title: step.title,
    contactName: sender.slice(0, 200),
    contactRole: input.sender.jobTitle,
    companyName: company?.name ?? null,
    dealValue: step.dealValue,
    stage: step.stage ?? (company?.isNew ? 'Neuer Kontakt' : null),
    lastContactAt: mail.at,
    confidence: step.confidence,
    // A fresh mail is best answered right away; outside office hours the next morning
    dueAt: isOfficeTime(input.timeZone, now) ? now : nextOfficeHour(input.timeZone, now),
    subject: step.subject,
    draft: step.draft,
    summary: reason,
    evidence,
    approvalNote: `Aus der Mail von ${sender} vom ${shortDateTime(input.timeZone, mail.at)}. Mit der Freigabe ist die Aufgabe eingeplant; verschickt oder gebucht wird noch nichts von allein.`,
  };
}
