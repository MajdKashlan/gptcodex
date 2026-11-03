import { inject, Injectable } from '@angular/core';
import { catchError, forkJoin, map, Observable, of, switchMap } from 'rxjs';
import { FrappeApiService } from '../../core/api/frappe-api.service';
import { AppContextService } from '../../core/context/app-context.service';
import { frappeErrorMessage } from '../../core/http/frappe-error';
import { addDaysIso, formatDate, startOfMonthIso, todayIso } from '../../core/utils/date';

export interface DashboardCustomer {
  customer: string;
  name: string;
  total: number;
}

export interface DashboardItem {
  itemCode: string;
  name: string;
  quantity: number;
}

export interface DashboardTrendPoint {
  date: string;
  label: string;
  total: number;
  orderCount: number;
}

export interface DashboardData {
  currency: string;
  monthSales: number;
  monthOrderCount: number;
  submittedOrderCount: number;
  openOrderCount: number;
  draftOrderCount: number;
  outstanding: number;
  overdueInvoiceCount: number;
  customerCount: number;
  itemCount: number;
  topCustomers: DashboardCustomer[];
  popularItems: DashboardItem[] | null;
  salesTrend: DashboardTrendPoint[];
  /** Figures that failed to load, with the server's reason. */
  unavailable: string[];
}

const CLOSED_ORDER_STATUSES = ['Closed', 'Completed', 'Cancelled'];
const TREND_DAYS = 90;

/**
 * Dashboard figures, aggregated by ERPNext (SUM/COUNT/GROUP BY) rather than by
 * summing whatever page of records happened to be downloaded. Every number covers
 * all submitted documents, in the company's currency (`base_*` fields).
 */
@Injectable({ providedIn: 'root' })
export class HomeDashboardService {
  private readonly api = inject(FrappeApiService);
  private readonly appContext = inject(AppContextService);

  load(): Observable<DashboardData> {
    const today = todayIso();
    const trendStart = addDaysIso(today, -(TREND_DAYS - 1));
    const monthStart = startOfMonthIso(today);
    const unavailable: string[] = [];
    const soft = <T>(label: string, fallback: T) => (source: Observable<T>) =>
      source.pipe(catchError((error: unknown) => {
        unavailable.push(`${label} (${frappeErrorMessage(error)})`);
        return of(fallback);
      }));
    const submitted = ['Sales Order', 'docstatus', '=', 1];

    return this.appContext.context().pipe(
      switchMap((context) => forkJoin({
        month: this.api.getList<{ total: number; count: number }>('Sales Order', {
          fields: ['sum(base_grand_total) as total', 'count(name) as count'],
          filters: [submitted, ['Sales Order', 'transaction_date', '>=', monthStart]],
          pageLength: 1,
        }).pipe(soft('Sales Order', [] as Array<{ total: number; count: number }>)),
        submittedCount: this.api.getCount('Sales Order', [submitted]).pipe(soft('Sales Order', 0)),
        openCount: this.api.getCount('Sales Order', [submitted, ['Sales Order', 'status', 'not in', CLOSED_ORDER_STATUSES]])
          .pipe(soft('Sales Order', 0)),
        draftCount: this.api.getCount('Sales Order', [['Sales Order', 'docstatus', '=', 0]]).pipe(soft('Sales Order', 0)),
        receivables: this.api.getList<{ total: number; overdue: number }>('Sales Invoice', {
          fields: ['sum(outstanding_amount) as total', 'count(name) as overdue'],
          filters: [['Sales Invoice', 'docstatus', '=', 1], ['Sales Invoice', 'outstanding_amount', '>', 0]],
          pageLength: 1,
        }).pipe(soft('Sales Invoice', [] as Array<{ total: number; overdue: number }>)),
        overdueCount: this.api.getCount('Sales Invoice', [
          ['Sales Invoice', 'docstatus', '=', 1],
          ['Sales Invoice', 'outstanding_amount', '>', 0],
          ['Sales Invoice', 'due_date', '<', today],
        ]).pipe(soft('Sales Invoice', 0)),
        customerCount: this.api.getCount('Customer', [['Customer', 'disabled', '=', 0]]).pipe(soft('Customer', 0)),
        itemCount: this.api.getCount('Item', [['Item', 'disabled', '=', 0]]).pipe(soft('Item', 0)),
        trend: this.api.getList<{ transaction_date: string; total: number; orders: number }>('Sales Order', {
          fields: ['transaction_date', 'sum(base_grand_total) as total', 'count(name) as orders'],
          filters: [submitted, ['Sales Order', 'transaction_date', '>=', trendStart]],
          groupBy: 'transaction_date',
          orderBy: 'transaction_date asc',
          pageLength: 0,
        }).pipe(soft('Sales Order', [] as Array<{ transaction_date: string; total: number; orders: number }>)),
        customers: this.api.getList<{ customer: string; customer_name: string; total: number }>('Sales Order', {
          fields: ['customer', 'customer_name', 'sum(base_grand_total) as total'],
          filters: [submitted, ['Sales Order', 'transaction_date', '>=', trendStart]],
          groupBy: 'customer',
          orderBy: 'customer asc',
          pageLength: 0,
        }).pipe(soft('Sales Order', [] as Array<{ customer: string; customer_name: string; total: number }>)),
        items: this.popularItems(trendStart),
      }).pipe(map((result) => ({
        currency: context.currency,
        monthSales: Number(result.month[0]?.total ?? 0),
        monthOrderCount: Number(result.month[0]?.count ?? 0),
        submittedOrderCount: result.submittedCount,
        openOrderCount: result.openCount,
        draftOrderCount: result.draftCount,
        outstanding: Number(result.receivables[0]?.total ?? 0),
        overdueInvoiceCount: result.overdueCount,
        customerCount: result.customerCount,
        itemCount: result.itemCount,
        topCustomers: result.customers
          .map((row) => ({ customer: row.customer, name: row.customer_name || row.customer, total: Number(row.total) || 0 }))
          .sort((a, b) => b.total - a.total)
          .slice(0, 5),
        popularItems: result.items,
        salesTrend: buildTrend(result.trend, today),
        unavailable: [...new Set(unavailable)],
      })))),
    );
  }

