import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { catchError, map, Observable, of } from 'rxjs';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../core/auth/auth.context';
import { ErpNextAuthService } from '../../core/auth/erpnext-auth.service';
import { ErpNextListResponse } from '../../models/erpnext-document.models';
import { ErpNextItem } from '../../models/item.models';
import {
  ErpNextBin,
  ErpNextStockEntry,
  ErpNextStockEntryType,
  ErpNextStockLedgerEntry,
  StockEntryPurpose,
} from '../../models/stock.models';

/**
 * ERPNext v15's only `naming_series` option for Stock Entry. The field is `reqd`
 * and the doctype ships no default, so an API insert has to supply it - leaving it
 * empty fails validation with "naming_series is mandatory".
 */
const STOCK_ENTRY_NAMING_SERIES = 'MAT-STE-.YYYY.-';

const STOCK_ENTRY_FIELDS = [
  'name',
  'stock_entry_type',
  'purpose',
  'company',
  'posting_date',
  'posting_time',
  'from_warehouse',
  'to_warehouse',
  'total_outgoing_value',
  'total_incoming_value',
  'docstatus',
  'status',
  'modified',
];

export interface StockLevelQuery {
  warehouse?: string;
  /** Matched against `item_code` with LIKE. */
  search?: string;
  pageSize?: number;
}

export interface MovementQuery {
  itemCode?: string;
  warehouse?: string;
  pageSize?: number;
}

export interface StockEntryRequestItem {
  itemCode: string;
  qty: number;
  uom?: string;
  sourceWarehouse?: string;
  targetWarehouse?: string;
  basicRate?: number;
  batchNo?: string;
}

export interface StockEntryRequest {
  /** A `Stock Entry Type` name, e.g. `Material Issue`. Its purpose drives behaviour. */
  stockEntryType: string;
  company: string;
  /** `yyyy-MM-dd`. */
  postingDate: string;
  fromWarehouse?: string;
  toWarehouse?: string;
  items: StockEntryRequestItem[];
}

/**
 * Stock reads and `Stock Entry` writes.
 *
 * `Bin` and `Stock Ledger Entry` are read-only roll-ups, so this service only ever
 * reads them. Stock Entries are created as drafts; submitting is a separate,
 * explicit step because it posts ledger and GL entries.
 */
