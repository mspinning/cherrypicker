import { Column, CreateDateColumn, Entity, Index, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CrmCompanyDomain } from './crm-company-domain.entity';

/** Only real customer relationships end up in the CRM; vendors and services never do. */
export enum CrmRelationship {
  /** Buys or has bought from the group */
  Customer = 'customer',
  /** Concrete interest (inquiry, offer sent), no order yet */
  Prospect = 'prospect',
}

export enum CrmSource {
  MailImport = 'mail_import',
  Manual = 'manual',
}

/**
 * A customer organization, shared by all CRM users. Duplicates are avoided
 * by its mail domains (crm_company_domains, unique) and, for companies
 * without own domain, by the normalized name.
 */
@Entity('crm_companies')
export class CrmCompany {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  /** Lower case, without legal form and punctuation ("ACME GmbH & Co. KG" → "acme") */
  @Index()
  @Column({ name: 'normalized_name', length: 200 })
  normalizedName: string;

  @Column({ type: 'enum', enum: CrmRelationship, enumName: 'crm_relationship' })
  relationship: CrmRelationship;

  @Column({ type: 'varchar', length: 300, nullable: true })
  website: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  industry: string | null;

  /** What the company does */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  street: string | null;

  @Column({ name: 'postal_code', type: 'varchar', length: 20, nullable: true })
  postalCode: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  city: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  country: string | null;

  /** What the relationship is about and where it stands, written by the import from the mails */
  @Column({ type: 'text', nullable: true })
  summary: string | null;

  @Column({ type: 'text', array: true, default: () => "'{}'" })
  topics: string[];

  @Column({ type: 'enum', enum: CrmSource, enumName: 'crm_source', default: CrmSource.Manual })
  source: CrmSource;

  @Column({ name: 'first_contact_at', type: 'timestamptz', nullable: true })
  firstContactAt: Date | null;

  @Index()
  @Column({ name: 'last_contact_at', type: 'timestamptz', nullable: true })
  lastContactAt: Date | null;

  @OneToMany(() => CrmCompanyDomain, (domain) => domain.company)
  domains?: CrmCompanyDomain[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
