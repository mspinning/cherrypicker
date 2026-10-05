import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UsersService } from '../users/users.service';
import { CallStartedDto, StartCallDto, TurnDto, VoiceEvent, VoiceStatusDto } from './dto/voice.dto';
import { EventStream } from './event-stream';
import { VoiceService } from './voice.service';

/**
 * Voice calls of the signed-in user with the assistant. Turns and the
 * wrap-up answer as an event stream (see `VoiceEvent`), so the call screen
 * shows what was understood and what the agent is doing while it works.
 */
@ApiTags('voice')
@ApiBearerAuth()
@Controller('voice')
export class VoiceController {
  constructor(
    private readonly voice: VoiceService,
    private readonly users: UsersService,
  ) {}

  @Get()
  status(): VoiceStatusDto {
    return this.voice.status();
  }

  @Post('calls')
  async start(@CurrentUser() claims: AuthenticatedUser, @Body() dto: StartCallDto): Promise<CallStartedDto> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    return this.voice.start(user, dto.timeZone);
  }

  /** What the caller said (`audio`: WAV, 16 bit PCM) or typed (`text`). */
  @Post('calls/:id/turns')
  @UseInterceptors(FileInterceptor('audio'))
  @ApiConsumes('multipart/form-data', 'application/json')
  @ApiBody({ schema: { type: 'object', properties: { audio: { type: 'string', format: 'binary' }, text: { type: 'string' } } } })
  async turn(
    @CurrentUser() claims: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() audio: Express.Multer.File | undefined,
    @Body() dto: TurnDto,
    @Res() res: Response,
  ): Promise<void> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    if (!audio && !dto.text) throw new BadRequestException('Aufnahme oder Text fehlt');
    if (audio) this.voice.checkAudio(audio.buffer);
    await this.voice.requireActive(user.id, id);
    await this.stream(res, (emit) => this.voice.turn(user, id, { audio: audio?.buffer, text: dto.text }, emit));
  }

  /** Hangs up; the agent then creates customers and tasks. */
  @Post('calls/:id/finish')
  async finish(@CurrentUser() claims: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response): Promise<void> {
    const user = await this.users.requireByKeycloakId(claims.sub);
    await this.voice.requireActive(user.id, id);
    await this.stream(res, (emit) => this.voice.finish(user, id, emit));
  }

  /** Errors before the first event are ordinary HTTP errors, later ones the last event of the stream. */
  private async stream(res: Response, work: (emit: (event: VoiceEvent) => void) => Promise<void>): Promise<void> {
    const events = new EventStream(res);
    try {
      await work((event) => events.send(event));
    } catch (err) {
      if (err instanceof HttpException && !events.started) throw err;
      events.send({ type: 'error', message: err instanceof HttpException ? err.message : this.voice.messageOf(err) });
    } finally {
      events.end();
    }
  }
}
