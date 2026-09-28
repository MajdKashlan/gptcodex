import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextCustomer } from '../../models/customer.models';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { ErpNextItem } from '../../models/item.models';
import { ErpNextSalesOrder } from '../../models/sales-order.models';

export interface OrderOptions {
  customers: ErpNextCustomer[];
  items: ErpNextItem[];
  companies: Array<{ name: string; default_currency?: string }>;
  priceLists: string[];
  warehouses: string[];
}

export type SalesOrderData = Pick<
  ErpNextSalesOrder,
  'customer' | 'company' | 'transaction_date' | 'delivery_date' | 'currency' | 'selling_price_list' | 'set_warehouse' | 'items'
>;

@Injectable({ providedIn: 'root' })
export class OrdersService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  list(query = ''): Observable<ErpNextSalesOrder[]> {
    const fields = [
      'name',
      'customer',
      'customer_name',
      'company',
      'transaction_date',
      'delivery_date',
      'currency',
      'grand_total',
      'status',
      'docstatus',
      'modified',
    ];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '200')
      .set('order_by', 'modified desc');
    if (query.trim()) {
      const term = `%${query.trim()}%`;
      params = params.set('or_filters', JSON.stringify([
        ['Sales Order', 'name', 'like', term],
        ['Sales Order', 'customer', 'like', term],
        ['Sales Order', 'customer_name', 'like', term],
      ]));
    }
    return this.http
      .get<ErpNextListResponse<ErpNextSalesOrder>>(this.auth.apiUrl('/api/resource/Sales Order'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []));
  }

  loadOptions(): Observable<OrderOptions> {
    return forkJoin({
      customers: this.listRecords<ErpNextCustomer>('Customer', [
        'name', 'customer_name', 'default_currency', 'default_price_list',
      ], [['Customer', 'disabled', '=', 0]]),
      items: this.listRecords<ErpNextItem>('Item', [
        'name', 'item_code', 'item_name', 'stock_uom', 'standard_rate',
      ], [['Item', 'disabled', '=', 0]]),
      companies: this.listRecords<{ name: string; default_currency?: string }>('Company', ['name', 'default_currency']),
      priceLists: this.listNames('Price List', [['Price List', 'selling', '=', 1]]),
      warehouses: this.listNames('Warehouse', [['Warehouse', 'is_group', '=', 0]]),
    });
  }

  get(name: string): Observable<ErpNextSalesOrder> {
    return this.http
      .get<{ data: ErpNextSalesOrder }>(
        this.auth.apiUrl('/api/resource/Sales Order/' + encodeURIComponent(name)),
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  create(details: SalesOrderData): Observable<ErpNextSalesOrder> {
    return this.http
      .post<{ data: ErpNextSalesOrder }>(this.auth.apiUrl('/api/resource/Sales Order'), details, {
        withCredentials: true,
      })
      .pipe(map((response) => response.data));
  }

  update(name: string, details: SalesOrderData): Observable<ErpNextSalesOrder> {
    return this.http
      .put<{ data: ErpNextSalesOrder }>(
        this.auth.apiUrl('/api/resource/Sales Order/' + encodeURIComponent(name)),
        details,
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  private listNames(doctype: string, filters: unknown[][]): Observable<string[]> {
    return this.listRecords<{ name: string }>(doctype, ['name'], filters)
      .pipe(map((records) => records.map((record) => record.name)));
  }

  private listRecords<T>(doctype: string, fields: string[], filters: unknown[][] = []): Observable<T[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }
    return this.http
      .get<ErpNextListResponse<T>>(this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []), catchError(() => of([])));
  }
}