import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { CrmActivity, CrmActivityDirection, CrmActivityType } from './entities/crm-activity.entity';
import { CrmCompanyDomain } from './entities/crm-company-domain.entity';
import { CrmCompany, CrmRelationship, CrmSource } from './entities/crm-company.entity';
import { CrmContact } from './entities/crm-contact.entity';
import { isRoleAddress, normalizeCompanyName, normalizePersonName, parseDisplayName } from './people';

/** pg advisory lock key: merges run one after another, across workers and processes */
const MERGE_LOCK = 7_310_101;
const MAX_TOPICS = 10;
const ACTIVITY_BATCH = 200;

/** Everything the mailbox shows about one counterpart. */
export interface PartyEvidence {
  /** Owner of the mailbox */
  userId: string;
  /** Registrable business domain; null for a freemail address */
  domain: string | null;
  participants: {
    email: string;
    name: string;
    inbound: number;
    outbound: number;
    firstAt: string;
    lastAt: string;
  }[];
  messages: {
    id: string;
    conversationId: string | null;
    subject: string;
    preview: string;
    at: string;
    direction: 'in' | 'out';
    from: string;
    to: string[];
    webLink: string | null;
  }[];
}

/** What the LLM read from the mails, already checked. */
export interface PartyFacts {
  relationship: CrmRelationship;
  company: {
    name?: string;
    website?: string;
    industry?: string;
    description?: string;
    phone?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  } | null;
  contacts: {
    email: string;
    firstName?: string;
    lastName?: string;
    jobTitle?: string;
    department?: string;
    phone?: string;
    mobile?: string;
    linkedinUrl?: string;
  }[];
  summary?: string;
  topics: string[];
}

export interface MergeResult {
  companyId: string | null;
  companyCreated: boolean;
  companyUpdated: boolean;
  contactsCreated: number;
  contactsUpdated: number;
  activitiesCreated: number;
}

/**
 * Writes an imported customer into the CRM without creating duplicates:
 * companies are found by mail domain, then by normalized name; contacts by
 * any of their addresses, then by name within the company. Existing values
 * are never overwritten, only gaps are filled, so manual corrections stay.
 */
@Injectable()
export class CrmMergeService {
  constructor(private readonly dataSource: DataSource) {}

