import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import {
  ActivityDto,
  CompanyDetailDto,
  CompanyListItemDto,
  ContactDetailDto,
  ContactListItemDto,
  CrmSummaryDto,
  KnownByDto,
  ListCompaniesQueryDto,
  NoteDto,
  ListContactsQueryDto,
  PageDto,
} from './dto/crm.dto';
import { CrmCompanyDomain } from './entities/crm-company-domain.entity';
import { CrmCompany, CrmRelationship } from './entities/crm-company.entity';
import { CrmContact } from './entities/crm-contact.entity';
import { CrmNote } from './entities/crm-note.entity';
import { CrmPartyDecision, PartyDecider } from './entities/crm-party-decision.entity';

const ACTIVITY_LIMIT = 40;
const NOTE_LIMIT = 40;

/** Customers and their people, shared by all CRM users. */
@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(CrmCompany) private readonly companies: Repository<CrmCompany>,
    @InjectRepository(CrmContact) private readonly contacts: Repository<CrmContact>,
    private readonly dataSource: DataSource,
  ) {}

  async summary(): Promise<CrmSummaryDto> {
    const [row] = await this.dataSource.query<{ customers: number; prospects: number; contacts: number }[]>(
      `SELECT count(*) FILTER (WHERE relationship = $1)::int AS customers,
              count(*) FILTER (WHERE relationship = $2)::int AS prospects,
              (SELECT count(*) FROM crm_contacts)::int AS contacts
       FROM crm_companies`,
      [CrmRelationship.Customer, CrmRelationship.Prospect],
    );
    return { companies: row.customers + row.prospects, ...row };
  }

  // ---------- Companies ----------

  async listCompanies(query: ListCompaniesQueryDto): Promise<PageDto<CompanyListItemDto>> {
    const like = likePattern(query.q);
    const where = `($1::text IS NULL
        OR c.name ILIKE $1
        OR EXISTS (SELECT 1 FROM crm_company_domains d WHERE d.company_id = c.id AND d.domain ILIKE $1)
        OR EXISTS (SELECT 1 FROM crm_contacts k WHERE k.company_id = c.id AND (k.full_name ILIKE $1 OR k.email ILIKE $1)))
      AND ($2::crm_relationship IS NULL OR c.relationship = $2)`;
    const params = [like, query.relationship ?? null];

    const [rows, [{ total }]] = await Promise.all([
      this.dataSource.query<
        {
          id: string;
          name: string;
          relationship: CrmRelationship;
          industry: string | null;
          city: string | null;
          last_contact_at: Date | null;
          created_at: Date;
          domains: string[] | null;
          contact_count: number;
        }[]
      >(
        `SELECT c.id, c.name, c.relationship, c.industry, c.city, c.last_contact_at, c.created_at,
                (SELECT array_agg(d.domain ORDER BY d.created_at) FROM crm_company_domains d WHERE d.company_id = c.id) AS domains,
                (SELECT count(*) FROM crm_contacts k WHERE k.company_id = c.id)::int AS contact_count
         FROM crm_companies c
         WHERE ${where}
         ORDER BY c.name, c.id
         OFFSET $3 LIMIT $4`,
        [...params, query.offset ?? 0, query.limit ?? 50],
      ),
      this.dataSource.query<{ total: number }[]>(`SELECT count(*)::int AS total FROM crm_companies c WHERE ${where}`, params),
    ]);

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        relationship: r.relationship,
        domains: r.domains ?? [],
        industry: r.industry,
        city: r.city,
        contactCount: r.contact_count,
        lastContactAt: r.last_contact_at,
        createdAt: r.created_at,
      })),
    };
  }

  async getCompany(id: string, userId: string): Promise<CompanyDetailDto> {
    const company = await this.companies.findOne({ where: { id }, relations: { domains: true } });
    if (!company) throw new NotFoundException('Firma nicht gefunden');

    const [contacts, notes, activities, knownBy] = await Promise.all([
      this.contacts.find({ where: { companyId: id }, order: { fullName: 'ASC', id: 'ASC' } }),
      this.notes('n.company_id = $1', id),
      this.activities('a.company_id = $1', [id, userId]),
      this.dataSource.query<{ user_id: string; first_name: string; last_name: string; email: string; mails: number; last_at: Date | null }[]>(
        `SELECT a.user_id, u.first_name, u.last_name, u.email, count(*)::int AS mails, max(a.occurred_at) AS last_at
         FROM crm_activities a JOIN users u ON u.id = a.user_id
         WHERE a.company_id = $1
         GROUP BY 1, 2, 3, 4
         ORDER BY last_at DESC`,
        [id],
      ),
    ]);

    return {
      id: company.id,
      name: company.name,
      relationship: company.relationship,
      source: company.source,
      domains: (company.domains ?? []).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((d) => d.domain),
      website: company.website,
      industry: company.industry,
      description: company.description,
      phone: company.phone,
      street: company.street,
      postalCode: company.postalCode,
      city: company.city,
      country: company.country,
      summary: company.summary,
      topics: company.topics,
      firstContactAt: company.firstContactAt,
      lastContactAt: company.lastContactAt,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      contacts: contacts.map((k) => contactItem(k, { id: company.id, name: company.name })),
      notes,
      activities,
      knownBy: knownBy.map(
        (row): KnownByDto => ({
          userId: row.user_id,
          name: `${row.first_name} ${row.last_name}`.trim() || row.email,
          mails: row.mails,
          lastContactAt: row.last_at,
        }),
      ),
    };
  }

  /** Contacts and activities go with it (FK cascade). */
  async removeCompany(id: string, ignore: boolean): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const company = await m.findOne(CrmCompany, { where: { id } });
      if (!company) throw new NotFoundException('Firma nicht gefunden');
      const domains = await m.find(CrmCompanyDomain, { where: { companyId: id } });
      await m.delete(CrmCompany, id);
      if (ignore) {
        await this.ignore(
          m,
          domains.map((d) => `domain:${d.domain}`),
          `${company.name} wurde aus dem CRM gelöscht`,
        );
      }
    });
  }

  // ---------- Contacts ----------

  async listContacts(query: ListContactsQueryDto): Promise<PageDto<ContactListItemDto>> {
    const qb = this.contacts
      .createQueryBuilder('k')
      .leftJoinAndSelect('k.company', 'c')
      // Property paths, not columns: skip/take with a join needs them
      .orderBy('k.fullName', 'ASC')
      .addOrderBy('k.id', 'ASC')
      .skip(query.offset ?? 0)
      .take(query.limit ?? 50);
    const like = likePattern(query.q);
    if (like) {
      qb.andWhere('(k.full_name ILIKE :like OR k.email ILIKE :like OR k.job_title ILIKE :like OR c.name ILIKE :like)', { like });
    }
    if (query.companyId) qb.andWhere('k.company_id = :companyId', { companyId: query.companyId });

    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((k) => contactItem(k, k.company ?? null)), total };
  }

  async getContact(id: string, userId: string): Promise<ContactDetailDto> {
    const contact = await this.contacts.findOne({ where: { id }, relations: { company: true } });
    if (!contact) throw new NotFoundException('Kontakt nicht gefunden');
    return {
      ...contactItem(contact, contact.company ?? null),
      otherEmails: contact.otherEmails,
      department: contact.department,
      linkedinUrl: contact.linkedinUrl,
      source: contact.source,
      firstContactAt: contact.firstContactAt,
      createdAt: contact.createdAt,
      notes: await this.notes('n.contact_id = $1', id),
      // Also mails the person was only cc'd on
      activities: await this.activities('(a.contact_id = $1 OR a.participants && $3::text[])', [
        id,
        userId,
        addressesOf(contact),
      ]),
    };
  }

  async removeContact(id: string, ignore: boolean): Promise<void> {
    await this.dataSource.transaction(async (m) => {
      const contact = await m.findOne(CrmContact, { where: { id } });
      if (!contact) throw new NotFoundException('Kontakt nicht gefunden');
      // Notes on a private contact hang on nothing else
      await m.delete(CrmNote, { contactId: id, companyId: IsNull() });
      await m.delete(CrmContact, id);
      // A business address comes back with its company; only private contacts can be ignored by address
      if (ignore && !contact.companyId) {
        await this.ignore(
          m,
          addressesOf(contact).map((email) => `email:${email}`),
          `${contact.fullName} wurde aus dem CRM gelöscht`,
        );
      }
    });
  }

  // ---------- Helpers ----------

  /** Newest mails of the given user only: other people's mailboxes stay private. */
  /** `$2` is always the requesting user. */
  private async activities(condition: string, params: [string, string, ...unknown[]]): Promise<ActivityDto[]> {
    const rows = await this.dataSource.query<
      {
        id: string;
        direction: ActivityDto['direction'];
        subject: string;
        preview: string;
        occurred_at: Date;
        web_link: string | null;
        contact_id: string | null;
        contact_name: string | null;
      }[]
    >(
      `SELECT a.id, a.direction, a.subject, a.preview, a.occurred_at, a.web_link, k.id AS contact_id, k.full_name AS contact_name
       FROM crm_activities a LEFT JOIN crm_contacts k ON k.id = a.contact_id
       WHERE ${condition} AND a.user_id = $2
       ORDER BY a.occurred_at DESC
       LIMIT ${ACTIVITY_LIMIT}`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      subject: r.subject,
      preview: r.preview,
      occurredAt: r.occurred_at,
      webLink: r.web_link,
      contact: r.contact_id ? { id: r.contact_id, fullName: r.contact_name ?? '' } : null,
    }));
  }

  /** Newest notes of all users. */
  private async notes(condition: string, id: string): Promise<NoteDto[]> {
    const rows = await this.dataSource.query<
      {
        id: string;
        title: string;
        text: string;
        occurred_at: Date;
        author: string | null;
        contact_id: string | null;
        contact_name: string | null;
      }[]
    >(
      `SELECT n.id, n.title, n.text, n.occurred_at, k.id AS contact_id, k.full_name AS contact_name,
              COALESCE(NULLIF(trim(u.first_name || ' ' || u.last_name), ''), u.email) AS author
       FROM crm_notes n
       LEFT JOIN crm_contacts k ON k.id = n.contact_id
       LEFT JOIN users u ON u.id = n.author_id
       WHERE ${condition}
       ORDER BY n.occurred_at DESC, n.created_at DESC
       LIMIT ${NOTE_LIMIT}`,
      [id],
    );
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      text: r.text,
      occurredAt: r.occurred_at,
      author: r.author,
      contact: r.contact_id ? { id: r.contact_id, fullName: r.contact_name ?? '' } : null,
    }));
  }

  private async ignore(m: EntityManager, keys: string[], reason: string): Promise<void> {
    if (!keys.length) return;
    await m.upsert(
      CrmPartyDecision,
      keys.map((key) => ({ key, verdict: 'ignored', confidence: 1, reason, decidedBy: PartyDecider.User, companyId: null })),
      ['key'],
    );
  }
}

function contactItem(k: CrmContact, company: { id: string; name: string } | null): ContactListItemDto {
  return {
    id: k.id,
    fullName: k.fullName,
    firstName: k.firstName,
    lastName: k.lastName,
    email: k.email,
    jobTitle: k.jobTitle,
    phone: k.phone,
    mobile: k.mobile,
    company: company && { id: company.id, name: company.name },
    lastContactAt: k.lastContactAt,
  };
}

function addressesOf(contact: CrmContact): string[] {
  return [...(contact.email ? [contact.email] : []), ...contact.otherEmails];
}

function likePattern(q: string | undefined): string | null {
  return q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
}
