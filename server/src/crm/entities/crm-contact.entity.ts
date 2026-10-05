import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CrmCompany, CrmSource } from './crm-company.entity';

/**
 * A person at a customer. One row per person: the primary address is unique,
 * further addresses of the same person land in `otherEmails`. People met in
 * person (voice call) may not have an address yet.
 */
@Entity('crm_contacts')
@Index(['companyId', 'normalizedName'])
export class CrmContact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** null for private customers (freemail address, no company in the signature) */
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => CrmCompany, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany | null;

  @Column({ name: 'first_name', length: 100, default: '' })
  firstName: string;

  @Column({ name: 'last_name', length: 100, default: '' })
  lastName: string;

  /** Display name; the import falls back to the address */
  @Column({ name: 'full_name', length: 200 })
  fullName: string;

  @Column({ name: 'normalized_name', length: 200, default: '' })
  normalizedName: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 320, nullable: true })
  email: string | null;

  @Column({ name: 'other_emails', type: 'text', array: true, default: () => "'{}'" })
  otherEmails: string[];

  @Column({ name: 'job_title', type: 'varchar', length: 150, nullable: true })
  jobTitle: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  department: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  mobile: string | null;

  @Column({ name: 'linkedin_url', type: 'varchar', length: 300, nullable: true })
  linkedinUrl: string | null;

  @Column({ type: 'enum', enum: CrmSource, enumName: 'crm_source', default: CrmSource.Manual })
  source: CrmSource;

  @Column({ name: 'first_contact_at', type: 'timestamptz', nullable: true })
  firstContactAt: Date | null;

  @Column({ name: 'last_contact_at', type: 'timestamptz', nullable: true })
  lastContactAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
