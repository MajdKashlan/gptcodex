import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { ErpNextCustomer } from '../../models/customer.models';

export interface CustomerFormData {
  customer_name: string;
  customer_type: string;
  customer_group: string;
  territory: string;
  default_currency: string;
  default_price_list: string;
  disabled: 0 | 1;
}

export interface CustomerOptions {
  groups: string[];
  territories: string[];
  currencies: string[];
  priceLists: string[];
}

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  list(query = ''): Observable<ErpNextCustomer[]> {
    const fields = [
      'name',
      'customer_name',
      'customer_type',
      'customer_group',
      'territory',
      'default_currency',
      'default_price_list',
      'disabled',
      'modified',
    ];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '200')
      .set('order_by', 'modified desc');
    const term = query.trim();
    if (term) {
      params = params.set('or_filters', JSON.stringify([
        ['Customer', 'name', 'like', `%${term}%`],
        ['Customer', 'customer_name', 'like', `%${term}%`],
      ]));
    }

    return this.http
      .get<ErpNextListResponse<ErpNextCustomer>>(this.auth.apiUrl('/api/resource/Customer'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []));
  }

  loadOptions(): Observable<CustomerOptions> {
    return forkJoin({
      groups: this.listNames('Customer Group', [['Customer Group', 'is_group', '=', 0]]),
      territories: this.listNames('Territory', [['Territory', 'is_group', '=', 0]]),
      currencies: this.listNames('Currency'),
      priceLists: this.listNames('Price List', [['Price List', 'selling', '=', 1]]),
    });
  }

  get(name: string): Observable<ErpNextCustomer> {
    return this.http
      .get<{ data: ErpNextCustomer }>(
        this.auth.apiUrl('/api/resource/Customer/' + encodeURIComponent(name)),
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  create(details: CustomerFormData): Observable<ErpNextCustomer> {
    return this.http
      .post<{ data: ErpNextCustomer }>(this.auth.apiUrl('/api/resource/Customer'), details, {
        withCredentials: true,
      })
      .pipe(map((response) => response.data));
  }

  update(name: string, details: CustomerFormData): Observable<ErpNextCustomer> {
    return this.http
      .put<{ data: ErpNextCustomer }>(
        this.auth.apiUrl('/api/resource/Customer/' + encodeURIComponent(name)),
        details,
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  private listNames(doctype: string, filters: unknown[][] = []): Observable<string[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(
        map((response) => (response.data ?? []).map((row) => row.name)),
        catchError(() => of([])),
      );
  }
}