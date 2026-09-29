import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  KnowledgeCategory,
  KnowledgeSource,
  KnowledgeSourceStatus,
  KnowledgeSourceType,
} from '../entities/knowledge-source.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Roughly 60 pages of plain text */
export const MAX_TEXT_CHARS = 200_000;

export class CreateTextSourceDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title: string;

  @IsEnum(KnowledgeCategory)
  category: KnowledgeCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_CHARS)
  content: string;
}

export class CreateUrlSourcesDto {
  /** Checked and normalized in the service, which reports invalid ones back */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  urls: string[];

  @IsEnum(KnowledgeCategory)
  category: KnowledgeCategory;
}

/** Multipart field next to the file */
export class UploadDocumentDto {
  @IsEnum(KnowledgeCategory)
  category: KnowledgeCategory;
}

export class UpdateSourceDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsEnum(KnowledgeCategory)
  category?: KnowledgeCategory;

  /** Text sources only; changes re-index the source */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_CHARS)
  content?: string;
}

export class ListSourcesQueryDto {
  @IsOptional()
  @IsEnum(KnowledgeSourceType)
  type?: KnowledgeSourceType;

  @IsOptional()
  @IsEnum(KnowledgeCategory)
  category?: KnowledgeCategory;

  /** `pending` = queued, processing or embedding */
  @IsOptional()
  @IsIn(['pending', 'failed', 'ready'])
  state?: 'pending' | 'failed' | 'ready';

  /** Matches title, file name and URL */
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class SourceResponseDto {
  id: string;
  companyId: string;
  type: KnowledgeSourceType;
  category: KnowledgeCategory;
  title: string;
  excerpt: string;
  charCount: number;
  url: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  pageCount: number | null;
  status: KnowledgeSourceStatus;
  error: string | null;
  chunkCount: number;
  processedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Only in GET /knowledge/sources/:id */
  content?: string;

  static from(source: KnowledgeSource, withContent = false): SourceResponseDto {
    return {
      id: source.id,
      companyId: source.companyId,
      type: source.type,
      category: source.category,
      title: source.title,
      excerpt: source.excerpt,
      charCount: source.charCount,
      url: source.url,
      fileName: source.fileName,
      mimeType: source.mimeType,
      fileSize: source.fileSize,
      pageCount: source.pageCount,
      status: source.status,
      error: source.error,
      chunkCount: source.chunkCount,
      processedAt: source.processedAt,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
      ...(withContent ? { content: source.content ?? '' } : {}),
    };
  }
}

export class SourcePageDto {
  items: SourceResponseDto[];
  total: number;
}

export class CreateUrlSourcesResponseDto {
  created: SourceResponseDto[];
  /** Already present for this company */
  duplicates: string[];
  /** Not an http(s) URL */
  invalid: string[];
}
