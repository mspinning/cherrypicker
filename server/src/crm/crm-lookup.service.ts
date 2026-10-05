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

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
