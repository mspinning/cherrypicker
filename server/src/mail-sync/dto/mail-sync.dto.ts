import { IsBoolean } from 'class-validator';
import { TaskStatus } from '../../tasks/entities/task.entity';
import { MailSyncItem, MailSyncOutcome } from '../entities/mail-sync-item.entity';
import { MailSyncState } from '../entities/mail-sync-state.entity';

export class UpdateMailSyncDto {
  @IsBoolean()
  enabled: boolean;
}

export class MailSyncStateDto {
  /** The user's own switch */
  enabled: boolean;
  /** A check is running right now */
  syncing: boolean;
  /** End of the last check that got through */
  lastSyncAt: Date | null;
  /** null while switched off */
  nextSyncAt: Date | null;
  /** Why the last check stopped early */
  lastError: string | null;
  messagesChecked: number;
  customersCreated: number;
  tasksCreated: number;

  static from(state: MailSyncState): MailSyncStateDto {
    return {
      enabled: state.enabled,
      syncing: state.syncingSince !== null,
      lastSyncAt: state.lastSyncAt,
      nextSyncAt: state.enabled ? state.nextSyncAt : null,
      lastError: state.lastError,
      messagesChecked: state.messagesChecked,
      customersCreated: state.customersCreated,
      tasksCreated: state.tasksCreated,
    };
  }
}

/** One mail the sync looked at and what came of it. */
export class MailSyncItemDto {
  id: string;
  direction: 'in' | 'out';
  fromName: string;
  fromEmail: string;
  subject: string;
  receivedAt: Date;
  outcome: MailSyncOutcome;
  /** customer, prospect, vendor, newsletter, … */
  verdict: string | null;
  reason: string | null;
  /** The mail brought a new customer into the CRM */
  customerCreated: boolean;
  company: { id: string; name: string } | null;
  task: { id: string; title: string; status: TaskStatus } | null;

  static from(item: MailSyncItem): MailSyncItemDto {
    return {
      id: item.id,
      direction: item.direction,
      fromName: item.fromName,
      fromEmail: item.fromEmail,
      subject: item.subject,
      receivedAt: item.receivedAt,
      outcome: item.outcome,
      verdict: item.verdict,
      reason: item.reason,
      customerCreated: item.customerCreated,
      company: item.company ? { id: item.company.id, name: item.company.name } : null,
      task: item.task ? { id: item.task.id, title: item.task.title, status: item.task.status } : null,
    };
  }
}

export class MailSyncOverviewDto {
  /** false: switched off on the server (MAIL_SYNC_INTERVAL_MINUTES=0) */
  available: boolean;
  /** false until LLM_MODEL is set */
  llmConfigured: boolean;
  intervalMinutes: number;
  /** null until the mailbox is connected */
  state: MailSyncStateDto | null;
  /** Newest first: incoming mails from outside the group, and own mails that brought a new customer */
  recent: MailSyncItemDto[];
}
