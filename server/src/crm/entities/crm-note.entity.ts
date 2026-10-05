import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/user.entity';
import { CrmCompany } from './crm-company.entity';
import { CrmContact } from './crm-contact.entity';

/**
 * What a CRM user reports about a conversation with a customer, e.g. told
 * to the voice assistant after a trade fair. Unlike the mails in
 * crm_activities, notes are written for the team: everybody sees them.
 */
@Entity('crm_notes')
@Index(['companyId', 'occurredAt'])
@Index(['contactId', 'occurredAt'])
export class CrmNote {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** null once the author's account is gone; the note stays */
  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'author_id' })
  author?: User | null;

  /** null for private customers */
  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => CrmCompany, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany | null;

  /** The person the conversation was with */
  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @ManyToOne(() => CrmContact, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact?: CrmContact | null;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text' })
  text: string;

  /** When the conversation took place */
  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  /** Where the note comes from, e.g. "voice:<call>:1"; a repeated request does not store it twice */
  @Index({ unique: true })
  @Column({ name: 'external_id', length: 120 })
  externalId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
