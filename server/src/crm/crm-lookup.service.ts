import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CrmRelationship } from './entities/crm-company.entity';
import { normalizeCompanyName, normalizePersonName, parseDisplayName } from './people';

const COMPANY_LIMIT = 4;
const CONTACT_LIMIT = 6;
const CONTACTS_PER_COMPANY = 8;

export interface CompanyMatch {
  id: string;
  name: string;
  relationship: CrmRelationship;
  industry: string | null;
  city: string | null;
  contacts: { id: string; fullName: string; jobTitle: string | null }[];
}

export interface ContactMatch {
  id: string;
  fullName: string;
  jobTitle: string | null;
  email: string | null;
  company: { id: string; name: string } | null;
}

/** Who a name is in the CRM, see `CrmLookupService.identify` */
export interface Identified {
  /** The person; or the company, where the name is a company's own */
  party: { kind: 'person' | 'company'; id: string } | null;
  /** The number to call: the person's mobile, else their landline, else the company's */
  phone: string | null;
}

/** Somebody to turn to at a customer, see `CrmLookupService.recentPeople` */
export interface RecentPerson {
  firstName: string;
  fullName: string;
  jobTitle: string | null;
  company: { name: string; topics: string[] };
}

/** A company name this short is not looked for inside longer ones */
const MIN_NAME_PART = 4;

/**
 * Finds customers by a name somebody said or typed from memory: "Kessler"
 * finds "Kässler & Söhne GmbH", "Herr Becker" finds Thomas Becker. Trigram
 * similarity (pg_trgm) forgives typos and what a speech recognition misheard.
 */
