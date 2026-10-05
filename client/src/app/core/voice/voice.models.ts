import { TaskKind } from '../tasks/task.models';

/** Response of GET /api/voice */
export interface VoiceStatus {
  /** false: the server has no models for calls, the call button stays hidden */
  available: boolean;
  reason: string | null;
}

/** Response of POST /api/voice/calls */
export interface CallStarted {
  id: string;
  /** The assistant's first words */
  greeting: string;
}

/** What a call left behind in the CRM */
export interface CallResult {
  /** The assistant's own words on what it did */
  summary: string;
  customers: {
    company: { id: string; name: string; created: boolean } | null;
    contact: { id: string; fullName: string; created: boolean } | null;
    /** Title of the note that now hangs on the customer */
    note: string | null;
  }[];
  tasks: { id: string; kind: TaskKind; title: string; contactName: string; companyName: string | null; dueAt: string }[];
}

/** One event of the stream that turns and the wrap-up answer with */
export type VoiceEvent =
  /** What the transcription understood */
  | { type: 'heard'; text: string }
  /** Nobody said anything in the recording */
  | { type: 'silence' }
  /** What the assistant is doing right now */
  | { type: 'step'; label: string }
  /** `hangup`: the assistant said goodbye */
  | { type: 'reply'; text: string; hangup: boolean }
  | { type: 'result'; result: CallResult }
  | { type: 'error'; message: string };
