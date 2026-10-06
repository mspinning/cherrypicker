import { Column, CreateDateColumn, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { User } from '../../users/user.entity';

/**
 * How far a user's mailbox has been checked for new mails, and when it is
 * due again. One row per connected mailbox; the table is also the worker's
 * schedule. Disconnecting the mailbox removes the row.
 */
@Entity('mail_sync_states')
export class MailSyncState {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** The user's own switch in the profile */
  @Column({ default: true })
  enabled: boolean;

  /** Mails received before this moment have been looked at */
  @Column({ name: 'checked_until', type: 'timestamptz' })
  checkedUntil: Date;

  @Column({ name: 'next_sync_at', type: 'timestamptz' })
  nextSyncAt: Date;

  /** Set while a check runs */
  @Column({ name: 'syncing_since', type: 'timestamptz', nullable: true })
  syncingSince: Date | null;

  /** End of the last check that got through */
  @Column({ name: 'last_sync_at', type: 'timestamptz', nullable: true })
  lastSyncAt: Date | null;

  /** Why the last check stopped early, in words for the profile */
  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  /** Checks that failed in a row; stretches the pause before the next one */
  @Column({ type: 'int', default: 0 })
  failures: number;

  /** Incoming mails from outside the group that were looked at */
  @Column({ name: 'messages_checked', type: 'int', default: 0 })
  messagesChecked: number;

  /** Mails nobody outside the group was on: from the owner, from colleagues or from machines */
  @Column({ name: 'messages_ignored', type: 'int', default: 0 })
  messagesIgnored: number;

  /** What counted as the own group at the last check, for the profile to explain what is passed over */
  @Column({ name: 'internal_domains', type: 'text', array: true, default: () => "'{}'" })
  internalDomains: string[];

  @Column({ name: 'customers_created', type: 'int', default: 0 })
  customersCreated: number;

  @Column({ name: 'tasks_created', type: 'int', default: 0 })
  tasksCreated: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