@Injectable()
export class CrmLookupService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CrmLookupService.name);
  /** Without pg_trgm only names containing the query match */
  private fuzzy = false;

  constructor(private readonly dataSource: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.dataSource.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
      this.fuzzy = true;
    } catch (err) {
      this.logger.warn(`pg_trgm not available, customer lookup only matches exact parts of names: ${(err as Error).message}`);
    }
  }

  /** Best matches first; people of a matching company rank above namesakes elsewhere. */
  async find(query: { company?: string; person?: string }): Promise<{ companies: CompanyMatch[]; contacts: ContactMatch[] }> {
    const companyName = normalizeCompanyName(query.company ?? '');
    // Drops "Herr", "Frau Dr." and the like
    const parsed = parseDisplayName(query.person ?? '', '');
    const personName = normalizePersonName(parsed.firstName, parsed.lastName);

    const companies = companyName ? await this.companies(companyName) : [];
    const contacts = personName
      ? await this.contacts(
          personName,
          companies.map((c) => c.id),
        )
      : [];
    return { companies, contacts };
  }

  /**
   * Who the contact of a task is in the CRM. A task only keeps names, written
   * as they were said or read: "Arnold Autohaus" for "Testdaten Arnold
   * Autohaus GmbH". Nothing is guessed here. A person counts with exactly this
   * first and last name, at the named company if there is one. A company
   * counts with exactly this name or, failing that, with the name as a whole
   * part of its own. Whenever two fit, it is nobody. Same order as `contacts`.
   */
  async identify(contacts: { name: string; company: string | null }[]): Promise<Identified[]> {
    const keys = contacts.map(({ name, company }) => {
      const parsed = parseDisplayName(name, '');
      const person = normalizePersonName(parsed.firstName, parsed.lastName);
      return {
        // A first name alone is not a person
        person: person.includes(' ') ? person : '',
        company: normalizeCompanyName(company ?? ''),
        // "Arnold Autohaus anrufen": the contact is the company itself
        nameAsCompany: normalizeCompanyName(name),
      };
    });
    const personNames = [...new Set(keys.map((key) => key.person).filter(Boolean))];
    const companyNames = [...new Set(keys.flatMap((key) => [key.company, key.nameAsCompany]).filter(Boolean))];

    const [people, companies] = await Promise.all([
      personNames.length
        ? this.dataSource.query<
            { id: string; name: string; phone: string | null; mobile: string | null; company: string | null; company_phone: string | null }[]
          >(
            `SELECT k.id, k.normalized_name AS name, k.phone, k.mobile, c.normalized_name AS company, c.phone AS company_phone
             FROM crm_contacts k
             LEFT JOIN crm_companies c ON c.id = k.company_id
             WHERE k.normalized_name = ANY($1)`,
            [personNames],
          )
        : [],
      companyNames.length
        ? this.dataSource.query<{ id: string; name: string; phone: string | null }[]>(
            `SELECT c.id, c.normalized_name AS name, c.phone
             FROM crm_companies c
             WHERE EXISTS (
               SELECT 1 FROM unnest($1::text[]) AS wanted(name)
               WHERE c.normalized_name = wanted.name
                  OR (length(wanted.name) >= ${MIN_NAME_PART} AND position(' ' || wanted.name || ' ' IN ' ' || c.normalized_name || ' ') > 0)
             )`,
            [companyNames],
          )
        : [],
    ]);

    const companyNamed = (name: string) => {
      const exact = companies.filter((c) => c.name === name);
      const found = exact.length ? exact : companies.filter((c) => carries(c.name, name));
      return name && found.length === 1 ? found[0] : null;
    };

    return keys.map((key): Identified => {
      const namesakes = people.filter((k) => k.name === key.person && (!key.company || (k.company !== null && carries(k.company, key.company))));
      if (key.person && namesakes.length === 1) {
        const [{ id, mobile, phone, company_phone }] = namesakes;
        return { party: { kind: 'person', id }, phone: mobile || phone || company_phone || null };
      }
      // Only where no other company is named: "Arnold Autohaus" at "Arnold Autohaus GmbH", not "Kessler" at "Nordwerk"
      const isCompany = !key.company || carries(key.company, key.nameAsCompany) || carries(key.nameAsCompany, key.company);
      const itself = isCompany ? companyNamed(key.nameAsCompany) : null;
      if (itself) return { party: { kind: 'company', id: itself.id }, phone: itself.phone };
      // Somebody the CRM does not know, at a company it does: its number reaches them
      return { party: null, phone: companyNamed(key.company)?.phone ?? null };
    });
  }

  /**
   * One person from each of the companies last in contact, the most recent
   * company first. Only people with an address, at a company with a topic to
   * talk about, whom `identify` finds again by their name.
   */
  async recentPeople(limit: number): Promise<RecentPerson[]> {
    const rows = await this.dataSource.query<
      { id: string; first_name: string; full_name: string; job_title: string | null; company: string; topics: string[] }[]
    >(
      `SELECT id, first_name, full_name, job_title, company, topics
       FROM (SELECT DISTINCT ON (c.id) k.id, k.first_name, k.full_name, k.job_title, c.name AS company, c.topics,
                    c.last_contact_at AS company_last_contact_at
             FROM crm_contacts k
             JOIN crm_companies c ON c.id = k.company_id
             WHERE k.first_name <> '' AND k.last_name <> '' AND k.email IS NOT NULL AND cardinality(c.topics) > 0
             ORDER BY c.id, k.last_contact_at DESC NULLS LAST, k.id) k
       ORDER BY k.company_last_contact_at DESC NULLS LAST, k.id
       LIMIT $1`,
      // Some to spare for namesakes
      [limit * 2],
    );
    const found = await this.identify(rows.map((row) => ({ name: row.full_name, company: row.company })));
    return rows
      .filter((row, i) => found[i].party?.id === row.id)
      .slice(0, limit)
      .map((row) => ({
        firstName: row.first_name,
        fullName: row.full_name,
        jobTitle: row.job_title,
        company: { name: row.company, topics: row.topics },
      }));
  }

  private async companies(name: string): Promise<CompanyMatch[]> {
    // Both directions: "nordwerk" in "nordwerk logistik" and "nordwerk logistik hamburg" around "nordwerk logistik"
    const score = this.fuzzy
      ? `GREATEST(word_similarity($1, c.normalized_name),
                  CASE WHEN length(c.normalized_name) >= 5 THEN word_similarity(c.normalized_name, $1) ELSE 0 END)`
      : `CASE WHEN c.normalized_name ILIKE $2 OR (length(c.normalized_name) >= 5 AND $1 ILIKE '%' || c.normalized_name || '%') THEN 1 ELSE 0 END`;
    const rows = await this.dataSource.query<
      { id: string; name: string; relationship: CrmRelationship; industry: string | null; city: string | null }[]
    >(
      `SELECT id, name, relationship, industry, city
       FROM (SELECT c.*, ${score} AS score FROM crm_companies c WHERE c.normalized_name <> '') c
       WHERE c.score >= 0.5 OR c.normalized_name ILIKE $2
       ORDER BY c.score DESC, c.last_contact_at DESC NULLS LAST, c.id
       LIMIT ${COMPANY_LIMIT}`,
      [name, likePattern(name)],
    );
    if (!rows.length) return [];

    const people = await this.dataSource.query<{ id: string; company_id: string; full_name: string; job_title: string | null }[]>(
      `SELECT id, company_id, full_name, job_title
       FROM (SELECT k.*, row_number() OVER (PARTITION BY k.company_id ORDER BY k.last_contact_at DESC NULLS LAST, k.id) AS position
             FROM crm_contacts k WHERE k.company_id = ANY($1)) k
       WHERE k.position <= ${CONTACTS_PER_COMPANY}`,
      [rows.map((r) => r.id)],
    );
    return rows.map((r) => ({
      ...r,
      contacts: people.filter((k) => k.company_id === r.id).map((k) => ({ id: k.id, fullName: k.full_name, jobTitle: k.job_title })),
    }));
  }

  private async contacts(name: string, companyIds: string[]): Promise<ContactMatch[]> {
    const score = this.fuzzy
      ? `GREATEST(word_similarity($1, k.normalized_name), word_similarity(k.normalized_name, $1))`
      : `CASE WHEN k.normalized_name ILIKE $2 OR $1 ILIKE '%' || k.normalized_name || '%' THEN 1 ELSE 0 END`;
    const rows = await this.dataSource.query<
      { id: string; full_name: string; job_title: string | null; email: string | null; company_id: string | null; company_name: string | null }[]
    >(
      `SELECT k.id, k.full_name, k.job_title, k.email, c.id AS company_id, c.name AS company_name
       FROM (SELECT k.*, ${score} AS score FROM crm_contacts k WHERE k.normalized_name <> '') k
       LEFT JOIN crm_companies c ON c.id = k.company_id
       WHERE k.score >= 0.6 OR k.normalized_name ILIKE $2
       ORDER BY (k.company_id = ANY($3)) DESC NULLS LAST, k.score DESC, k.last_contact_at DESC NULLS LAST, k.id
       LIMIT ${CONTACT_LIMIT}`,
      [name, likePattern(name), companyIds],
    );
    return rows.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      jobTitle: r.job_title,
      email: r.email,
      company: r.company_id ? { id: r.company_id, name: r.company_name ?? '' } : null,
    }));
  }
}

/** `name` is `wanted`, or `wanted` is a whole part of it: "arnold autohaus" in "testdaten arnold autohaus", not "arnold auto". */
function carries(name: string, wanted: string): boolean {
  return name === wanted || (wanted.length >= MIN_NAME_PART && ` ${name} `.includes(` ${wanted} `));
}

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
