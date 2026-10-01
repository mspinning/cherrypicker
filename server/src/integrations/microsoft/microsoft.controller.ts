import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthenticatedUser } from '../../auth/authenticated-user';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { AppConfig } from '../../config/configuration';
import { UsersService } from '../../users/users.service';
import { CalendarService } from './calendar.service';
import { CalendarEventDto, CreateEventDto, ListEventsQueryDto, UpdateEventDto } from './dto/calendar.dto';
import { MicrosoftStatusDto } from './dto/microsoft-status.dto';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { MicrosoftAuthError, MICROSOFT_ERRORS } from './microsoft.errors';
import { MicrosoftEvents } from './microsoft.events';

const NONCE_COOKIE = 'cp_ms_oauth';
const COOKIE_PATH = '/api/integrations/microsoft';

/** Links the user's Microsoft 365 account (mail read, calendar read/write). */
@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations/microsoft')
export class MicrosoftController {
  private readonly logger = new Logger(MicrosoftController.name);
  private readonly secureCookie: boolean;
  private readonly redirectUri: string;

  constructor(
    private readonly auth: MicrosoftAuthService,
    private readonly users: UsersService,
    private readonly events: MicrosoftEvents,
    config: ConfigService<AppConfig, true>,
  ) {
    this.secureCookie = config.get('appPublicUrl', { infer: true }).startsWith('https:');
    this.redirectUri = config.get('microsoft', { infer: true }).redirectUri;
  }

  @Get()
  async status(@CurrentUser() claims: AuthenticatedUser): Promise<MicrosoftStatusDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    const connection = await this.auth.connection(user.id);
    return {
      configured: this.auth.configured,
      missingConfig: this.auth.missingConfig(),
      redirectUri: this.redirectUri,
      connection: connection && {
        email: connection.email,
        displayName: connection.displayName,
        status: connection.status,
        scopes: connection.scopes.split(' ').filter(Boolean),
        connectedAt: connection.connectedAt,
        lastError: connection.lastError,
      },
    };
  }

  /**
   * Returns the Microsoft sign-in URL. The browser navigates there and comes
   * back to /callback; the cookie ties both ends to the same browser.
   */
  @Post('connect')
  @HttpCode(HttpStatus.OK)
  async connect(
    @CurrentUser() claims: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ url: string }> {
    if (!this.auth.configured) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: MICROSOFT_ERRORS.notConfigured,
        message: 'Microsoft 365 ist auf dem Server noch nicht eingerichtet.',
      });
    }
    const user = await this.users.requireByKeycloakId(claims.sub);
    const { url, nonce } = this.auth.startAuthorization(user.id);
    res.cookie(NONCE_COOKIE, nonce, {
      httpOnly: true,
      // Lax: sent on the top-level redirect back from login.microsoftonline.com
      sameSite: 'lax',
      secure: this.secureCookie,
      path: COOKIE_PATH,
      maxAge: 10 * 60_000,
    });
    return { url };
  }

  /** Redirect target registered in Entra ID. A browser navigation, so no bearer token: the state proves who started it. */
  @Public()
  @Get('callback')
  async callback(
    @Query() query: { code?: string; state?: string; error?: string; error_description?: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.clearCookie(NONCE_COOKIE, { path: COOKIE_PATH, sameSite: 'lax', secure: this.secureCookie, httpOnly: true });
    let target = '/profile?microsoft=connected';
    try {
      const connection = await this.auth.completeAuthorization(query, cookieValue(req, NONCE_COOKIE));
      this.events.connected(connection.userId);
    } catch (err) {
      const reason = err instanceof MicrosoftAuthError ? err.reason : 'failed';
      if (!(err instanceof MicrosoftAuthError)) {
        this.logger.error(`Microsoft callback failed: ${(err as Error).message}`, (err as Error).stack);
      } else if (reason !== 'denied') {
        this.logger.warn(`Microsoft callback rejected (${reason}): ${err.message}`);
      }
      target = `/profile?microsoft=error&reason=${reason}`;
    }
    // Relative: lands on the origin the browser used (Caddy or ng serve)
    res.redirect(HttpStatus.FOUND, target);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async disconnect(@CurrentUser() claims: AuthenticatedUser): Promise<void> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    await this.auth.disconnect(user.id);
    this.events.disconnected(user.id);
  }
}

/** Outlook calendar of the signed-in user. */
@ApiTags('calendar')
@ApiBearerAuth()
@Controller('calendar')
export class CalendarController {
  constructor(
    private readonly calendar: CalendarService,
    private readonly users: UsersService,
  ) {}

  @Get('events')
  async list(@CurrentUser() claims: AuthenticatedUser, @Query() query: ListEventsQueryDto): Promise<CalendarEventDto[]> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.calendar.list(user.id, query.from, query.to);
  }

  @Post('events')
  async create(@CurrentUser() claims: AuthenticatedUser, @Body() dto: CreateEventDto): Promise<CalendarEventDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.calendar.create(user.id, dto);
  }

  @Patch('events/:id')
  async update(
    @CurrentUser() claims: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEventDto,
  ): Promise<CalendarEventDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.calendar.update(user.id, id, dto);
  }

  @Delete('events/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() claims: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    await this.calendar.remove(user.id, id);
  }
}

/** No cookie-parser in the stack; one cookie is easy to read by hand. */
function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}
