import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { FrappeApiService, FrappeFilter, Page } from '../../core/api/frappe-api.service';
import { ErpNextBin, ErpNextStockEntry, ErpNextStockEntryType, ErpNextStockLedgerEntry } from '../../models/stock.models';

/**
 * ERPNext v15's only `naming_series` option for Stock Entry. The field is `reqd`
 * and the doctype ships no default, so an API insert has to supply it.
 */
const STOCK_ENTRY_NAMING_SERIES = 'MAT-STE-.YYYY.-';

export interface StockEntryRequestItem {
  itemCode: string;
  qty: number;
  uom?: string;
}

export interface StockEntryRequest {
  stockEntryType: string;
  company: string;
  postingDate: string;
  fromWarehouse?: string;
  toWarehouse?: string;
  items: StockEntryRequestItem[];
}

export interface StockQuery {
  warehouse?: string;
  search?: string;
  page: number;
  pageSize: number;
}

/**
 * Stock reads (`Bin`, `Stock Ledger Entry`) and `Stock Entry` writes. Entries are
 * created as drafts; submitting is a separate, confirmed step because it posts
 * ledger and GL entries.
 */
@Injectable({ providedIn: 'root' })
export class StockService {
  private readonly api = inject(FrappeApiService);

  levels(query: StockQuery): Observable<Page<ErpNextBin>> {
    const filters: FrappeFilter[] = [];
    if (query.warehouse) filters.push(['Bin', 'warehouse', '=', query.warehouse]);
    const search = (query.search ?? '').trim();
    if (search) filters.push(['Bin', 'item_code', 'like', `%${search}%`]);
    return this.api.getPage<ErpNextBin>('Bin', {
      fields: ['name', 'item_code', 'warehouse', 'actual_qty', 'projected_qty', 'reserved_qty', 'ordered_qty', 'valuation_rate', 'stock_value', 'stock_uom'],
      filters,
      orderBy: 'item_code asc',
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  movements(query: StockQuery): Observable<Page<ErpNextStockLedgerEntry>> {
    const filters: FrappeFilter[] = [['Stock Ledger Entry', 'is_cancelled', '=', 0]];
    if (query.warehouse) filters.push(['Stock Ledger Entry', 'warehouse', '=', query.warehouse]);
    const search = (query.search ?? '').trim();
    if (search) filters.push(['Stock Ledger Entry', 'item_code', 'like', `%${search}%`]);
    return this.api.getPage<ErpNextStockLedgerEntry>('Stock Ledger Entry', {
      fields: ['name', 'item_code', 'warehouse', 'actual_qty', 'qty_after_transaction', 'voucher_type', 'voucher_no', 'posting_date', 'posting_time', 'incoming_rate', 'valuation_rate', 'stock_uom'],
      filters,
      orderBy: 'posting_date desc, posting_time desc, creation desc',
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  entries(query: StockQuery): Observable<Page<ErpNextStockEntry>> {
    const filters: FrappeFilter[] = [];
    if (query.warehouse) {
      // Matches entries moving stock out of or into the warehouse.
      return this.api.getPage<ErpNextStockEntry>('Stock Entry', {
        fields: this.entryFields(),
        orFilters: [
          ['Stock Entry', 'from_warehouse', '=', query.warehouse],
          ['Stock Entry', 'to_warehouse', '=', query.warehouse],
        ],
        orderBy: 'modified desc',
        page: query.page,
        pageSize: query.pageSize,
      });
    }
    return this.api.getPage<ErpNextStockEntry>('Stock Entry', {
      fields: this.entryFields(),
      filters,
      orderBy: 'modified desc',
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  listWarehouses(): Observable<string[]> {
    return this.api
      .getList<{ name: string }>('Warehouse', {
        fields: ['name'],
        filters: [['Warehouse', 'is_group', '=', 0], ['Warehouse', 'disabled', '=', 0]],
        orderBy: 'name asc',
        pageLength: 0,
      })
      .pipe(map((rows) => rows.map((row) => row.name)));
  }

  listCompanies(): Observable<Array<{ name: string }>> {
    return this.api.getList<{ name: string }>('Company', { fields: ['name'], orderBy: 'creation asc', pageLength: 0 });
  }

  listStockEntryTypes(): Observable<ErpNextStockEntryType[]> {
    return this.api.getList<ErpNextStockEntryType>('Stock Entry Type', { fields: ['name', 'purpose'], orderBy: 'name asc', pageLength: 0 });
  }

  /** Item name and stock UOM for an entry line. */
  itemInfo(itemCode: string): Observable<{ item_name?: string; stock_uom?: string }> {
    return this.api.getDoc<{ item_name?: string; stock_uom?: string }>('Item', itemCode);
  }

  /**
   * Creates a Stock Entry as a **draft**. Warehouses are also set on each row
   * (`s_warehouse` / `t_warehouse`), which is what the ledger actually reads.
   */
  createStockEntry(request: StockEntryRequest): Observable<{ name: string }> {
    return this.api.insert<{ name: string }>('Stock Entry', {
      naming_series: STOCK_ENTRY_NAMING_SERIES,
      stock_entry_type: request.stockEntryType,
      company: request.company,
      posting_date: request.postingDate,
      set_posting_time: 1,
      from_warehouse: request.fromWarehouse || undefined,
      to_warehouse: request.toWarehouse || undefined,
      items: request.items.map((item) => ({
        item_code: item.itemCode,
        qty: item.qty,
        uom: item.uom || undefined,
        s_warehouse: request.fromWarehouse || undefined,
        t_warehouse: request.toWarehouse || undefined,
      })),
    });
  }

  submit(name: string): Observable<void> {
    return this.api.submit('Stock Entry', name);
  }

  cancel(name: string): Observable<void> {
    return this.api.cancel('Stock Entry', name);
  }

  delete(name: string): Observable<void> {
    return this.api.delete('Stock Entry', name);
  }

  private entryFields(): string[] {
    return ['name', 'stock_entry_type', 'purpose', 'company', 'posting_date', 'posting_time', 'from_warehouse', 'to_warehouse', 'total_outgoing_value', 'total_incoming_value', 'docstatus', 'modified'];
  }
}
