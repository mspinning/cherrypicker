import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { Task, TaskEvidence, TaskKind, TaskStatus } from '../entities/task.entity';

export class ListTasksQueryDto {
  /** Also return tasks decided since then (ISO 8601), e.g. the start of the user's day; left out = only open ones */
  @IsOptional()
  @IsISO8601({ strict: true })
  decidedSince?: string;
}

export class ApproveTaskDto {
  /** The text as approved; left out = the proposed draft unchanged */
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  draft?: string;
}

export class TaskDto {
  id: string;
  kind: TaskKind;
  title: string;
  contactName: string;
  contactRole: string | null;
  companyName: string | null;
  dealValue: string | null;
  stage: string | null;
  lastContactAt: Date | null;
  confidence: number;
  dueAt: Date;
  subject: string | null;
  draft: string;
  summary: string;
  evidence: TaskEvidence[];
  approvalNote: string;
  status: TaskStatus;
  /** Only set if the approved text differs from `draft` */
  finalDraft: string | null;
  decidedAt: Date | null;

  static from(task: Task): TaskDto {
    return {
      id: task.id,
      kind: task.kind,
      title: task.title,
      contactName: task.contactName,
      contactRole: task.contactRole,
      companyName: task.companyName,
      dealValue: task.dealValue,
      stage: task.stage,
      lastContactAt: task.lastContactAt,
      confidence: task.confidence,
      dueAt: task.dueAt,
      subject: task.subject,
      draft: task.draft,
      summary: task.summary,
      evidence: task.evidence,
      approvalNote: task.approvalNote,
      status: task.status,
      finalDraft: task.finalDraft,
      decidedAt: task.decidedAt,
    };
  }
}
