import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { GroupDecider, MailImportGroup, MailImportGroupStatus } from '../entities/mail-import-group.entity';
import { MailImportJob, MailImportMode, MailImportStatus } from '../entities/mail-import-job.entity';

export const TEST_LIMITS = { min: 10, max: 2000, default: 100 };

export class StartImportDto {
  @IsEnum(MailImportMode)
  mode: MailImportMode;

  /** Test mode: how many of the newest mails */
  @IsOptional()
  @IsInt()
  @Min(TEST_LIMITS.min)
  @Max(TEST_LIMITS.max)
  maxMessages?: number;

  /** Full mode: how many months back; left out = the whole mailbox */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  months?: number;
}

export class ListGroupsQueryDto {
  @IsOptional()
  @IsIn(['imported', 'skipped', 'failed', 'pending'])
  status?: `${MailImportGroupStatus}`;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class MailImportJobDto {
  id: string;
  mode: MailImportMode;
  status: MailImportStatus;
  maxMessages: number | null;
  since: Date | null;
  messagesScanned: number;
  groupsTotal: number;
  groupsPrefiltered: number;
  groupsAnalyzed: number;
  groupsImported: number;
  groupsFailed: number;
  companiesCreated: number;
  companiesUpdated: number;
  contactsCreated: number;
  contactsUpdated: number;
  activitiesCreated: number;
  model: string | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;

  static from(job: MailImportJob): MailImportJobDto {
    return {
      id: job.id,
      mode: job.mode,
      status: job.status,
      maxMessages: job.maxMessages,
      since: job.since,
      messagesScanned: job.messagesScanned,
      groupsTotal: job.groupsTotal,
      groupsPrefiltered: job.groupsPrefiltered,
      groupsAnalyzed: job.groupsAnalyzed,
      groupsImported: job.groupsImported,
      groupsFailed: job.groupsFailed,
      companiesCreated: job.companiesCreated,
      companiesUpdated: job.companiesUpdated,
      contactsCreated: job.contactsCreated,
      contactsUpdated: job.contactsUpdated,
      activitiesCreated: job.activitiesCreated,
      model: job.model,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }
}

export class MailImportOverviewDto {
  /** false until LLM_MODEL is set */
  llmConfigured: boolean;
  model: string;
  testLimits: typeof TEST_LIMITS;
  /** Newest first */
  jobs: MailImportJobDto[];
}

/** One counterpart of a job and how it was decided. */
export class MailImportGroupDto {
  id: string;
  label: string;
  domain: string | null;
  status: MailImportGroupStatus;
  verdict: string | null;
  decidedBy: GroupDecider | null;
  confidence: number | null;
  reason: string | null;
  company: { id: string; name: string } | null;
  /** Name the LLM read from the mails, also for skipped ones */
  companyName: string | null;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  lastAt: Date;
  people: { email: string; name: string }[];
  error: string | null;

  static from(group: MailImportGroup): MailImportGroupDto {
    return {
      id: group.id,
      label: group.label,
      domain: group.domain,
      status: group.status,
      verdict: group.verdict,
      decidedBy: group.decidedBy,
      confidence: group.confidence,
      reason: group.reason,
      company: group.company ? { id: group.company.id, name: group.company.name } : null,
      companyName: group.companyName,
      messageCount: group.messageCount,
      inboundCount: group.inboundCount,
      outboundCount: group.outboundCount,
      lastAt: group.lastAt,
      people: group.participants.slice(0, 5).map((p) => ({ email: p.email, name: p.name })),
      error: group.error,
    };
  }
}

export class MailImportGroupPageDto {
  items: MailImportGroupDto[];
  total: number;
  counts: Record<'imported' | 'skipped' | 'failed' | 'pending', number>;
}
