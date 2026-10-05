import { HttpClient, HttpDownloadProgressEvent, HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { CallStarted, VoiceEvent, VoiceStatus } from './voice.models';

const BASE = `${API_URL}/voice`;

/** Voice calls with the assistant. */
@Injectable({ providedIn: 'root' })
export class VoiceApi {
  private readonly http = inject(HttpClient);

  status(): Observable<VoiceStatus> {
    return this.http.get<VoiceStatus>(BASE);
  }

  /** `timeZone`: "Friday at ten" in the call means the device's Friday */
  start(timeZone: string): Observable<CallStarted> {
    return this.http.post<CallStarted>(`${BASE}/calls`, { timeZone });
  }

  /** What the user said (a WAV recording) or typed; emits what the server understood and answers, as it happens */
  say(id: string, input: Blob | string): Observable<VoiceEvent> {
    if (typeof input === 'string') return this.stream(`${BASE}/calls/${id}/turns`, { text: input });
    const form = new FormData();
    form.append('audio', input, 'turn.wav');
    return this.stream(`${BASE}/calls/${id}/turns`, form);
  }

  /** Hangs up; emits the assistant's steps and at last the result */
  finish(id: string): Observable<VoiceEvent> {
    return this.stream(`${BASE}/calls/${id}/finish`, {});
  }

  /** Reads a `text/event-stream` answer block by block while it is still coming in. */
  private stream(url: string, body: FormData | object): Observable<VoiceEvent> {
    return new Observable<VoiceEvent>((subscriber) => {
      let parsed = 0;
      const read = (text: string) => {
        const end = text.lastIndexOf('\n\n');
        if (end < parsed) return;
        for (const block of text.slice(parsed, end).split('\n\n')) {
          const data = block.trim().replace(/^data:\s*/, '');
          if (data) subscriber.next(JSON.parse(data) as VoiceEvent);
        }
        parsed = end + 2;
      };
      const request = this.http.post(url, body, { observe: 'events', reportProgress: true, responseType: 'text' }).subscribe({
        next: (event) => {
          if (event.type === HttpEventType.DownloadProgress) read((event as HttpDownloadProgressEvent).partialText ?? '');
          else if (event.type === HttpEventType.Response) {
            read(`${event.body ?? ''}\n\n`);
            subscriber.complete();
          }
        },
        error: (err: unknown) => subscriber.error(err),
      });
      return () => request.unsubscribe();
    });
  }
}
