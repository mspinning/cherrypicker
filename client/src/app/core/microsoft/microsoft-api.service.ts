import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { CalendarEvent, MicrosoftStatus } from './microsoft.models';

/** Link to the user's Microsoft 365 account, and its Outlook calendar. */
@Injectable({ providedIn: 'root' })
export class MicrosoftApi {
  private readonly http = inject(HttpClient);

  status(): Observable<MicrosoftStatus> {
    return this.http.get<MicrosoftStatus>(`${API_URL}/integrations/microsoft`);
  }

  /** URL of the Microsoft sign-in; the browser has to navigate there itself. */
  connect(): Observable<{ url: string }> {
    return this.http.post<{ url: string }>(`${API_URL}/integrations/microsoft/connect`, {});
  }

  disconnect(): Observable<void> {
    return this.http.delete<void>(`${API_URL}/integrations/microsoft`);
  }

  events(from: Date, to: Date): Observable<CalendarEvent[]> {
    const params = new HttpParams().set('from', from.toISOString()).set('to', to.toISOString());
    return this.http.get<CalendarEvent[]>(`${API_URL}/calendar/events`, { params });
  }
}
