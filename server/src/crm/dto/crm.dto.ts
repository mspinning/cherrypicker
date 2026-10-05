import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { CrmActivityDirection } from '../entities/crm-activity.entity';
import { CrmRelationship, CrmSource } from '../entities/crm-company.entity';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class PageQueryDto {
  /** Matches names, addresses and domains */
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

export class ListCompaniesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsEnum(CrmRelationship)
  relationship?: CrmRelationship;
}

export class ListContactsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;
}

export class DeleteQueryDto {
  /** Also remember the domain / address, so imports never create it again */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  ignore?: boolean;
}

export class CompanyListItemDto {
  id: string;
  name: string;
  relationship: CrmRelationship;
  domains: string[];
  industry: string | null;
  city: string | null;
  contactCount: number;
  lastContactAt: Date | null;
  createdAt: Date;
}

export class ContactListItemDto {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  /** null for people nobody has an address of yet */
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
  mobile: string | null;
  company: { id: string; name: string } | null;
  lastContactAt: Date | null;
}

export class ActivityDto {
  id: string;
  direction: CrmActivityDirection;
  subject: string;
  preview: string;
  occurredAt: Date;
  webLink: string | null;
  contact: { id: string; fullName: string } | null;
}

/** What a CRM user reported about a conversation; visible to everybody. */
export class NoteDto {
  id: string;
  title: string;
  text: string;
  occurredAt: Date;
  /** null if the account no longer exists */
  author: string | null;
  contact: { id: string; fullName: string } | null;
}

/** A CRM user with mail contact to the company; the mails themselves stay private. */
export class KnownByDto {
  userId: string;
  name: string;
  mails: number;
  lastContactAt: Date | null;
}

export class CompanyDetailDto {
  id: string;
  name: string;
  relationship: CrmRelationship;
  source: CrmSource;
  domains: string[];
  website: string | null;
  industry: string | null;
  description: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  summary: string | null;
  topics: string[];
  firstContactAt: Date | null;
  lastContactAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  contacts: ContactListItemDto[];
  notes: NoteDto[];
  /** Only mails of the requesting user's mailbox */
  activities: ActivityDto[];
  knownBy: KnownByDto[];
}

export class ContactDetailDto extends ContactListItemDto {
  otherEmails: string[];
  department: string | null;
  linkedinUrl: string | null;
  source: CrmSource;
  firstContactAt: Date | null;
  createdAt: Date;
  notes: NoteDto[];
  activities: ActivityDto[];
}

export class CrmSummaryDto {
  companies: number;
  customers: number;
  prospects: number;
  contacts: number;
}

export class PageDto<T> {
  items: T[];
  total: number;
}
