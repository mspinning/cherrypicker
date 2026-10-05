import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmModule } from '../crm/crm.module';
import { User } from '../users/user.entity';
import { UsersModule } from '../users/users.module';
import { Task } from './entities/task.entity';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  // The CRM tells who the contact of a task is
  imports: [TypeOrmModule.forFeature([Task, User]), UsersModule, CrmModule],
  controllers: [TasksController],
  providers: [TasksService],
  // Agents create tasks through the service
  exports: [TasksService],
})
export class TasksModule {}
