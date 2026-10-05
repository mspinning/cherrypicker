import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ChatMessage } from '../../llm/llm.service';
import { TaskKind } from '../../tasks/entities/task.entity';
import { User } from '../../users/user.entity';

export enum VoiceCallStatus {
  /** The user is talking to the assistant */
  Active = 'active',
  /** Hung up; the agent writes customers and tasks */
  Wrapping = 'wrapping',
  Done = 'done',
  Failed = 'failed',
}

export interface VoiceTurn {
  role: 'user' | 'assistant';
  text: string;
  /** ISO 8601 */
  at: string;
}

/** What the call left behind in the CRM, shown after hanging up. */
export interface VoiceCallResult {
  /** The agent's own words on what it did */
  summary: string;
  customers: {
    company: { id: string; name: string; created: boolean } | null;
    contact: { id: string; fullName: string; created: boolean } | null;
    /** Title of the note that now hangs on the customer */
    note: string | null;
  }[];
  tasks: { id: string; kind: TaskKind; title: string; contactName: string; companyName: string | null; dueAt: string }[];
}

/**
 * One call of a sales person with the voice assistant: they tell what
 * happened with a customer, the agent turns it into CRM entries and tasks
 * once they hang up. The words are kept, the audio is not.
 */
@Entity('voice_calls')
@Index(['userId', 'startedAt'])
export class VoiceCall {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** The caller; tasks from the call are assigned to them */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'enum', enum: VoiceCallStatus, enumName: 'voice_call_status', default: VoiceCallStatus.Active })
  status: VoiceCallStatus;

  /** IANA zone of the caller's device: "Freitag um 10" means their Friday */
  @Column({ name: 'time_zone', length: 64 })
  timeZone: string;

  /** What was said, in order */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  turns: VoiceTurn[];

  /** The agent's chat with tool calls and their results, continued turn by turn */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  messages: ChatMessage[];

  /** Names from the CRM that came up; the transcription gets them as spelling hints */
  @Column({ type: 'text', array: true, default: () => "'{}'" })
  vocabulary: string[];

  @Column({ type: 'jsonb', nullable: true })
  result: VoiceCallResult | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;
}
