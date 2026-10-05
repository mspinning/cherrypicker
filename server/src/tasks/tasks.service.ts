import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { User } from '../users/user.entity';
import { demoTasks } from './demo-tasks';
import { TaskDto } from './dto/task.dto';
import { Task, TaskStatus } from './entities/task.entity';

/** The tasks assigned to one sales person and what they decided about them. */
@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Demo mode: every approved user who never had a task gets the demo queue.
   * Accounts approved later get theirs on the next start.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.config.get('tasks', { infer: true }).seedDemo) {
      return;
    }
    const users = await this.users
      .createQueryBuilder('u')
      .where('u.approvedAt IS NOT NULL')
      .andWhere('NOT EXISTS (SELECT 1 FROM tasks t WHERE t.assignee_id = u.id)')
      .getMany();
    for (const user of users) {
      await this.tasks.save(demoTasks(user));
    }
    if (users.length) {
      this.logger.log(`Demo tasks created for ${users.map((user) => user.email).join(', ')}`);
    }
  }

  /**
   * Open tasks by due time. With `decidedSince` the ones decided since then
   * come first, in the order they were decided.
   */
  async list(userId: string, decidedSince?: Date): Promise<TaskDto[]> {
    const qb = this.tasks.createQueryBuilder('t').where('t.assigneeId = :userId', { userId });
    if (decidedSince) {
      qb.andWhere('(t.status = :open OR t.decidedAt >= :decidedSince)', { open: TaskStatus.Open, decidedSince });
    } else {
      qb.andWhere('t.status = :open', { open: TaskStatus.Open });
    }
    const tasks = await qb
      .orderBy('t.decidedAt', 'ASC', 'NULLS LAST')
      .addOrderBy('t.dueAt', 'ASC')
      .addOrderBy('t.createdAt', 'ASC')
      .addOrderBy('t.id', 'ASC')
      .getMany();
    return tasks.map((task) => TaskDto.from(task));
  }

  /** `draft` is only kept if the assignee changed the proposed text. */
  async approve(userId: string, id: string, draft?: string): Promise<TaskDto> {
    const task = await this.findOwn(userId, id);
    task.status = TaskStatus.Approved;
    task.finalDraft = draft !== undefined && draft !== task.draft ? draft : null;
    task.decidedAt = new Date();
    return TaskDto.from(await this.tasks.save(task));
  }

  async reject(userId: string, id: string): Promise<TaskDto> {
    const task = await this.findOwn(userId, id);
    task.status = TaskStatus.Rejected;
    task.finalDraft = null;
    task.decidedAt = new Date();
    return TaskDto.from(await this.tasks.save(task));
  }

  /** Takes a decision back. */
  async reopen(userId: string, id: string): Promise<TaskDto> {
    const task = await this.findOwn(userId, id);
    task.status = TaskStatus.Open;
    task.finalDraft = null;
    task.decidedAt = null;
    return TaskDto.from(await this.tasks.save(task));
  }

  /** Takes back every decision of the user, also those of earlier days. */
  async reopenAll(userId: string): Promise<void> {
    await this.tasks.update(
      { assigneeId: userId, status: Not(TaskStatus.Open) },
      { status: TaskStatus.Open, finalDraft: null, decidedAt: null },
    );
  }

  /** Tasks of other people do not exist for the caller. */
  private async findOwn(userId: string, id: string): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id, assigneeId: userId } });
    if (!task) throw new NotFoundException('Aufgabe nicht gefunden');
    return task;
  }
}
