import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { KnowledgeCategory, KnowledgeSourceType } from '../entities/knowledge-source.entity';

export class SearchKnowledgeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  query: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  companyIds?: string[];

  @IsOptional()
  @IsArray()
  @IsEnum(KnowledgeCategory, { each: true })
  categories?: KnowledgeCategory[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class KnowledgeHitDto {
  chunkId: string;
  content: string;
  /** Relative relevance, only comparable within one result list */
  score: number;
  /** Which search found the chunk */
  matchedBy: ('semantic' | 'keyword')[];
  pages: [number, number] | null;
  source: {
    id: string;
    type: KnowledgeSourceType;
    category: KnowledgeCategory;
    title: string;
    url: string | null;
    fileName: string | null;
  };
  company: { id: string; name: string };
}

export class KnowledgeSearchResponseDto {
  hits: KnowledgeHitDto[];
  /** false if the query could not be embedded; then only keyword search ran */
  semantic: boolean;
}
