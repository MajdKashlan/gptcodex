import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { ErpNextCustomer } from '../../models/customer.models';
import { ErpNextItem } from '../../models/item.models';
import { ErpNextSalesOrder } from '../../models/sales-order.models';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';

export interface DashboardCustomer {
  name: string;
  total: number;
}

export interface DashboardItem {
  name: string;
  quantity: number;
}

export interface DashboardData {
  salesOrderCount: number;
  openOrderCount: number;
  closedOrderCount: number;
  totalSales: number;
  customerCount: number;
  itemCount: number;
  topCustomers: DashboardCustomer[];
  popularItems: DashboardItem[];
  unavailableResources: string[];
}

@Injectable({ providedIn: 'root' })
export class HomeDashboardService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  load(): Observable<DashboardData> {
    const orders = this.list<ErpNextSalesOrder>('Sales Order', [
      'name',
      'customer',
      'customer_name',
      'grand_total',
      'status',
    ]);
    const customers = this.list<ErpNextCustomer>('Customer', ['name']);
    const items = this.list<ErpNextItem>('Item', ['name']);

    return forkJoin({ orders, customers, items }).pipe(
      map(({ orders, customers, items }) => this.toDashboardData(orders.data, customers.data, items.data, [
        ...(orders.denied ? ['Sales Order'] : []),
        ...(customers.denied ? ['Customer'] : []),
        ...(items.denied ? ['Item'] : []),
      ])),
    );
  }

  private list<T>(doctype: string, fields: string[]): Observable<{ data: T[]; denied: boolean }> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '100')
      .set('order_by', 'modified desc');

    return this.http
      .get<ErpNextListResponse<T>>(this.auth.apiUrl('/api/resource/' + doctype), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(
        map((response) => ({ data: response.data ?? [], denied: false })),
        catchError((error: unknown) =>
          of({ data: [], denied: error instanceof HttpErrorResponse && error.status === 403 }),
        ),
      );
  }

  private toDashboardData(
    orders: ErpNextSalesOrder[],
    customers: ErpNextCustomer[],
    items: ErpNextItem[],
    unavailableResources: string[],
  ): DashboardData {
    const customerTotals = new Map<string, number>();
    const itemQuantities = new Map<string, number>();

    for (const order of orders) {
      const customer = order.customer_name || order.customer;
      customerTotals.set(customer, (customerTotals.get(customer) ?? 0) + (order.grand_total ?? 0));

      for (const item of order.items ?? []) {
        itemQuantities.set(item.item_name || item.item_code, (itemQuantities.get(item.item_name || item.item_code) ?? 0) + item.qty);
      }
    }

    return {
      salesOrderCount: orders.length,
      openOrderCount: orders.filter((order) => !['Closed', 'Completed', 'Cancelled'].includes(order.status ?? '')).length,
      closedOrderCount: orders.filter((order) => ['Closed', 'Completed'].includes(order.status ?? '')).length,
      totalSales: orders.reduce((total, order) => total + (order.grand_total ?? 0), 0),
      customerCount: customers.length,
      itemCount: items.length,
      topCustomers: [...customerTotals.entries()]
        .map(([name, total]) => ({ name, total }))
        .sort((first, second) => second.total - first.total)
        .slice(0, 5),
      popularItems: [...itemQuantities.entries()]
        .map(([name, quantity]) => ({ name, quantity }))
        .sort((first, second) => second.quantity - first.quantity)
        .slice(0, 5),
      unavailableResources,
    };
  }
}
