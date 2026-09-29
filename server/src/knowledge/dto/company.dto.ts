import { PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { GroupCompany } from '../entities/group-company.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateCompanyDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {}

export interface SourceCounts {
  text: number;
  url: number;
  document: number;
}

export class CompanyResponseDto {
  id: string;
  name: string;
  description: string;
  createdAt: Date;
  updatedAt: Date;
  /** Sources per type */
  counts: SourceCounts;
  /** Sources still being fetched, read or embedded */
  pending: number;
  failed: number;
  chunks: number;
  /** Chunks that already have a vector */
  embeddedChunks: number;

  static from(
    company: GroupCompany,
    stats?: Partial<Omit<CompanyResponseDto, 'id' | 'name' | 'description' | 'createdAt' | 'updatedAt'>>,
  ): CompanyResponseDto {
    return {
      id: company.id,
      name: company.name,
      description: company.description,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
      counts: stats?.counts ?? { text: 0, url: 0, document: 0 },
      pending: stats?.pending ?? 0,
      failed: stats?.failed ?? 0,
      chunks: stats?.chunks ?? 0,
      embeddedChunks: stats?.embeddedChunks ?? 0,
    };
  }
}
