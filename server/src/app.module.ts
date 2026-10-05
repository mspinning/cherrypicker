import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import configuration, { AppConfig } from './config/configuration';
import { CrmModule } from './crm/crm.module';
import { HealthController } from './health/health.controller';
import { MicrosoftModule } from './integrations/microsoft/microsoft.module';
import { KeycloakModule } from './keycloak/keycloak.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MailImportModule } from './mail-import/mail-import.module';
import { TasksModule } from './tasks/tasks.module';
import { UsersModule } from './users/users.module';
import { VoiceModule } from './voice/voice.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const db = config.get('db', { infer: true });
        return {
          type: 'postgres',
          host: db.host,
          port: db.port,
          username: db.user,
          password: db.password,
          database: db.name,
          autoLoadEntities: true,
          synchronize: db.synchronize,
        };
      },
    }),
    KeycloakModule,
    UsersModule,
    AuthModule,
    KnowledgeModule,
    MicrosoftModule,
    CrmModule,
    MailImportModule,
    TasksModule,
    VoiceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
