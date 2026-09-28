import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, from, map, mergeMap, of, switchMap, toArray } from 'rxjs';
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
  itemCode: string;
  itemName: string;
  itemGroup: string;
  stockUom: string;
  price: number;
  priceList: string;
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

interface ItemBarcodeRow {
  parent: string;
  barcode: string;
}

interface ItemPriceRow {
  item_code: string;
  price_list: string;
  price_list_rate: number;
}

interface ItemPriceRecord extends ItemPriceRow {
  name: string;
}

interface ItemBinRow {
  item_code: string;
  actual_qty: number;
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

  loadPriceLists(): Observable<string[]> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('filters', JSON.stringify([['Price List', 'selling', '=', 1]]))
      .set('limit_page_length', '500')
      .set('order_by', 'name asc');

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/Price List'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(
        map((response) => (response.data ?? []).map((priceList) => priceList.name)),
        catchError(() => of([])),
      );
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
      'standard_rate',
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
      .pipe(
        map((response) => response.data ?? []),
        switchMap((items) => this.enrichListItems(items)),
      );
  }

  private enrichListItems(items: ErpNextItem[]): Observable<ErpNextItem[]> {
    if (!items.length) {
      return of(items);
    }

    const itemCodes = items.map((item) => item.item_code);
    return forkJoin({
      barcodes: this.loadListBarcodes(items),
      prices: this.loadListPrices(itemCodes),
      bins: this.loadListBins(itemCodes),
    }).pipe(map(({ barcodes, prices, bins }) => {
      const barcodeByName = new Map<string, string>();
      for (const row of barcodes ?? []) {
        if (!barcodeByName.has(row.parent)) {
          barcodeByName.set(row.parent, row.barcode);
        }
      }

      const priceByCode = new Map<string, ItemPriceRow>();
      for (const row of prices ?? []) {
        const existing = priceByCode.get(row.item_code);
        if (!existing || (row.price_list === 'Standard Selling' && existing.price_list !== 'Standard Selling')) {
          priceByCode.set(row.item_code, row);
        }
      }

      const quantityByCode = new Map<string, number>();
      for (const row of bins ?? []) {
        quantityByCode.set(row.item_code, (quantityByCode.get(row.item_code) ?? 0) + row.actual_qty);
      }

      return items.map((item) => ({
        ...item,
        barcode: barcodeByName.get(item.name) ?? item.barcode,
        standard_rate: priceByCode.get(item.item_code)?.price_list_rate ?? item.standard_rate,
        actual_qty: bins === null
          ? item.actual_qty
          : item.is_stock_item === 0
            ? undefined
            : quantityByCode.get(item.item_code) ?? 0,
      }));
    }));
  }

  private loadListBarcodes(items: ErpNextItem[]): Observable<ItemBarcodeRow[]> {
    return from(items).pipe(
      mergeMap((item) => this.http
        .get<{ data: ErpNextItemDetails }>(
          this.auth.apiUrl('/api/resource/Item/' + encodeURIComponent(item.name)),
          {
            withCredentials: true,
            context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
          },
        )
        .pipe(
          map((response) => ({
            parent: item.name,
            barcode: response.data.barcodes?.[0]?.barcode ?? '',
          })),
          catchError(() => of({ parent: item.name, barcode: '' })),
        ), 8),
      toArray(),
    );
  }

  private loadListPrices(itemCodes: string[]): Observable<ItemPriceRow[] | null> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['item_code', 'price_list', 'price_list_rate']))
      .set('filters', JSON.stringify([
        ['Item Price', 'item_code', 'in', itemCodes],
        ['Item Price', 'selling', '=', 1],
      ]))
      .set('order_by', 'modified desc')
      .set('limit_page_length', '1000');

    return this.http
      .get<ErpNextListResponse<ItemPriceRow>>(this.auth.apiUrl('/api/resource/Item Price'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []), catchError(() => of(null)));
  }

  private loadListBins(itemCodes: string[]): Observable<ItemBinRow[] | null> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['item_code', 'actual_qty']))
      .set('filters', JSON.stringify([['Bin', 'item_code', 'in', itemCodes]]))
      .set('limit_page_length', '1000');

    return this.http
      .get<ErpNextListResponse<ItemBinRow>>(this.auth.apiUrl('/api/resource/Bin'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => response.data ?? []), catchError(() => of(null)));
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
      .pipe(switchMap((response) => this.saveSellingPrice(details.itemCode, details)
        .pipe(map(() => response.data))));
  }

  loadSellingPrice(itemCode: string): Observable<{ price: number; priceList: string }> {
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name', 'item_code', 'price_list', 'price_list_rate']))
      .set('filters', JSON.stringify([
        ['Item Price', 'item_code', '=', itemCode],
        ['Item Price', 'selling', '=', 1],
      ]))
      .set('order_by', 'modified desc')
      .set('limit_page_length', '100');

    return this.http
      .get<ErpNextListResponse<ItemPriceRecord>>(this.auth.apiUrl('/api/resource/Item Price'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(map((response) => {
        const prices = response.data ?? [];
        const price = prices.find((row) => row.price_list === 'Standard Selling') ?? prices[0];
        return {
          price: price?.price_list_rate ?? 0,
          priceList: price?.price_list ?? 'Standard Selling',
        };
      }), catchError(() => of({ price: 0, priceList: 'Standard Selling' })));
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

  duplicate(item: ErpNextItemDetails, details: EditItemDetails): Observable<ErpNextItem> {
    return this.http
      .post<{ data: ErpNextItem }>(this.auth.apiUrl('/api/resource/Item'), {
        item_code: details.itemCode.trim(),
        item_name: details.itemName.trim(),
        item_group: details.itemGroup,
        stock_uom: details.stockUom,
        is_stock_item: details.isStockItem ? 1 : 0,
        is_sales_item: item.is_sales_item ?? 1,
        image: details.imageUrl.trim() || undefined,
        uoms: details.uoms.filter((unit) => unit.uom !== details.stockUom),
        barcodes: details.barcode.trim() ? [{ barcode: details.barcode.trim() }] : [],
      }, { withCredentials: true })
      .pipe(switchMap((response) => this.saveSellingPrice(details.itemCode, details)
        .pipe(map(() => response.data))));
  }

  private saveSellingPrice(itemCode: string, details: EditItemDetails): Observable<void> {
    const priceList = details.priceList.trim();
    if (details.price <= 0 || !priceList) {
      return of(undefined);
    }

    const params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('filters', JSON.stringify([
        ['Item Price', 'item_code', '=', itemCode],
        ['Item Price', 'price_list', '=', priceList],
        ['Item Price', 'selling', '=', 1],
      ]))
      .set('limit_page_length', '1');

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/Item Price'), {
        params,
        withCredentials: true,
        context: new HttpContext().set(SKIP_ERP_NEXT_UNAUTHORIZED_HANDLER, true),
      })
      .pipe(switchMap((response) => {
        const existing = response.data?.[0];
        if (existing) {
          return this.http
            .put(this.auth.apiUrl('/api/resource/Item Price/' + encodeURIComponent(existing.name)), {
              price_list_rate: details.price,
            }, { withCredentials: true })
            .pipe(map(() => undefined));
        }

        return this.http
          .post(this.auth.apiUrl('/api/resource/Item Price'), {
            item_code: itemCode,
            price_list: priceList,
            price_list_rate: details.price,
            selling: 1,
          }, { withCredentials: true })
          .pipe(map(() => undefined));
      }));
  }

  nextDuplicateCode(itemCode: string): Observable<string> {
    return this.findAvailableDuplicateCode(itemCode);
  }

  private findAvailableDuplicateCode(itemCode: string, copyNumber = 1): Observable<string> {
    const duplicateCode = `${itemCode}-COPY${copyNumber === 1 ? '' : `-${copyNumber}`}`;
    const params = new HttpParams()
      .set('fields', JSON.stringify(['name']))
      .set('filters', JSON.stringify([['Item', 'item_code', '=', duplicateCode]]))
      .set('limit_page_length', '1');

    return this.http
      .get<ErpNextListResponse<{ name: string }>>(this.auth.apiUrl('/api/resource/Item'), {
        params,
        withCredentials: true,
      })
      .pipe(switchMap((response) => response.data?.length
        ? this.findAvailableDuplicateCode(itemCode, copyNumber + 1)
        : of(duplicateCode)));
  }
}