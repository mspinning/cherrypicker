import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { VoiceCallResult } from '../entities/voice-call.entity';

export class StartCallDto {
  /** IANA time zone of the device, e.g. "Europe/Berlin"; relative dates in the call are meant in it */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timeZone?: string;
}

export class TurnDto {
  /** What the user typed instead of saying it; ignored if `audio` is sent */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  text?: string;
}

export class VoiceStatusDto {
  /** false: the call button stays hidden */
  available: boolean;
  /** Why not, for admins */
  reason: string | null;
}

export class CallStartedDto {
  id: string;
  /** The assistant's first words */
  greeting: string;
}

/** Lines of the event stream (`data: <json>`) that turns and the wrap-up answer with. */
export type VoiceEvent =
  /** What the transcription understood */
  | { type: 'heard'; text: string }
  /** Nobody said anything in the recording */
  | { type: 'silence' }
  /** What the agent is doing right now, e.g. "Suche Nordwerk Logistik im CRM" */
  | { type: 'step'; label: string }
  /** The assistant's answer; `hangup`: it said goodbye, the client ends the call */
  | { type: 'reply'; text: string; hangup: boolean }
  /** After hanging up: what was created */
  | { type: 'result'; result: VoiceCallResult }
  | { type: 'error'; message: string };
