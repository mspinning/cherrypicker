import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import {
  ListGroupsQueryDto,
  MailImportGroupPageDto,
  MailImportJobDto,
  MailImportOverviewDto,
  StartImportDto,
} from './dto/mail-import.dto';
import { MailImportService } from './mail-import.service';

/** Initial import of customers from the user's own mailbox. */
@ApiTags('mail-import')
@ApiBearerAuth()
@Controller('mail-import')
export class MailImportController {
  constructor(
    private readonly imports: MailImportService,
    private readonly users: UsersService,
  ) {}

  /** Model state and the user's last imports. */
  @Get()
  async overview(@CurrentUser() claims: AuthenticatedUser): Promise<MailImportOverviewDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.imports.overview(user.id);
  }

  /** `mode: test` reads only the newest `maxMessages` mails; `full` everything of the last `months`. */
  @Post('jobs')
  async start(@CurrentUser() claims: AuthenticatedUser, @Body() dto: StartImportDto): Promise<MailImportJobDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.imports.start(user.id, dto);
  }

  /** Companies already written stay in the CRM. */
  @Post('jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@CurrentUser() claims: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<MailImportJobDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.imports.cancel(user.id, id);
  }

  /** Every counterpart of the import with its decision and the reason. */
  @Get('jobs/:id/groups')
  async groups(
    @CurrentUser() claims: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListGroupsQueryDto,
  ): Promise<MailImportGroupPageDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.imports.listGroups(user.id, id, query);
  }
}
