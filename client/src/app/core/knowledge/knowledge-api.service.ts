import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import {
  CreateUrlsResult,
  GroupCompany,
  KnowledgeOverview,
  KnowledgeSource,
  SourceCategory,
  SourcePage,
  SourceQuery,
} from './knowledge.models';

const BASE = `${API_URL}/knowledge`;

/** Admin API for group companies and their knowledge sources. */
@Injectable({ providedIn: 'root' })
export class KnowledgeApi {
  private readonly http = inject(HttpClient);

  overview(): Observable<KnowledgeOverview> {
    return this.http.get<KnowledgeOverview>(BASE);
  }

  retryEmbedding(): Observable<void> {
    return this.http.post<void>(`${BASE}/embedding/retry`, {});
  }

  createCompany(body: { name: string; description: string }): Observable<GroupCompany> {
    return this.http.post<GroupCompany>(`${BASE}/companies`, body);
  }

  updateCompany(id: string, body: { name?: string; description?: string }): Observable<Pick<GroupCompany, 'id' | 'name' | 'description'>> {
    return this.http.patch<Pick<GroupCompany, 'id' | 'name' | 'description'>>(`${BASE}/companies/${id}`, body);
  }

  /** Deletes all sources and files of the company too. */
  removeCompany(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/companies/${id}`);
  }

  sources(companyId: string, query: SourceQuery): Observable<SourcePage> {
    let params = new HttpParams().set('type', query.type);
    for (const key of ['category', 'state', 'q', 'offset', 'limit'] as const) {
      const value = query[key];
      if (value !== undefined && value !== '') params = params.set(key, String(value));
    }
    return this.http.get<SourcePage>(`${BASE}/companies/${companyId}/sources`, { params });
  }

  source(id: string): Observable<KnowledgeSource> {
    return this.http.get<KnowledgeSource>(`${BASE}/sources/${id}`);
  }

  createText(companyId: string, body: { title: string; category: SourceCategory; content: string }): Observable<KnowledgeSource> {
    return this.http.post<KnowledgeSource>(`${BASE}/companies/${companyId}/texts`, body);
  }

  createUrls(companyId: string, body: { urls: string[]; category: SourceCategory }): Observable<CreateUrlsResult> {
    return this.http.post<CreateUrlsResult>(`${BASE}/companies/${companyId}/urls`, body);
  }

  /** Emits progress events; the last one is the response with the new source. */
  upload(companyId: string, file: File, category: SourceCategory): Observable<HttpEvent<KnowledgeSource>> {
    const form = new FormData();
    form.append('category', category);
    form.append('file', file, file.name);
    return this.http.post<KnowledgeSource>(`${BASE}/companies/${companyId}/documents`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  updateSource(id: string, body: { title?: string; category?: SourceCategory; content?: string }): Observable<KnowledgeSource> {
    return this.http.patch<KnowledgeSource>(`${BASE}/sources/${id}`, body);
  }

  reprocess(id: string): Observable<KnowledgeSource> {
    return this.http.post<KnowledgeSource>(`${BASE}/sources/${id}/reprocess`, {});
  }

  reprocessFailed(companyId: string): Observable<{ queued: number }> {
    return this.http.post<{ queued: number }>(`${BASE}/companies/${companyId}/reprocess-failed`, {});
  }

  removeSource(id: string): Observable<void> {
    return this.http.delete<void>(`${BASE}/sources/${id}`);
  }

  /** Through HttpClient, so the bearer token is attached; a plain link would not have it. */
  download(id: string): Observable<Blob> {
    return this.http.get(`${BASE}/sources/${id}/file`, { responseType: 'blob' });
  }
}
