import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { FrappeApiService, FrappeFilter } from '../../core/api/frappe-api.service';

export interface DateRange {
  from: string;
  to: string;
  company?: string;
}

export interface PeriodRow {
  period: string;
  net: number;
  gross: number;
  invoices: number;
  returns: number;
}

export interface RankedRow {
  key: string;
  label: string;
  value: number;
  qty?: number;
  count?: number;
}

export interface WarehouseRow {
  warehouse: string;
  value: number;
  qty: number;
  items: number;
}

/**
 * Report queries. Every figure is aggregated by ERPNext (SUM / COUNT / GROUP BY) over
 * submitted documents, in company currency (`base_*`), and credit notes are included
 * so totals are *net* of returns.
 */
@Injectable({ providedIn: 'root' })
export class ReportsService {
  private readonly api = inject(FrappeApiService);

  /** Net sales per day; the component rolls days up into weeks or months. */
  salesByDay(range: DateRange): Observable<Array<{ date: string; net: number; gross: number; invoices: number; returns: number }>> {
    return this.api
      .getList<{ posting_date: string; net: number; gross: number; invoices: number; returns: number }>('Sales Invoice', {
        fields: [
          'posting_date',
          'sum(base_net_total) as net',
          'sum(base_grand_total) as gross',
          'count(name) as invoices',
          'sum(is_return) as returns',
        ],
        filters: this.invoiceFilters(range),
        groupBy: 'posting_date',
        orderBy: 'posting_date asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows.map((row) => ({
        date: row.posting_date,
        net: Number(row.net) || 0,
        gross: Number(row.gross) || 0,
        invoices: Number(row.invoices) || 0,
        returns: Number(row.returns) || 0,
      }))));
  }

  salesByCustomer(range: DateRange): Observable<RankedRow[]> {
    return this.api
      .getList<{ customer: string; customer_name: string; net: number; invoices: number }>('Sales Invoice', {
        fields: ['customer', 'customer_name', 'sum(base_net_total) as net', 'count(name) as invoices'],
        filters: this.invoiceFilters(range),
        groupBy: 'customer',
        orderBy: 'customer asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows
        .map((row) => ({ key: row.customer, label: row.customer_name || row.customer, value: Number(row.net) || 0, count: Number(row.invoices) || 0 }))
        .sort((a, b) => b.value - a.value)));
  }

  /** Item lines live in the `Sales Invoice Item` child table, joined to the parent. */
  salesByItem(range: DateRange): Observable<RankedRow[]> {
    type Row = { item_code: string; item_name: string; net: number; qty: number };
    const toRanked = (rows: Row[]) => rows
      .map((row) => ({ key: row.item_code, label: row.item_name || row.item_code, value: Number(row.net) || 0, qty: Number(row.qty) || 0 }))
      .sort((a, b) => b.value - a.value);

    return this.api
      .getList<Row>('Sales Invoice', {
        fields: [
          '`tabSales Invoice Item`.item_code as item_code',
          '`tabSales Invoice Item`.item_name as item_name',
          'sum(`tabSales Invoice Item`.base_net_amount) as net',
          'sum(`tabSales Invoice Item`.stock_qty) as qty',
        ],
        filters: this.invoiceFilters(range),
        groupBy: '`tabSales Invoice Item`.item_code',
        orderBy: '`tabSales Invoice Item`.item_code asc',
        pageLength: 0,
      })
      .pipe(
        map(toRanked),
      );
  }

  stockByWarehouse(): Observable<WarehouseRow[]> {
    return this.api
      .getList<{ warehouse: string; value: number; qty: number; items: number }>('Bin', {
        fields: ['warehouse', 'sum(stock_value) as value', 'sum(actual_qty) as qty', 'count(name) as items'],
        filters: [['Bin', 'actual_qty', '!=', 0]],
        groupBy: 'warehouse',
        orderBy: 'warehouse asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows
        .map((row) => ({ warehouse: row.warehouse, value: Number(row.value) || 0, qty: Number(row.qty) || 0, items: Number(row.items) || 0 }))
        .sort((a, b) => b.value - a.value)));
  }

  private invoiceFilters(range: DateRange): FrappeFilter[] {
    return [
      ['Sales Invoice', 'docstatus', '=', 1],
      ['Sales Invoice', 'posting_date', 'between', [range.from, range.to]],
      ...(range.company ? [['Sales Invoice', 'company', '=', range.company]] : []),
    ];
  }
}

/** Rolls daily rows into month (`yyyy-MM`) buckets, including empty months. */
export function rollUpByMonth(
  days: Array<{ date: string; net: number; gross: number; invoices: number; returns: number }>,
  from: string,
  to: string,
): PeriodRow[] {
  const buckets = new Map<string, PeriodRow>();
  let cursor = from.slice(0, 7);
  const end = to.slice(0, 7);
  while (cursor <= end) {
    buckets.set(cursor, { period: cursor, net: 0, gross: 0, invoices: 0, returns: 0 });
    const [y, m] = cursor.split('-').map(Number);
    cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  for (const day of days) {
    const bucket = buckets.get(day.date.slice(0, 7));
    if (!bucket) continue;
    bucket.net += day.net;
    bucket.gross += day.gross;
    bucket.invoices += day.invoices;
    bucket.returns += day.returns;
  }
  return [...buckets.values()];
}
