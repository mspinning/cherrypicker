import { Response } from 'express';
import { VoiceEvent } from './dto/voice.dto';

/**
 * Answers a request with events while the work is still running
 * (`text/event-stream`, one `data: <json>` block per event). Nothing is sent
 * before the first event, so errors up to then can still be plain HTTP errors.
 */
export class EventStream {
  constructor(private readonly res: Response) {}

  get started(): boolean {
    return this.res.headersSent;
  }

  send(event: VoiceEvent): void {
    // The caller may have hung up in the meantime
    if (this.res.writableEnded || this.res.destroyed) return;
    if (!this.res.headersSent) {
      this.res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        // Proxies must pass every event on at once: no buffering, no compression
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      this.res.flushHeaders();
    }
    this.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  end(): void {
    if (!this.res.writableEnded) this.res.end();
  }
}
