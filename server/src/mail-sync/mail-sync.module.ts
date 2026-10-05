import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmModule } from '../crm/crm.module';
import { MicrosoftModule } from '../integrations/microsoft/microsoft.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { MailImportModule } from '../mail-import/mail-import.module';
import { TasksModule } from '../tasks/tasks.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { MailSyncItem } from './entities/mail-sync-item.entity';
import { MailSyncState } from './entities/mail-sync-state.entity';
import { MailSyncController } from './mail-sync.controller';
import { MailSyncService } from './mail-sync.service';
import { MailSyncWorker } from './mail-sync.worker';
import { MailboxCheck } from './mailbox-check.service';
import { NextStepService } from './next-step.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MailSyncState, MailSyncItem, User]),
    CrmModule,
    MicrosoftModule,
    // Classifies new counterparts the way the import does
    MailImportModule,
    KnowledgeModule,
    LlmModule,
    TasksModule,
    UsersModule,
  ],
  controllers: [MailSyncController],
  providers: [MailSyncService, MailSyncWorker, MailboxCheck, NextStepService],
})
export class MailSyncModule {}
