import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../../users/users.module';
import { SecretBox } from '../secret-box.service';
import { CalendarService } from './calendar.service';
import { GraphClient } from './graph-client.service';
import { MicrosoftAuthService } from './microsoft-auth.service';
import { MicrosoftConnection } from './microsoft-connection.entity';
import { CalendarController, MicrosoftController } from './microsoft.controller';
import { MicrosoftEvents } from './microsoft.events';

@Module({
  imports: [TypeOrmModule.forFeature([MicrosoftConnection]), UsersModule],
  controllers: [MicrosoftController, CalendarController],
  providers: [SecretBox, MicrosoftAuthService, GraphClient, CalendarService, MicrosoftEvents],
  // The mail import reads mailboxes; later agents put meetings into calendars
  exports: [MicrosoftAuthService, GraphClient, CalendarService, MicrosoftEvents],
})
export class MicrosoftModule {}
