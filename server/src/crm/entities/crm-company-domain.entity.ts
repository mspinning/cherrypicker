import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { CrmCompany } from './crm-company.entity';

/** A mail domain belongs to exactly one company: the primary key is what keeps imports free of duplicates. */
@Entity('crm_company_domains')
export class CrmCompanyDomain {
  /** Registrable domain in lower case, e.g. "acme.de" (not "mail.acme.de") */
  @PrimaryColumn({ length: 253 })
  domain: string;

  @Index()
  @Column({ name: 'company_id', type: 'uuid' })
  companyId: string;

  @ManyToOne(() => CrmCompany, (company) => company.domains, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
