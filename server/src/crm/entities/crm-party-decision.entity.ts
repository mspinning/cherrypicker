import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { CrmCompany } from './crm-company.entity';

/** Who decided: a fixed rule, the LLM, or a person (deleting a company with "ignore"). */
export enum PartyDecider {
  Rule = 'rule',
  Llm = 'llm',
  User = 'user',
}

/**
 * What the CRM knows about a mail counterpart: a business domain
 * ("domain:acme.de") or a single freemail address ("email:max@gmx.de").
 * Shared by all mailboxes, so later imports and the background sync skip
 * known vendors without asking the LLM again, and never re-create what a
 * user threw out.
 */
@Entity('crm_party_decisions')
export class CrmPartyDecision {
  @PrimaryColumn({ length: 330 })
  key: string;

  /** customer, prospect, vendor, newsletter, … or "ignored" */
  @Column({ length: 30 })
  verdict: string;

  @Column({ type: 'real', default: 0 })
  confidence: number;

  @Column({ type: 'text', default: '' })
  reason: string;

  @Column({ name: 'decided_by', type: 'enum', enum: PartyDecider, enumName: 'crm_party_decider' })
  decidedBy: PartyDecider;

  /** How many mails the decision was based on; much more evidence later warrants a new look */
  @Column({ name: 'message_count', type: 'int', default: 0 })
  messageCount: number;

  @Column({ name: 'company_id', type: 'uuid', nullable: true })
  companyId: string | null;

  @ManyToOne(() => CrmCompany, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'company_id' })
  company?: CrmCompany | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
