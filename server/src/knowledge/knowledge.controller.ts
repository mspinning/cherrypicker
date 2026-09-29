import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppConfig } from '../config/configuration';
import { UserRole } from '../users/user.entity';
import { CompanyResponseDto, CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';
import { KnowledgeSearchResponseDto, SearchKnowledgeDto } from './dto/search.dto';
import {
  CreateTextSourceDto,
  CreateUrlSourcesDto,
  CreateUrlSourcesResponseDto,
  ListSourcesQueryDto,
  SourcePageDto,
  SourceResponseDto,
  UpdateSourceDto,
  UploadDocumentDto,
} from './dto/source.dto';
import { SUPPORTED_EXTENSIONS } from './ingestion/text-extractor';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeOverview, KnowledgeService } from './knowledge.service';

/**
 * Knowledge base for agents: group companies with their texts, web pages and
 * documents. Managed by admins in the settings.
 */
@ApiTags('knowledge')
@ApiBearerAuth()
@Roles(UserRole.Admin)
@Controller('knowledge')
export class KnowledgeController {
  private readonly maxUploadBytes: number;

  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly searchService: KnowledgeSearchService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.maxUploadBytes = config.get('knowledge', { infer: true }).maxUploadBytes;
  }

  /** Companies with source counts, plus the state of the embedding pipeline. */
  @Get()
  async overview(): Promise<
    KnowledgeOverview & { limits: { maxUploadBytes: number; extensions: string[] } }
  > {
    return {
      ...(await this.knowledge.overview()),
      limits: { maxUploadBytes: this.maxUploadBytes, extensions: SUPPORTED_EXTENSIONS },
    };
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body() dto: SearchKnowledgeDto): Promise<KnowledgeSearchResponseDto> {
    return this.searchService.search(dto);
  }

  /** Skips the backoff after Bifrost or the model was fixed. */
  @Post('embedding/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  retryEmbedding(): void {
    this.knowledge.retryEmbedding();
  }

  // ---------- Companies ----------

  @Post('companies')
  createCompany(@Body() dto: CreateCompanyDto): Promise<CompanyResponseDto> {
    return this.knowledge.createCompany(dto);
  }

  @Patch('companies/:id')
  async updateCompany(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<{ id: string; name: string; description: string }> {
    const company = await this.knowledge.updateCompany(id, dto);
    return { id: company.id, name: company.name, description: company.description };
  }

  /** Deletes all sources and uploaded files of the company as well. */
  @Delete('companies/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCompany(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.knowledge.removeCompany(id);
  }

  @Get('companies/:id/sources')
  listSources(@Param('id', ParseUUIDPipe) id: string, @Query() query: ListSourcesQueryDto): Promise<SourcePageDto> {
    return this.knowledge.listSources(id, query);
  }

  @Post('companies/:id/texts')
  createText(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateTextSourceDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SourceResponseDto> {
    return this.knowledge.createText(id, dto, actor);
  }

  /** Several URLs at once; duplicates and invalid ones are reported, not rejected. */
  @Post('companies/:id/urls')
  createUrls(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateUrlSourcesDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<CreateUrlSourcesResponseDto> {
    return this.knowledge.createUrls(id, dto, actor);
  }

  /** One file per request, so the client can show progress per file and retry single ones. */
  @Post('companies/:id/documents')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file', 'category'],
      properties: { file: { type: 'string', format: 'binary' }, category: { type: 'string' } },
    },
  })
  uploadDocument(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<SourceResponseDto> {
    return this.knowledge.uploadDocument(id, file, dto.category, actor);
  }

  /** Retries every failed source of the company. */
  @Post('companies/:id/reprocess-failed')
  @HttpCode(HttpStatus.OK)
  async reprocessFailed(@Param('id', ParseUUIDPipe) id: string): Promise<{ queued: number }> {
    return { queued: await this.knowledge.reprocessFailed(id) };
  }

  // ---------- Sources ----------

  /** Including the full text */
  @Get('sources/:id')
  getSource(@Param('id', ParseUUIDPipe) id: string): Promise<SourceResponseDto> {
    return this.knowledge.getSource(id);
  }

  @Patch('sources/:id')
  updateSource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSourceDto): Promise<SourceResponseDto> {
    return this.knowledge.updateSource(id, dto);
  }

  @Post('sources/:id/reprocess')
  @HttpCode(HttpStatus.OK)
  reprocess(@Param('id', ParseUUIDPipe) id: string): Promise<SourceResponseDto> {
    return this.knowledge.reprocess(id);
  }

  @Get('sources/:id/file')
  async download(@Param('id', ParseUUIDPipe) id: string): Promise<StreamableFile> {
    const { source, data } = await this.knowledge.readFile(id);
    const fileName = source.fileName ?? 'dokument';
    return new StreamableFile(data, {
      type: source.mimeType ?? 'application/octet-stream',
      length: data.length,
      disposition: `attachment; filename="${fileName.replace(/[^\x20-\x7e]|"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    });
  }

  @Delete('sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSource(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.knowledge.removeSource(id);
  }
}
