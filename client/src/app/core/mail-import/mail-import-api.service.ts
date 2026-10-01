import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { MailImportGroupPage, MailImportGroupStatus, MailImportJob, MailImportMode, MailImportOverview } from './mail-import.models';

const BASE = `${API_URL}/mail-import`;

/** Import of customers from the user's own mailbox. */
@Injectable({ providedIn: 'root' })
export class MailImportApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<MailImportOverview> {
    return this.http.get<MailImportOverview>(BASE);
  }

  start(body: { mode: MailImportMode; maxMessages?: number; months?: number }): Observable<MailImportJob> {
    return this.http.post<MailImportJob>(`${BASE}/jobs`, body);
  }

  cancel(id: string): Observable<MailImportJob> {
    return this.http.post<MailImportJob>(`${BASE}/jobs/${id}/cancel`, {});
  }

  groups(id: string, query: { status?: MailImportGroupStatus; offset?: number; limit?: number }): Observable<MailImportGroupPage> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params = params.set(key, String(value));
    }
    return this.http.get<MailImportGroupPage>(`${BASE}/jobs/${id}/groups`, { params });
  }
}
