import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { MailSyncOverviewDto, MailSyncStateDto, UpdateMailSyncDto } from './dto/mail-sync.dto';
import { MailSyncService } from './mail-sync.service';

/** Background check of the user's own mailbox for new customers and opportunities. */
@ApiTags('mail-sync')
@ApiBearerAuth()
@Controller('mail-sync')
export class MailSyncController {
  constructor(
    private readonly sync: MailSyncService,
    private readonly users: UsersService,
  ) {}

  /** State of the sync and what the last mails led to. */
  @Get()
  async overview(@CurrentUser() claims: AuthenticatedUser): Promise<MailSyncOverviewDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.sync.overview(user.id);
  }

  /** The user's own switch. */
  @Patch()
  async update(@CurrentUser() claims: AuthenticatedUser, @Body() dto: UpdateMailSyncDto): Promise<MailSyncStateDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.sync.setEnabled(user.id, dto.enabled);
  }

  /** Checks the mailbox now instead of at the next interval. */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async run(@CurrentUser() claims: AuthenticatedUser): Promise<MailSyncStateDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.sync.runNow(user.id);
  }
}
