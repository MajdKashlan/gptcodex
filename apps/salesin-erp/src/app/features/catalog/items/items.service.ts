import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { ErpNextAuthService } from '../../../core/auth/erpnext-auth.service';
import { SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER } from '../../../core/auth/auth.context';
import { ErpNextListResponse } from '../../../models/erpnext-document.models';
import { ErpNextItem } from '../../../models/item.models';

export type ItemSearchMode = 'name' | 'code' | 'either';

export interface ItemSearch {
  category: string | null;
  query: string;
  mode: ItemSearchMode;
}

export interface NewItemDetails {
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  salesUom: string;
  salesUnits: number;
  barcode: string;
  isStockItem: boolean;
  imageUrl: string;
  price: number;
  priceList: string;
}

export interface EditItemDetails {
  itemName: string;
  itemGroup: string;
  stockUom: string;
  uoms: Array<{ uom: string; conversion_factor: number }>;
  barcode: string;
  isStockItem: boolean;
  imageUrl: string;
}

export interface ItemStockLevel {
  warehouse: string;
  actual_qty: number;
}

export interface ErpNextItemDetails extends ErpNextItem {
  uoms?: Array<{ uom: string; conversion_factor: number }>;
  barcodes?: Array<{ barcode: string }>;
}

interface CreatedItemResponse {
  data: ErpNextItem;
}

@Injectable({ providedIn: 'root' })
export class ItemsService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(ErpNextAuthService);

  loadCategories(): Observable<string[]> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/Item Group'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => (response.data ?? []).map((group) => group.name)));
  }

  loadUoms(): Observable<string[]> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/UOM'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => (response.data ?? []).map((uom) => uom.name)));
  }

  search(search: ItemSearch): Observable<ErpNextItem[]> {
    const fields = [
      'name',
      'item_code',
      'item_name',
      'item_group',
      'image',
      'stock_uom',
      'is_stock_item',
      'modified',
    ];
    let params = new HttpParams()
      .set('fields', JSON.stringify(fields))
      .set('limit_page_length', '100')
      .set('order_by', 'modified desc');

    const filters: unknown[][] = [];
    if (search.category) {
      filters.push(['Item', 'item_group', '=', search.category]);
    }
    const term = search.query.trim();
    if (term) {
      const nameFilter = ['Item', 'item_name', 'like', `%${term}%`];
      const codeFilter = ['Item', 'item_code', 'like', `%${term}%`];
      if (search.mode === 'name') {
        filters.push(nameFilter);
      } else if (search.mode === 'code') {
        filters.push(codeFilter);
      } else {
        params = params.set('or_filters', JSON.stringify([nameFilter, codeFilter]));
      }
    }
    if (filters.length) {
      params = params.set('filters', JSON.stringify(filters));
    }

    return this.http
      .get<ErpNextListResponse<ErpNextItem>>(this.auth.apiUrl('/api/resource/Item'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []));
  }

  create(details: NewItemDetails): Observable<{ item: ErpNextItem; priceWarning: boolean }> {
    const item = {
      item_code: details.itemCode.trim() || undefined,
      item_name: details.itemName.trim(),
      item_group: details.itemGroup,
      stock_uom: details.stockUom.trim(),
      is_stock_item: details.isStockItem ? 1 : 0,
      is_sales_item: 1,
      uoms: details.salesUom.trim() !== details.stockUom.trim()
        ? [{ uom: details.salesUom.trim(), conversion_factor: details.salesUnits }]
        : [],
      image: details.imageUrl.trim() || undefined,
      barcodes: details.barcode.trim() ? [{ barcode: details.barcode.trim() }] : [],
    };

    return this.http
      .post<CreatedItemResponse>(this.auth.apiUrl('/api/resource/Item'), item, {
        withCredentials: true,
      })
      .pipe(
        map((response) => response.data),
        switchMap((createdItem) => {
          if (details.price <= 0 || !details.priceList.trim()) {
            return of({ item: createdItem, priceWarning: false });
          }

          return this.http
            .post(this.auth.apiUrl('/api/resource/Item Price'), {
              item_code: createdItem.item_code,
              price_list: details.priceList.trim(),
              price_list_rate: details.price,
              selling: 1,
            }, { withCredentials: true })
            .pipe(
              map(() => ({ item: createdItem, priceWarning: false })),
              catchError(() => of({ item: createdItem, priceWarning: true })),
            );
        }),
      );
  }

  update(itemName: string, details: EditItemDetails): Observable<ErpNextItem> {
    return this.http
      .put<{ data: ErpNextItem }>(
        this.auth.apiUrl('/api/resource/Item/' + encodeURIComponent(itemName)),
        {
          item_name: details.itemName.trim(),
          item_group: details.itemGroup,
          stock_uom: details.stockUom,
          is_stock_item: details.isStockItem ? 1 : 0,
          uoms: details.uoms.filter((unit) => unit.uom !== details.stockUom),
          barcodes: details.barcode.trim() ? [{ barcode: details.barcode.trim() }] : [],
          image: details.imageUrl.trim() || null,
        },
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  loadItem(itemName: string): Observable<ErpNextItemDetails> {
    return this.http
      .get<{ data: ErpNextItemDetails }>(
        this.auth.apiUrl('/api/resource/Item/' + encodeURIComponent(itemName)),
        { withCredentials: true },
      )
      .pipe(map((response) => response.data));
  }

  loadStockLevels(itemCode: string): Observable<ItemStockLevel[]> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['warehouse', 'actual_qty']))
      .set('filters', JSON.stringify([['Bin', 'item_code', '=', itemCode]]))
      .set('limit_page_length', '500')
      .set('order_by', 'warehouse asc');

    return this.http
      .get<ErpNextListResponse<ItemStockLevel>>(this.auth.apiUrl('/api/resource/Bin'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(
        map((response) => response.data ?? []),
        catchError(() => of([])),
      );
  }

  delete(itemName: string): Observable<void> {
    return this.http
      .delete(this.auth.apiUrl('/api/resource/Item/' + encodeURIComponent(itemName)), {
        withCredentials: true,
      })
      .pipe(map(() => undefined));
  }

  duplicate(item: ErpNextItemDetails): Observable<ErpNextItem> {
    return this.http
      .post<{ data: ErpNextItem }>(this.auth.apiUrl('/api/resource/Item'), {
        item_name: item.item_name + ' (Copy)',
        item_group: item.item_group,
        stock_uom: item.stock_uom,
        is_stock_item: item.is_stock_item ?? 1,
        is_sales_item: item.is_sales_item ?? 1,
        image: item.image || undefined,
        uoms: item.uoms ?? [],
        barcodes: [],
      }, { withCredentials: true })
      .pipe(map((response) => response.data));
  }
}