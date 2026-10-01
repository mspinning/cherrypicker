import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ListEventsQueryDto {
  /** ISO 8601, e.g. 2026-10-01T00:00:00Z */
  @IsISO8601({ strict: true })
  from: string;

  @IsISO8601({ strict: true })
  to: string;
}

export class AttendeeDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(320)
  email: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;
}

export class CreateEventDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  subject: string;

  /** ISO 8601 with offset or Z; stored in UTC */
  @IsISO8601({ strict: true })
  start: string;

  @IsISO8601({ strict: true })
  end: string;

  /** Plain text */
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  body?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  /** Microsoft sends them an invitation */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AttendeeDto)
  attendees?: AttendeeDto[];

  /** Adds a Teams meeting (work and school accounts) */
  @IsOptional()
  @IsBoolean()
  isOnlineMeeting?: boolean;
}

export class UpdateEventDto extends PartialType(CreateEventDto) {}

export class CalendarPersonDto {
  name: string;
  email: string;
}

export class CalendarEventDto {
  id: string;
  subject: string;
  /** ISO 8601 in UTC */
  start: string;
  end: string;
  isAllDay: boolean;
  isCancelled: boolean;
  location: string;
  isOnlineMeeting: boolean;
  joinUrl: string | null;
  organizer: CalendarPersonDto | null;
  attendees: (CalendarPersonDto & { response: string })[];
  preview: string;
  /** Opens the event in Outlook on the web */
  webLink: string | null;
}