  merge(evidence: PartyEvidence, facts: PartyFacts): Promise<MergeResult> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [MERGE_LOCK]);
      return this.apply(manager, evidence, facts);
    });
  }

  private async apply(m: EntityManager, ev: PartyEvidence, facts: PartyFacts): Promise<MergeResult> {
    const result: MergeResult = {
      companyId: null,
      companyCreated: false,
      companyUpdated: false,
      contactsCreated: 0,
      contactsUpdated: 0,
      activitiesCreated: 0,
    };
    const firstAt = minDate(ev.participants.map((p) => p.firstAt));
    const lastAt = maxDate(ev.participants.map((p) => p.lastAt));

    // ---------- Company ----------
    const name = facts.company?.name?.trim();
    let company = ev.domain ? await this.companyByDomain(m, ev.domain) : null;
    if (!company && name) company = await this.companyByName(m, name, ev.domain);

    if (company) {
      result.companyUpdated = this.fillCompany(company, facts, ev.domain, firstAt, lastAt);
      if (result.companyUpdated) await m.save(company);
    } else if (name || ev.domain) {
      company = m.create(CrmCompany, {
        name: (name || prettyDomain(ev.domain!)).slice(0, 200),
        relationship: facts.relationship,
        source: CrmSource.MailImport,
        topics: [],
      });
      company.normalizedName = normalizeCompanyName(company.name);
      this.fillCompany(company, facts, ev.domain, firstAt, lastAt);
      company = await m.save(company);
      result.companyCreated = true;
    }
    if (company && ev.domain) {
      await m.createQueryBuilder().insert().into(CrmCompanyDomain).values({ domain: ev.domain, companyId: company.id }).orIgnore().execute();
    }
    result.companyId = company?.id ?? null;

    // ---------- Contacts ----------
    const factsByEmail = new Map(facts.contacts.map((c) => [c.email, c]));
    const contactIdByEmail = new Map<string, string>();
    for (const p of ev.participants) {
      const f = factsByEmail.get(p.email);
      const parsed = parseDisplayName(p.name, p.email);
      const { firstName, lastName } = splitName(f?.firstName || parsed.firstName, f?.lastName || parsed.lastName);
      // Role mailboxes (info@, rechnung@) and nameless addresses are no people
      if (isRoleAddress(p.email) || (!f && !firstName && !lastName)) continue;

      const normalizedName = normalizePersonName(firstName, lastName);
      let contact = await m
        .createQueryBuilder(CrmContact, 'k')
        .where('k.email = :email OR :email = ANY(k.other_emails)', { email: p.email })
        .getOne();
      if (!contact && company && normalizedName.includes(' ')) {
        contact = await m.findOne(CrmContact, { where: { companyId: company.id, normalizedName } });
      }

      if (contact) {
        let changed = false;
        if (contact.email !== p.email && !contact.otherEmails.includes(p.email)) {
          contact.otherEmails = [...contact.otherEmails, p.email];
          changed = true;
        }
        if (!contact.companyId && company) {
          contact.companyId = company.id;
          changed = true;
        }
        if (!contact.firstName && !contact.lastName && (firstName || lastName)) {
          Object.assign(contact, { firstName, lastName, fullName: `${firstName} ${lastName}`.trim(), normalizedName });
          changed = true;
        }
        changed = fillContact(contact, f) || changed;
        changed = spanDates(contact, new Date(p.firstAt), new Date(p.lastAt)) || changed;
        if (changed) {
          await m.save(contact);
          result.contactsUpdated++;
        }
      } else {
        contact = m.create(CrmContact, {
          companyId: company?.id ?? null,
          firstName,
          lastName,
          fullName: `${firstName} ${lastName}`.trim() || p.email,
          normalizedName,
          email: p.email,
          otherEmails: [],
          source: CrmSource.MailImport,
          firstContactAt: new Date(p.firstAt),
          lastContactAt: new Date(p.lastAt),
        });
        fillContact(contact, f);
        contact = await m.save(contact);
        result.contactsCreated++;
      }
      contactIdByEmail.set(p.email, contact.id);
    }

    // ---------- Activities ----------
    const rows: Partial<CrmActivity>[] = [];
    const partyEmails = new Set(ev.participants.map((p) => p.email));
    for (const msg of ev.messages) {
      const contactId =
        msg.direction === 'in'
          ? (contactIdByEmail.get(msg.from) ?? null)
          : (msg.to.map((email) => contactIdByEmail.get(email)).find(Boolean) ?? null);
      const partyKey = company ? `company:${company.id}` : contactId ? `contact:${contactId}` : null;
      if (!partyKey) continue;
      rows.push({
        userId: ev.userId,
        companyId: company?.id ?? null,
        contactId,
        partyKey,
        participants: [...new Set([msg.from, ...msg.to])].filter((email) => partyEmails.has(email)),
        type: CrmActivityType.Email,
        direction: msg.direction === 'in' ? CrmActivityDirection.In : CrmActivityDirection.Out,
        subject: msg.subject.slice(0, 500),
        preview: msg.preview.slice(0, 600),
        occurredAt: new Date(msg.at),
        externalId: msg.id,
        conversationId: msg.conversationId,
        webLink: msg.webLink,
      });
    }
    for (let i = 0; i < rows.length; i += ACTIVITY_BATCH) {
      const inserted = await m
        .createQueryBuilder()
        .insert()
        .into(CrmActivity)
        .values(rows.slice(i, i + ACTIVITY_BATCH))
        .orIgnore()
        .returning('id')
        .execute();
      result.activitiesCreated += (inserted.raw as unknown[]).length;
    }
    return result;
  }

  private companyByDomain(m: EntityManager, domain: string): Promise<CrmCompany | null> {
    return m
      .createQueryBuilder(CrmCompany, 'c')
      .innerJoin(CrmCompanyDomain, 'd', 'd.company_id = c.id')
      .where('d.domain = :domain', { domain })
      .getOne();
  }

  /**
   * Same name is the same company, unless both have different own domains
   * ("Müller GmbH" at mueller-bau.de vs. mueller-it.de); acme.de and acme.com do match.
   */
  private async companyByName(m: EntityManager, name: string, domain: string | null): Promise<CrmCompany | null> {
    const candidates = await m.find(CrmCompany, {
      where: { normalizedName: normalizeCompanyName(name) },
      relations: { domains: true },
      order: { createdAt: 'ASC' },
    });
    return (
      candidates.find(
        (c) => !domain || !c.domains?.length || c.domains.some((d) => baseLabel(d.domain) === baseLabel(domain)),
      ) ?? null
    );
  }

  /** Fills gaps, upgrades prospect → customer, keeps the newest summary. Returns whether anything changed. */
  private fillCompany(company: CrmCompany, facts: PartyFacts, domain: string | null, firstAt: Date | null, lastAt: Date | null): boolean {
    let changed = false;
    const set = <K extends keyof CrmCompany>(key: K, value: CrmCompany[K] | undefined) => {
      if (value !== undefined && value !== null && value !== '' && (company[key] === null || company[key] === undefined || company[key] === '')) {
        company[key] = value;
        changed = true;
      }
    };
    const c = facts.company ?? {};
    set('website', c.website ?? (domain ? `https://${domain}` : undefined));
    set('industry', c.industry);
    set('description', c.description);
    set('phone', c.phone);
    set('street', c.street);
    set('postalCode', c.postalCode);
    set('city', c.city);
    set('country', c.country);

    if (company.relationship === CrmRelationship.Prospect && facts.relationship === CrmRelationship.Customer) {
      company.relationship = CrmRelationship.Customer;
      changed = true;
    }
    if (facts.summary && facts.summary !== company.summary) {
      company.summary = facts.summary;
      changed = true;
    }
    const topics = [...new Set([...(company.topics ?? []), ...facts.topics])].slice(0, MAX_TOPICS);
    if (topics.length !== (company.topics ?? []).length) {
      company.topics = topics;
      changed = true;
    }
    if (firstAt && lastAt) changed = spanDates(company, firstAt, lastAt) || changed;
    return changed;
  }
}

