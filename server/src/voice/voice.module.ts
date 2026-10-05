import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CrmModule } from '../crm/crm.module';
import { GroupCompany } from '../knowledge/entities/group-company.entity';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../llm/llm.module';
import { TasksModule } from '../tasks/tasks.module';
import { UsersModule } from '../users/users.module';
import { CallAgent } from './call-agent.service';
import { CallTools } from './call-tools.service';
import { VoiceCall } from './entities/voice-call.entity';
import { SpeechToTextService } from './speech-to-text.service';
import { VoiceController } from './voice.controller';
import { VoiceService } from './voice.service';

/** Three minutes of 16 kHz mono speech, with room to spare */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

@Module({
  imports: [
    TypeOrmModule.forFeature([VoiceCall, GroupCompany]),
    // No storage option: multer keeps the recording in memory, it is never written to disk
    MulterModule.register({ limits: { fileSize: MAX_AUDIO_BYTES, files: 1 } }),
    CrmModule,
    KnowledgeModule,
    LlmModule,
    TasksModule,
    UsersModule,
  ],
  controllers: [VoiceController],
  providers: [VoiceService, SpeechToTextService, CallAgent, CallTools],
})
export class VoiceModule {}
