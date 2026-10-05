import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { Task } from './task.models';

const BASE = `${API_URL}/tasks`;

/** The tasks assigned to the signed-in user. */
@Injectable({ providedIn: 'root' })
export class TasksApi {
  private readonly http = inject(HttpClient);

  /** Open tasks by due time; the ones decided since `decidedSince` (ISO 8601) come first */
  list(decidedSince: string): Observable<Task[]> {
    return this.http.get<Task[]>(BASE, { params: { decidedSince } });
  }

  /** `draft`: the edited text, left out if the proposal was approved as it is */
  approve(id: string, draft?: string): Observable<Task> {
    return this.http.post<Task>(`${BASE}/${id}/approve`, draft === undefined ? {} : { draft });
  }

  reject(id: string): Observable<Task> {
    return this.http.post<Task>(`${BASE}/${id}/reject`, {});
  }

  /** Takes a decision back */
  reopen(id: string): Observable<Task> {
    return this.http.post<Task>(`${BASE}/${id}/reopen`, {});
  }

  /** Takes back all own decisions, also those of earlier days */
  reopenAll(): Observable<void> {
    return this.http.post<void>(`${BASE}/reopen`, {});
  }
}
