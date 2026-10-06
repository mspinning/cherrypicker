import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { domainOf, isFreemail, isKnownService, registrableDomain } from '../mail-import/addresses';
import { MAX_TOPICS, MERGE_LOCK, fillContact, spanDates, splitName } from './crm-merge.service';
import { CrmCompanyDomain } from './entities/crm-company-domain.entity';
import { CrmCompany, CrmRelationship, CrmSource } from './entities/crm-company.entity';
import { CrmContact } from './entities/crm-contact.entity';
import { CrmNote } from './entities/crm-note.entity';
import { normalizeCompanyName, normalizePersonName } from './people';

/** What a user reports about one customer. Everything is optional; unknown fields stay out. */
export interface CaptureInput {
  /** Who reports */
  userId: string;
  /** When the conversation with the customer took place */
  at: Date;
  company?: {
    /** An existing company, e.g. from the lookup */
    id?: string;
    name?: string;
    relationship?: CrmRelationship;
    website?: string;
    industry?: string;
    description?: string;
    phone?: string;
    street?: string;
    postalCode?: string;
    city?: string;
    country?: string;
  };
  contact?: {
    /** An existing contact, e.g. from the lookup */
    id?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    jobTitle?: string;
    department?: string;
    phone?: string;
    mobile?: string;
    linkedinUrl?: string;
  };
  topics?: string[];
  note?: {
    title: string;
    text: string;
    /** Unique per note, so a repeated request does not store it twice */
    externalId: string;
  };
}

/** What a user knows about a customer who is already in the CRM, without having talked to them again. */
export interface AnnotateInput {
  /** Who knows it */
  userId: string;
  at: Date;
  companyId: string | null;
  contactId: string | null;
  /** New topics for the company */
  topics: string[];
  note: {
    title: string;
    text: string;
    /** Unique per note, so a repeated request does not store it twice */
    externalId: string;
  };
}

export interface CaptureResult {
  company: { id: string; name: string; created: boolean } | null;
  contact: { id: string; fullName: string; created: boolean } | null;
  noteSaved: boolean;
}

/**
 * Writes what a user reports about a customer (voice call) into the CRM:
 * finds or creates the company and the person and hangs a note on them.
 * Like the import it never overwrites what is there, it only fills gaps.
 */
@Injectable()
export class CrmCaptureService {
  constructor(private readonly dataSource: DataSource) {}

