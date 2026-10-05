import { Injectable, Logger, NotFoundException, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { CrmLookupService } from '../crm/crm-lookup.service';
import { User } from '../users/user.entity';
import { DEMO_TASK_COUNT, demoTasks } from './demo-tasks';
import { TaskDto } from './dto/task.dto';
import { Task, TaskStatus } from './entities/task.entity';

/** What an agent proposes; status and decision start empty. */
export type NewTask = Pick<
  Task,
  | 'kind'
  | 'title'
  | 'contactName'
  | 'contactRole'
  | 'companyName'
  | 'dealValue'
  | 'stage'
  | 'lastContactAt'
  | 'confidence'
  | 'dueAt'
  | 'subject'
  | 'draft'
  | 'summary'
  | 'evidence'
  | 'approvalNote'
>;

/** The tasks assigned to one sales person and what they decided about them. */
@Injectable()
export class TasksService implements OnApplicationBootstrap {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @InjectRepository(Task) private readonly tasks: Repository<Task>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly lookup: CrmLookupService,
  ) {}

  /**
   * Demo mode: every approved user who never had a task gets the demo queue,
   * told about people from the CRM so that every card opens its customer.
   * Accounts approved later get theirs on the next start, and so does
   * everybody once the CRM has customers.
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
    if (!users.length) {
      return;
    }
    const people = await this.lookup.recentPeople(DEMO_TASK_COUNT);
    if (!people.length) {
      this.logger.log('No demo tasks: the CRM has nobody to tell them about yet');
      return;
    }
    for (const user of users) {
      await this.tasks.save(demoTasks(user, people));
    }
    this.logger.log(`Demo tasks created for ${users.map((user) => user.email).join(', ')}`);
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
    return this.dtos(tasks);
  }

  /** A new open task for one sales person, e.g. from a voice call. */
  async create(assigneeId: string, task: NewTask): Promise<TaskDto> {
    return this.dto(await this.tasks.save(this.tasks.create({ ...task, assigneeId })));
  }

  /** `draft` is only kept if the assignee changed the proposed text. */
  async approve(userId: string, id: string, draft?: string): Promise<TaskDto> {
    const task = await this.findOwn(userId, id);
    task.status = TaskStatus.Approved;
    task.finalDraft = draft !== undefined && draft !== task.draft ? draft : null;
    task.decidedAt = new Date();
    return this.dto(await this.tasks.save(task));
  }

  async reject(userId: string, id: string): Promise<TaskDto> {
    const task = await this.findOwn(userId, id);
    task.status = TaskStatus.Rejected;
    task.finalDraft = null;
    task.decidedAt = new Date();
    return this.dto(await this.tasks.save(task));
  }

  /** Takes a decision back. */
  async reopen(userId: string, id: string): Promise<TaskDto> {
    const task = await this.findOwn(userId, id);
    task.status = TaskStatus.Open;
    task.finalDraft = null;
    task.decidedAt = null;
    return this.dto(await this.tasks.save(task));
  }

  /** Takes back every decision of the user, also those of earlier days. */
  async reopenAll(userId: string): Promise<void> {
    await this.tasks.update(
      { assigneeId: userId, status: Not(TaskStatus.Open) },
      { status: TaskStatus.Open, finalDraft: null, decidedAt: null },
    );
  }

  /**
   * A task only keeps the names of its contact and their company. Who that is
   * in the CRM, and the number to call, is looked up when the task is read,
   * so a number added later is there and a deleted customer is gone.
   */
  private async dtos(tasks: Task[]): Promise<TaskDto[]> {
    const contacts = await this.lookup.identify(tasks.map((task) => ({ name: task.contactName, company: task.companyName })));
    return tasks.map((task, i) => TaskDto.from(task, contacts[i]));
  }

  private async dto(task: Task): Promise<TaskDto> {
    return (await this.dtos([task]))[0];
  }

  /** Tasks of other people do not exist for the caller. */
  private async findOwn(userId: string, id: string): Promise<Task> {
    const task = await this.tasks.findOne({ where: { id, assigneeId: userId } });
    if (!task) throw new NotFoundException('Aufgabe nicht gefunden');
    return task;
  }
}