/** Models sometimes put the full name into first_name ("Julia Weber" + "Weber"). */
function splitName(first: string, last: string): { firstName: string; lastName: string } {
  let firstName = first.trim();
  let lastName = last.trim();
  if (lastName && firstName.toLowerCase().endsWith(` ${lastName.toLowerCase()}`)) {
    firstName = firstName.slice(0, -(lastName.length + 1)).trim();
  } else if (!lastName && firstName.includes(' ')) {
    lastName = firstName.slice(firstName.lastIndexOf(' ') + 1);
    firstName = firstName.slice(0, firstName.lastIndexOf(' '));
  }
  return { firstName: firstName.slice(0, 100), lastName: lastName.slice(0, 100) };
}

function fillContact(contact: CrmContact, f: PartyFacts['contacts'][number] | undefined): boolean {
  if (!f) return false;
  let changed = false;
  for (const key of ['jobTitle', 'department', 'phone', 'mobile', 'linkedinUrl'] as const) {
    const value = f[key];
    if (value && !contact[key]) {
      contact[key] = value;
      changed = true;
    }
  }
  return changed;
}

/** Widens first/last contact to cover the given range. */
function spanDates(row: { firstContactAt: Date | null; lastContactAt: Date | null }, first: Date, last: Date): boolean {
  let changed = false;
  if (!row.firstContactAt || first < row.firstContactAt) {
    row.firstContactAt = first;
    changed = true;
  }
  if (!row.lastContactAt || last > row.lastContactAt) {
    row.lastContactAt = last;
    changed = true;
  }
  return changed;
}

function minDate(values: string[]): Date | null {
  const times = values.map((v) => Date.parse(v)).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.min(...times)) : null;
}

function maxDate(values: string[]): Date | null {
  const times = values.map((v) => Date.parse(v)).filter((t) => !Number.isNaN(t));
  return times.length ? new Date(Math.max(...times)) : null;
}

/** "acme.co.uk" → "acme" */
function baseLabel(domain: string): string {
  return domain.split('.')[0];
}

/** "acme-solutions.de" → "Acme Solutions" (only when the mails name no company) */
function prettyDomain(domain: string): string {
  return baseLabel(domain)
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