  capture(input: CaptureInput): Promise<CaptureResult> {
    return this.dataSource.transaction(async (m) => {
      // Same lock as the import: both look for an existing customer before creating one
      await m.query('SELECT pg_advisory_xact_lock($1)', [MERGE_LOCK]);

      const email = input.contact?.email?.trim().toLowerCase() || null;
      const domain = email ? businessDomain(email) : null;

      let contact = await this.findContact(m, input.contact?.id, email);
      const company = await this.saveCompany(m, input, domain, contact?.companyId ?? null);
      const result: CaptureResult = {
        company: company && { id: company.row.id, name: company.row.name, created: company.created },
        contact: null,
        noteSaved: false,
      };

      if (input.contact) {
        const { firstName, lastName } = splitName(input.contact.firstName ?? '', input.contact.lastName ?? '');
        contact ??= await this.findContactByName(m, company?.row.id ?? null, firstName, lastName);
        let created = false;
        if (!contact && (firstName || lastName)) {
          contact = m.create(CrmContact, {
            companyId: company?.row.id ?? null,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`.trim(),
            normalizedName: normalizePersonName(firstName, lastName),
            email,
            otherEmails: [],
            source: CrmSource.Manual,
          });
          created = true;
        }
        if (contact) {
          if (!contact.companyId && company) contact.companyId = company.row.id;
          // "Herr Becker" becomes Thomas Becker once the first name is known
          if (!contact.firstName && firstName && normalizePersonName('', lastName) === normalizePersonName('', contact.lastName)) {
            contact.firstName = firstName;
            contact.fullName = `${firstName} ${contact.lastName}`.trim();
            contact.normalizedName = normalizePersonName(firstName, contact.lastName);
          }
          if (email && !contact.email) contact.email = email;
          else if (email && contact.email !== email && !contact.otherEmails.includes(email)) {
            contact.otherEmails = [...contact.otherEmails, email];
          }
          fillContact(contact, input.contact);
          spanDates(contact, input.at, input.at);
          contact = await m.save(contact);
          result.contact = { id: contact.id, fullName: contact.fullName, created };
        }
      }

      // From now on the import finds the company by the address of its people
      if (company && domain) {
        await m.createQueryBuilder().insert().into(CrmCompanyDomain).values({ domain, companyId: company.row.id }).orIgnore().execute();
      }

      if (input.note && (company || contact)) {
        const inserted = await m
          .createQueryBuilder()
          .insert()
          .into(CrmNote)
          .values({
            authorId: input.userId,
            companyId: company?.row.id ?? null,
            contactId: contact?.id ?? null,
            title: input.note.title.slice(0, 200),
            text: input.note.text,
            occurredAt: input.at,
            externalId: input.note.externalId,
          })
          .orIgnore()
          .returning('id')
          .execute();
        result.noteSaved = (inserted.raw as unknown[]).length > 0;
      }
      return result;
    });
  }

  /**
   * Hangs a note on a customer who is already in the CRM and adds topics to
   * the company. Unlike `capture` this is not a conversation with the
   * customer: nothing else changes, the dates of the last contact stay.
   * False if the customer is gone or the note was stored before.
   */
  annotate(input: AnnotateInput): Promise<boolean> {
    return this.dataSource.transaction(async (m) => {
      // Topics are read and written back, like the import does under the same lock
      await m.query('SELECT pg_advisory_xact_lock($1)', [MERGE_LOCK]);

      const contact = input.contactId ? await m.findOne(CrmContact, { where: { id: input.contactId } }) : null;
      const companyId = input.companyId ?? contact?.companyId ?? null;
      const company = companyId ? await m.findOne(CrmCompany, { where: { id: companyId } }) : null;
      if (!company && !contact) return false;

      if (company) {
        const known = new Set((company.topics ?? []).map((topic) => topic.toLowerCase()));
        const added = input.topics.filter((topic) => !known.has(topic.toLowerCase()));
        // What the user just said counts more than what an import read long ago: the oldest topics make room
        if (added.length) await m.update(CrmCompany, company.id, { topics: [...(company.topics ?? []), ...added].slice(-MAX_TOPICS) });
      }

      const inserted = await m
        .createQueryBuilder()
        .insert()
        .into(CrmNote)
        .values({
          authorId: input.userId,
          companyId: company?.id ?? null,
          contactId: contact?.id ?? null,
          title: input.note.title.slice(0, 200),
          text: input.note.text,
          occurredAt: input.at,
          externalId: input.note.externalId,
        })
        .orIgnore()
        .returning('id')
        .execute();
      return (inserted.raw as unknown[]).length > 0;
    });
  }

  /** The given company, the one of the contact's mail domain, the one with the same name, or a new one. */
  private async saveCompany(
    m: EntityManager,
    input: CaptureInput,
    domain: string | null,
    contactCompanyId: string | null,
  ): Promise<{ row: CrmCompany; created: boolean } | null> {
    const c = input.company ?? {};
    const name = c.name?.trim();
    let company = c.id ? await m.findOne(CrmCompany, { where: { id: c.id } }) : null;
    if (!company && domain) {
      company = await m
        .createQueryBuilder(CrmCompany, 'c')
        .innerJoin(CrmCompanyDomain, 'd', 'd.company_id = c.id')
        .where('d.domain = :domain', { domain })
        .getOne();
    }
    if (!company && name) {
      company = await m.findOne(CrmCompany, { where: { normalizedName: normalizeCompanyName(name) }, order: { createdAt: 'ASC' } });
    }
    // A known person without a word about the company still belongs to it
    if (!company && !name && contactCompanyId) company = await m.findOne(CrmCompany, { where: { id: contactCompanyId } });

    let created = false;
    if (!company) {
      if (!name) return null;
      company = m.create(CrmCompany, {
        name: name.slice(0, 200),
        normalizedName: normalizeCompanyName(name),
        relationship: c.relationship ?? CrmRelationship.Prospect,
        source: CrmSource.Manual,
        topics: [],
      });
      created = true;
    }

    for (const key of ['website', 'industry', 'description', 'phone', 'street', 'postalCode', 'city', 'country'] as const) {
      if (c[key] && !company[key]) company[key] = c[key];
    }
    if (!company.website && domain) company.website = `https://${domain}`;
    if (company.relationship === CrmRelationship.Prospect && c.relationship === CrmRelationship.Customer) {
      company.relationship = CrmRelationship.Customer;
    }
    company.topics = [...new Set([...(company.topics ?? []), ...(input.topics ?? [])])].slice(0, MAX_TOPICS);
    spanDates(company, input.at, input.at);
    return { row: await m.save(company), created };
  }

  private async findContact(m: EntityManager, id: string | undefined, email: string | null): Promise<CrmContact | null> {
    const byId = id ? await m.findOne(CrmContact, { where: { id } }) : null;
    if (byId || !email) return byId;
    return m.createQueryBuilder(CrmContact, 'k').where('k.email = :email OR :email = ANY(k.other_emails)', { email }).getOne();
  }

  /** Full names match exactly; a lone last name ("Herr Becker") only if the company has exactly one. */
  private async findContactByName(m: EntityManager, companyId: string | null, firstName: string, lastName: string): Promise<CrmContact | null> {
    if (!companyId || !lastName) return null;
    if (firstName) {
      const exact = await m.findOne(CrmContact, { where: { companyId, normalizedName: normalizePersonName(firstName, lastName) } });
      if (exact) return exact;
    }
    const family = normalizePersonName('', lastName);
    const namesakes = (await m.find(CrmContact, { where: { companyId } })).filter(
      (k) => normalizePersonName('', k.lastName) === family && (!firstName || !k.firstName),
    );
    return namesakes.length === 1 ? namesakes[0] : null;
  }
}

/** The company's own mail domain; null for freemail addresses and mail services. */
function businessDomain(email: string): string | null {
  const domain = registrableDomain(domainOf(email));
  return domain.includes('.') && !isFreemail(domain) && !isKnownService(domain) ? domain : null;
}
