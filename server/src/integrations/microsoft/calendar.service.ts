import { BadRequestException, Injectable } from '@nestjs/common';
import { CalendarEventDto, CreateEventDto, UpdateEventDto } from './dto/calendar.dto';
import { GraphAddress, GraphClient, GraphDateTime, GraphEvent } from './graph-client.service';
import { GraphError } from './microsoft.errors';

const MAX_RANGE_DAYS = 366;
/** Graph event ids are URL-safe base64; anything else never reaches the Graph URL */
const EVENT_ID = /^[A-Za-z0-9=_-]{1,512}$/;

/** Read and write the Outlook calendar of the signed-in user. */
@Injectable()
export class CalendarService {
  constructor(private readonly graph: GraphClient) {}

  async list(userId: string, fromIso: string, toIso: string): Promise<CalendarEventDto[]> {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (to <= from) throw new BadRequestException('"to" muss nach "from" liegen');
    if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
      throw new BadRequestException(`Höchstens ${MAX_RANGE_DAYS} Tage auf einmal`);
    }
    return (await this.call(() => this.graph.events(userId, from, to))).map(toDto);
  }

  async create(userId: string, dto: CreateEventDto): Promise<CalendarEventDto> {
    const event = toGraph(dto);
    if (new Date(dto.end) <= new Date(dto.start)) throw new BadRequestException('Das Ende muss nach dem Beginn liegen');
    return toDto(await this.call(() => this.graph.createEvent(userId, event)));
  }

  async update(userId: string, id: string, dto: UpdateEventDto): Promise<CalendarEventDto> {
    return toDto(await this.call(() => this.graph.updateEvent(userId, checkId(id), toGraph(dto))));
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.call(() => this.graph.deleteEvent(userId, checkId(id)));
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (err) {
      throw err instanceof GraphError ? err.toHttp() : err;
    }
  }
}

function checkId(id: string): string {
  if (!EVENT_ID.test(id)) throw new BadRequestException('Ungültige Termin-ID');
  return id;
}

function toGraph(dto: Partial<CreateEventDto>): Record<string, unknown> {
  return {
    ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
    ...(dto.start !== undefined ? { start: utc(dto.start) } : {}),
    ...(dto.end !== undefined ? { end: utc(dto.end) } : {}),
    ...(dto.body !== undefined ? { body: { contentType: 'text', content: dto.body } } : {}),
    ...(dto.location !== undefined ? { location: { displayName: dto.location } } : {}),
    ...(dto.attendees !== undefined
      ? {
          attendees: dto.attendees.map((a) => ({
            emailAddress: { address: a.email, ...(a.name ? { name: a.name } : {}) },
            type: 'required',
          })),
        }
      : {}),
    ...(dto.isOnlineMeeting !== undefined
      ? { isOnlineMeeting: dto.isOnlineMeeting, ...(dto.isOnlineMeeting ? { onlineMeetingProvider: 'teamsForBusiness' } : {}) }
      : {}),
  };
}

/** Graph wants local date-time plus zone; UTC keeps it unambiguous. */
function utc(iso: string): GraphDateTime {
  return { dateTime: new Date(iso).toISOString().slice(0, 19), timeZone: 'UTC' };
}

/** "2026-10-01T08:00:00.0000000" (UTC, see Prefer header) → "2026-10-01T08:00:00.000Z" */
function fromGraph(value: GraphDateTime): string {
  return new Date(`${value.dateTime.slice(0, 19)}Z`).toISOString();
}

function person(address: GraphAddress | undefined): { name: string; email: string } | null {
  const email = address?.emailAddress?.address;
  return email ? { name: address?.emailAddress?.name ?? '', email: email.toLowerCase() } : null;
}

function toDto(event: GraphEvent): CalendarEventDto {
  return {
    id: event.id,
    subject: event.subject ?? '',
    start: fromGraph(event.start),
    end: fromGraph(event.end),
    isAllDay: event.isAllDay ?? false,
    isCancelled: event.isCancelled ?? false,
    location: event.location?.displayName ?? '',
    isOnlineMeeting: event.isOnlineMeeting ?? false,
    joinUrl: event.onlineMeeting?.joinUrl ?? null,
    organizer: person(event.organizer),
    attendees: (event.attendees ?? []).flatMap((a) => {
      const p = person(a);
      return p ? [{ ...p, response: a.status?.response ?? 'none' }] : [];
    }),
    preview: event.bodyPreview ?? '',
    webLink: event.webLink ?? null,
  };
}
