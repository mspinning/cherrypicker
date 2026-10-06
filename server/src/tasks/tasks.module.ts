import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmModule } from '../crm/crm.module';
import { MicrosoftModule } from '../integrations/microsoft/microsoft.module';
import { GroupCompany } from '../knowledge/entities/group-company.entity';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { MailSyncItem } from '../mail-sync/entities/mail-sync-item.entity';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { Task } from './entities/task.entity';
import { TaskRevisionService } from './task-revision.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    // The mail a task came from and our own companies are read for a revision
    TypeOrmModule.forFeature([Task, User, MailSyncItem, GroupCompany]),
    UsersModule,
    // The CRM tells who the contact of a task is
    CrmModule,
    KnowledgeModule,
    LlmModule,
    MicrosoftModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TaskRevisionService],
  // Agents create tasks through the service
  exports: [TasksService],
})
export class TasksModule {}
