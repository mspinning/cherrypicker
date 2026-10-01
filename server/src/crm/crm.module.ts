import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { CrmMergeService } from './crm-merge.service';
import { CrmController } from './crm.controller';
import { CrmService } from './crm.service';
import { CrmActivity } from './entities/crm-activity.entity';
import { CrmCompanyDomain } from './entities/crm-company-domain.entity';
import { CrmCompany } from './entities/crm-company.entity';
import { CrmContact } from './entities/crm-contact.entity';
import { CrmPartyDecision } from './entities/crm-party-decision.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([CrmCompany, CrmCompanyDomain, CrmContact, CrmActivity, CrmPartyDecision]),
    UsersModule,
  ],
  controllers: [CrmController],
  providers: [CrmService, CrmMergeService],
  // The mail import (and later the background sync) writes customers through the merge
  exports: [CrmMergeService, TypeOrmModule],
})
export class CrmModule {}
