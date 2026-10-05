import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { MailSyncOverview, MailSyncState } from './mail-sync.models';

const BASE = `${API_URL}/mail-sync`;

/** Background check of the user's own mailbox for new customers and opportunities. */
@Injectable({ providedIn: 'root' })
export class MailSyncApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<MailSyncOverview> {
    return this.http.get<MailSyncOverview>(BASE);
  }

  setEnabled(enabled: boolean): Observable<MailSyncState> {
    return this.http.patch<MailSyncState>(BASE, { enabled });
  }

  /** Checks the mailbox now instead of at the next interval */
  run(): Observable<MailSyncState> {
    return this.http.post<MailSyncState>(`${BASE}/run`, {});
  }
}
