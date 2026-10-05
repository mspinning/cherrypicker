import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmModule } from '../crm/crm.module';
import { MicrosoftModule } from '../integrations/microsoft/microsoft.module';
import { GroupCompany } from '../knowledge/entities/group-company.entity';
import { LlmModule } from '../llm/llm.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { MailImportGroup } from './entities/mail-import-group.entity';
import { MailImportJob } from './entities/mail-import-job.entity';
import { MailImportController } from './mail-import.controller';
import { MailImportService } from './mail-import.service';
import { MailImportWorker } from './mail-import.worker';
import { MailboxContext } from './mailbox-context.service';
import { RelationshipClassifier } from './relationship-classifier.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MailImportJob, MailImportGroup, User, GroupCompany]),
    CrmModule,
    MicrosoftModule,
    LlmModule,
    UsersModule,
  ],
  controllers: [MailImportController],
  providers: [MailImportService, MailImportWorker, RelationshipClassifier, MailboxContext],
  // The background sync classifies new counterparts the same way the import does
  exports: [RelationshipClassifier, MailboxContext],
})
export class MailImportModule {}
