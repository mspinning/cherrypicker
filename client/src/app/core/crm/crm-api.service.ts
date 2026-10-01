import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from '../auth/auth.service';
import { CompanyDetail, CompanyListItem, ContactDetail, ContactListItem, CrmSummary, Page, Relationship } from './crm.models';

const BASE = `${API_URL}/crm`;

/** Customers and their people. */
@Injectable({ providedIn: 'root' })
export class CrmApi {
  private readonly http = inject(HttpClient);

  summary(): Observable<CrmSummary> {
    return this.http.get<CrmSummary>(`${BASE}/summary`);
  }

  companies(query: { q?: string; relationship?: Relationship | ''; offset?: number; limit?: number }): Observable<Page<CompanyListItem>> {
    return this.http.get<Page<CompanyListItem>>(`${BASE}/companies`, { params: paramsOf(query) });
  }

  company(id: string): Observable<CompanyDetail> {
    return this.http.get<CompanyDetail>(`${BASE}/companies/${id}`);
  }

  /** `ignore`: the mail import never creates it again */
  removeCompany(id: string, ignore: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/companies/${id}`, { params: paramsOf({ ignore }) });
  }

  contacts(query: { q?: string; companyId?: string; offset?: number; limit?: number }): Observable<Page<ContactListItem>> {
    return this.http.get<Page<ContactListItem>>(`${BASE}/contacts`, { params: paramsOf(query) });
  }

  contact(id: string): Observable<ContactDetail> {
    return this.http.get<ContactDetail>(`${BASE}/contacts/${id}`);
  }

  removeContact(id: string, ignore: boolean): Observable<void> {
    return this.http.delete<void>(`${BASE}/contacts/${id}`, { params: paramsOf({ ignore }) });
  }
}

function paramsOf(query: Record<string, string | number | boolean | undefined>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params = params.set(key, String(value));
  }
  return params;
}
