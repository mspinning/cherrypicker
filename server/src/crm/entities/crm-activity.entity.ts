import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../../users/user.entity';
import { CrmCompany } from './crm-company.entity';
import { CrmContact } from './crm-contact.entity';

export enum CrmActivityType {
  Email = 'email',
}

export enum CrmActivityDirection {
  /** From the customer to us */
  In = 'in',
  /** From us to the customer */
  Out = 'out',
}

/**
 * One mail with a customer, as seen from one CRM user's mailbox. Only
 * metadata and the preview line are stored, never the full text; other users
 * only see that this user has contact, not the mails themselves.
 */
@Entity('crm_activities')
// The same mail never twice per company / private contact
@Index(['userId', 'externalId', 'partyKey'], { unique: true })
@Index(['companyId', 'occurredAt'])
@Index(['contactId', 'occurredAt'])
export class CrmActivity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Owner of the mailbox */
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => CrmCompany, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany | null;

  @Column({ name: 'contact_id', type: 'uuid', nullable: true })
  contactId: string | null;

  @ManyToOne(() => CrmContact, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'contact_id' })
  contact?: CrmContact | null;

  /** "company:<id>" or, for private customers, "contact:<id>" */
  @Column({ name: 'party_key', length: 60 })
  partyKey: string;

  /** Addresses of the customer's people on this mail (sender, to, cc), so a cc'd contact sees it too */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  participants: string[];

  @Column({ type: 'enum', enum: CrmActivityType, enumName: 'crm_activity_type', default: CrmActivityType.Email })
  type: CrmActivityType;

  @Column({ type: 'enum', enum: CrmActivityDirection, enumName: 'crm_activity_direction' })
  direction: CrmActivityDirection;

  @Column({ length: 500, default: '' })
  subject: string;

  @Column({ length: 600, default: '' })
  preview: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt: Date;

  /** Immutable Graph message id */
  @Column({ name: 'external_id', length: 400 })
  externalId: string;

  @Column({ name: 'conversation_id', type: 'varchar', length: 400, nullable: true })
  conversationId: string | null;

  /** Opens the mail in Outlook on the web (only for the mailbox owner) */
  @Column({ name: 'web_link', type: 'text', nullable: true })
  webLink: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
