import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { ApproveTaskDto, ListTasksQueryDto, ReviseTaskDto, TaskDto, TaskRevisionDto } from './dto/task.dto';
import { TaskRevisionService } from './task-revision.service';
import { TasksService } from './tasks.service';

/** The signed-in user's own tasks, the cards on "Heute". */
@ApiTags('tasks')
@ApiBearerAuth()
@Controller('tasks')
export class TasksController {
  constructor(
    private readonly tasks: TasksService,
    private readonly revisions: TaskRevisionService,
    private readonly users: UsersService,
  ) {}

  /** Open tasks; with `decidedSince` also what was decided since then. */
  @Get()
  async list(@CurrentUser() claims: AuthenticatedUser, @Query() query: ListTasksQueryDto): Promise<TaskDto[]> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.tasks.list(user.id, query.decidedSince ? new Date(query.decidedSince) : undefined);
  }

  /** Takes back all of the user's decisions ("Demo neu starten"). */
  @Post('reopen')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reopenAll(@CurrentUser() claims: AuthenticatedUser): Promise<void> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    await this.tasks.reopenAll(user.id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() claims: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveTaskDto,
  ): Promise<TaskDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.tasks.approve(user.id, id, dto.draft);
  }

  /** Reworks an open task with a hint of its assignee; what the hint says about the customer goes into the CRM. */
  @Post(':id/revise')
  @HttpCode(HttpStatus.OK)
  async revise(
    @CurrentUser() claims: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviseTaskDto,
  ): Promise<TaskRevisionDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.revisions.revise(user, id, dto.hint);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@CurrentUser() claims: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<TaskDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.tasks.reject(user.id, id);
  }

  /** Undo of a decision. */
  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  async reopen(@CurrentUser() claims: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string): Promise<TaskDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.tasks.reopen(user.id, id);
  }
}
