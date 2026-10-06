import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { Task, TaskRevision } from './task.models';

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

  /** Lets the AI rework an open task with `hint`; takes as long as the model needs for a new draft */
  revise(id: string, hint: string): Observable<TaskRevision> {
    return this.http.post<TaskRevision>(`${BASE}/${id}/revise`, { hint });
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