@Injectable({ providedIn: 'root' })
export class StockService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  /** Stock on hand per item/warehouse. */
  listStockLevels(query: StockLevelQuery = {}): Observable<ErpNextBin[]> {
    const fields = [
      'name',
      'item_code',
      'warehouse',
      'actual_qty',
      'projected_qty',
      'reserved_qty',
      'ordered_qty',
      'valuation_rate',
      'stock_value',
      'stock_uom',
    ];

    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', String(query.pageSize ?? 200))
      .set('order_by', 'item_code asc');

    const filters: unknown[][] = [];
    if (query.warehouse) {
      filters.push(['Bin', 'warehouse', '=', query.warehouse]);
    }
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }

    const search = (query.search ?? '').trim();
    if (search !== '') {
      params = params.set('or_filters', JSON.stringify([
        ['Bin', 'item_code', 'like', `%${search}%`],
      ]));
    }

    return this.getList<ErpNextBin>('Bin', params);
  }

  /** Recent stock movements, newest first. */
  listMovements(query: MovementQuery = {}): Observable<ErpNextStockLedgerEntry[]> {
    const fields = [
      'name',
      'item_code',
      'warehouse',
      'actual_qty',
      'qty_after_transaction',
      'voucher_type',
      'voucher_no',
      'posting_date',
      'posting_time',
      'incoming_rate',
      'valuation_rate',
      'stock_uom',
    ];

    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', String(query.pageSize ?? 200))
      .set('order_by', 'posting_date desc, posting_time desc, creation desc');

    const filters: unknown[][] = [['Stock Ledger Entry', 'is_cancelled', '=', 0]];
    if (query.itemCode) {
      filters.push(['Stock Ledger Entry', 'item_code', '=', query.itemCode]);
    }
    if (query.warehouse) {
      filters.push(['Stock Ledger Entry', 'warehouse', '=', query.warehouse]);
    }
    params = params.set('filters', JSON.stringify(filters));

    return this.getList<ErpNextStockLedgerEntry>('Stock Ledger Entry', params);
  }

  /** Recent stock entries (drafts and submitted). */
  listStockEntries(pageSize = 100): Observable<ErpNextStockEntry[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(STOCK_ENTRY_FIELDS))
      .set('limit_page_length', String(pageSize))
      .set('order_by', 'modified desc');

    return this.getList<ErpNextStockEntry>('Stock Entry', params);
  }

  /** Leaf warehouses only, which is what stock can actually live in. */
  listWarehouses(): Observable<string[]> {
    return this.listNames('Warehouse', [['Warehouse', 'is_group', '=', 0]]);
  }

  /** Companies a stock entry can belong to. */
  listCompanies(): Observable<Array<{ name: string; default_currency?: string }>> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name', 'default_currency']))
      .set('limit_page_length', '0')
      .set('order_by', 'name asc');
    return this.getList<{ name: string; default_currency?: string }>('Company', params);
  }

  /**
   * Stock-tracked items for the entry line picker. Capped at 500 rows to match the
   * other option lookups in this app; a search endpoint is the upgrade path once a
   * site has more items than that.
   */
  listItems(): Observable<ErpNextItem[]> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name', 'item_code', 'item_name', 'stock_uom']))
      .set('limit_page_length', '500')
      .set('order_by', 'item_code asc')
      .set('filters', JSON.stringify([
        ['Item', 'disabled', '=', 0],
        ['Item', 'is_stock_item', '=', 1],
      ]));
    return this.getList<ErpNextItem>('Item', params);
  }
  /** Stock Entry Types, whose `purpose` decides the entry's behaviour. */
  listStockEntryTypes(): Observable<ErpNextStockEntryType[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(['name', 'purpose']))
      .set('limit_page_length', '0')
      .set('order_by', 'name asc');
    return this.getList<ErpNextStockEntryType>('Stock Entry Type', params);
  }

  /**
   * Creates a Stock Entry as a **draft**.
   *
   * Warehouses are set on every item row as well as at document level: the row-level
   * `s_warehouse`/`t_warehouse` are the fields the ledger actually reads, so relying
   * on the document-level pair alone is not safe.
   */
  createStockEntry(request: StockEntryRequest): Observable<{ name: string }> {
    const payload = {
      naming_series: STOCK_ENTRY_NAMING_SERIES,
      stock_entry_type: request.stockEntryType,
      company: request.company,
      posting_date: request.postingDate,
      from_warehouse: request.fromWarehouse || undefined,
      to_warehouse: request.toWarehouse || undefined,
      items: request.items.map((item) => ({
        item_code: item.itemCode,
        qty: item.qty,
        uom: item.uom || undefined,
        s_warehouse: item.sourceWarehouse || request.fromWarehouse || undefined,
        t_warehouse: item.targetWarehouse || request.toWarehouse || undefined,
        basic_rate: item.basicRate,
        batch_no: item.batchNo || undefined,
      })),
    };

    return this.http
      .post<{ data: { name: string } }>(
        this.auth.apiUrl('/api/resource/Stock Entry'),
        payload,
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  /**
   * Submits a draft document by moving it to `docstatus: 1`.
   *
   * This posts the stock ledger and GL entries and is irreversible apart from a
   * cancel, so callers must confirm with the user first.
   */
  submit(doctype: string, name: string): Observable<void> {
    return this.http
      .put<unknown>(
        this.auth.apiUrl(
          '/api/resource/' + encodeURIComponent(doctype) + '/' + encodeURIComponent(name),
        ),
        { docstatus: 1 },
        { withCredentials: true },
      )
      .pipe(map(() => undefined));
  }

  /** Convenience for the identifiers used by `StockEntryPurpose`. */
  static purposeLabel(purpose: StockEntryPurpose): string {
    return purpose;
  }

  private listNames(doctype: string, filters: unknown[][]): Observable<string[]> {
    let params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('limit_page_length', '0')
      .set('order_by', 'name asc');
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }
    return this.getList<{ name: string }>(doctype, params)
      .pipe(map((records) => records.map((record) => record.name)));
  }

  private getList<T>(doctype: string, params: HttpParams): Observable<T[]> {
    return this.http
      .get<ErpNextListResponse<T>>(
        this.auth.apiUrl('/api/resource/' + encodeURIComponent(doctype)),
        {
          params,
          withCredentials: true,
          context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
        },
      )
      .pipe(
        map((response) => response.data ?? []),
        catchError(() => of([])),
      );
  }
}
