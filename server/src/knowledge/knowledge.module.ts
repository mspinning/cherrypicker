import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { UsersModule } from '../users/users.module';
import { EmbeddingService } from './embedding.service';
import { GroupCompany } from './entities/group-company.entity';
import { KnowledgeChunk } from './entities/knowledge-chunk.entity';
import { KnowledgeSource } from './entities/knowledge-source.entity';
import { FileStorageService } from './file-storage.service';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { KnowledgeSearchService } from './knowledge-search.service';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([GroupCompany, KnowledgeSource, KnowledgeChunk]),
    MulterModule.registerAsync({
      inject: [ConfigService],
      // No storage option: multer keeps the file in memory, the service writes it
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        limits: { fileSize: config.get('knowledge', { infer: true }).maxUploadBytes, files: 1 },
        // Browsers send file names as UTF-8 ("Angebot Müller.pdf")
        defParamCharset: 'utf8',
      }),
    }),
    // RolesGuard reads the role through UsersService
    UsersModule,
  ],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    KnowledgeIngestionService,
    KnowledgeSearchService,
    EmbeddingService,
    FileStorageService,
  ],
  // For the agents to come
  exports: [KnowledgeSearchService],
})
export class KnowledgeModule {}
