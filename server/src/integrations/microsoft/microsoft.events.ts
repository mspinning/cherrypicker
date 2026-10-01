import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

/**
 * Connection changes for modules that build on the mailbox (the mail import
 * stops its jobs on disconnect) without the integration depending on them.
 */
@Injectable()
export class MicrosoftEvents {
  readonly connected$ = new Subject<string>();
  readonly disconnected$ = new Subject<string>();

  connected(userId: string): void {
    this.connected$.next(userId);
  }

  disconnected(userId: string): void {
    this.disconnected$.next(userId);
  }
}
