import { Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import {
  CompanyDetailDto,
  CompanyListItemDto,
  ContactDetailDto,
  ContactListItemDto,
  CrmSummaryDto,
  DeleteQueryDto,
  ListCompaniesQueryDto,
  ListContactsQueryDto,
  PageDto,
} from './dto/crm.dto';
import { CrmService } from './crm.service';

/** Customers (companies) and their people, for every signed-in user. */
@ApiTags('crm')
@ApiBearerAuth()
@Controller('crm')
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly users: UsersService,
  ) {}

  @Get('summary')
  summary(): Promise<CrmSummaryDto> {
    return this.crm.summary();
  }

  @Get('companies')
  listCompanies(@Query() query: ListCompaniesQueryDto): Promise<PageDto<CompanyListItemDto>> {
    return this.crm.listCompanies(query);
  }

  /** With contacts; activities only from the requesting user's mailbox. */
  @Get('companies/:id')
  async getCompany(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() claims: AuthenticatedUser): Promise<CompanyDetailDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.crm.getCompany(id, user.id);
  }

  /** `?ignore=true` keeps the mail import from creating it again. */
  @Delete('companies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCompany(@Param('id', ParseUUIDPipe) id: string, @Query() query: DeleteQueryDto): Promise<void> {
    return this.crm.removeCompany(id, query.ignore ?? false);
  }

  @Get('contacts')
  listContacts(@Query() query: ListContactsQueryDto): Promise<PageDto<ContactListItemDto>> {
    return this.crm.listContacts(query);
  }

  @Get('contacts/:id')
  async getContact(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() claims: AuthenticatedUser): Promise<ContactDetailDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.crm.getContact(id, user.id);
  }

  @Delete('contacts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeContact(@Param('id', ParseUUIDPipe) id: string, @Query() query: DeleteQueryDto): Promise<void> {
    return this.crm.removeContact(id, query.ignore ?? false);
  }
}