  /**
   * Item quantities come from the `Sales Order Item` child table, which the plain
   * list endpoint never returns. Tries a parent-joined aggregate first and falls back
   * to querying the child table directly; `null` means neither was permitted.
   */
  private popularItems(since: string): Observable<DashboardItem[] | null> {
    type Row = { item_code: string; item_name: string; qty: number };
    const toItems = (rows: Row[]) => rows
      .map((row) => ({ itemCode: row.item_code, name: row.item_name || row.item_code, quantity: Number(row.qty) || 0 }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    const joined$ = this.api.getList<Row>('Sales Order', {
      fields: [
        '`tabSales Order Item`.item_code as item_code',
        '`tabSales Order Item`.item_name as item_name',
        'sum(`tabSales Order Item`.stock_qty) as qty',
      ],
      filters: [['Sales Order', 'docstatus', '=', 1], ['Sales Order', 'transaction_date', '>=', since]],
      groupBy: '`tabSales Order Item`.item_code',
      orderBy: '`tabSales Order Item`.item_code asc',
      pageLength: 0,
    });
    const child$ = this.api.getList<Row>('Sales Order Item', {
      parentDoctype: 'Sales Order',
      fields: ['item_code', 'item_name', 'sum(stock_qty) as qty'],
      filters: [['Sales Order Item', 'docstatus', '=', 1]],
      groupBy: 'item_code',
      orderBy: 'item_code asc',
      pageLength: 0,
    });

    return joined$.pipe(
      catchError(() => child$),
      map(toItems),
      catchError(() => of(null)),
    );
  }
}

/** One point per calendar day for the last 90 days, zero-filled. */
export function buildTrend(
  rows: Array<{ transaction_date: string; total: number; orders: number }>,
  today: string,
): DashboardTrendPoint[] {
  const byDate = new Map(rows.map((row) => [row.transaction_date, row]));
  return Array.from({ length: TREND_DAYS }, (_, index) => {
    const date = addDaysIso(today, index - (TREND_DAYS - 1));
    const row = byDate.get(date);
    return {
      date,
      label: formatDate(date, 'short'),
      total: Number(row?.total ?? 0),
      orderCount: Number(row?.orders ?? 0),
    };
  });
}
