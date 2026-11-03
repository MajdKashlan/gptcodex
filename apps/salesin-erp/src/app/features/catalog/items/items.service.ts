import { inject, Injectable } from '@angular/core';
import { Observable, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { FrappeApiService, FrappeFilter, Page } from '../../../core/api/frappe-api.service';
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
  currency?: string;
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
  private readonly api = inject(FrappeApiService);

  loadCategories(): Observable<string[]> {
    return this.names('Item Group', [], false);
  }

  loadUoms(): Observable<string[]> {
    return this.names('UOM', [['UOM', 'enabled', '=', 1]], false);
  }

  loadPriceLists(): Observable<string[]> {
    return this.names('Price List', [['Price List', 'selling', '=', 1]], true);
  }

  /** One server page of items, enriched with barcode, selling price and stock. */
  search(search: ItemSearch, page: number, pageSize: number): Observable<Page<ErpNextItem>> {
    const filters: FrappeFilter[] = [];
    let orFilters: FrappeFilter[] = [];
    if (search.category) filters.push(['Item', 'item_group', '=', search.category]);
    const term = search.query.trim();
    if (term) {
      const nameFilter = ['Item', 'item_name', 'like', `%${term}%`];
      const codeFilter = ['Item', 'item_code', 'like', `%${term}%`];
      if (search.mode === 'name') filters.push(nameFilter);
      else if (search.mode === 'code') filters.push(codeFilter);
      else orFilters = [nameFilter, codeFilter];
    }
    return this.api
      .getPage<ErpNextItem>('Item', {
        fields: ['name', 'item_code', 'item_name', 'item_group', 'image', 'stock_uom', 'is_stock_item', 'standard_rate', 'disabled', 'modified'],
        filters,
        orFilters,
        orderBy: 'modified desc',
        page,
        pageSize,
      })
      .pipe(switchMap(({ rows, total }) => this.enrichListItems(rows).pipe(map((enriched) => ({ rows: enriched, total })))));
  }

  /**
   * Adds barcode, selling price and stock-on-hand with three batched queries for the
   * whole page (previously one full Item request per row).
   */
  private enrichListItems(items: ErpNextItem[]): Observable<ErpNextItem[]> {
    if (!items.length) return of(items);
    const itemCodes = items.map((item) => item.item_code);
    const optional = <T>(source: Observable<T[]>) => source.pipe(catchError(() => of(null)));

    return forkJoin({
      barcodes: optional(this.api.getList<ItemBarcodeRow>('Item Barcode', {
        parentDoctype: 'Item',
        fields: ['parent', 'barcode'],
        filters: [['Item Barcode', 'parent', 'in', items.map((item) => item.name)]],
        pageLength: 0,
      })),
      prices: optional(this.api.getList<ItemPriceRow>('Item Price', {
        fields: ['item_code', 'price_list', 'price_list_rate', 'currency'],
        filters: [['Item Price', 'item_code', 'in', itemCodes], ['Item Price', 'selling', '=', 1]],
        orderBy: 'modified desc',
        pageLength: 0,
      })),
      bins: optional(this.api.getList<ItemBinRow>('Bin', {
        fields: ['item_code', 'sum(actual_qty) as actual_qty'],
        filters: [['Bin', 'item_code', 'in', itemCodes]],
        groupBy: 'item_code',
        orderBy: 'item_code asc',
        pageLength: 0,
      })),
    }).pipe(map(({ barcodes, prices, bins }) => {
      const barcodeByName = new Map<string, string>();
      for (const row of barcodes ?? []) {
        if (!barcodeByName.has(row.parent)) barcodeByName.set(row.parent, row.barcode);
      }
      const priceByCode = new Map<string, ItemPriceRow>();
      for (const row of prices ?? []) {
        const existing = priceByCode.get(row.item_code);
        if (!existing || (row.price_list === 'Standard Selling' && existing.price_list !== 'Standard Selling')) {
          priceByCode.set(row.item_code, row);
        }
      }
      const quantityByCode = new Map((bins ?? []).map((row) => [row.item_code, Number(row.actual_qty) || 0]));

      return items.map((item) => ({
        ...item,
        barcode: barcodeByName.get(item.name) ?? item.barcode,
        standard_rate: priceByCode.get(item.item_code)?.price_list_rate ?? item.standard_rate,
        price_currency: priceByCode.get(item.item_code)?.currency,
        actual_qty: bins === null || item.is_stock_item === 0 ? undefined : quantityByCode.get(item.item_code) ?? 0,
      }));
    }));
  }

  create(details: NewItemDetails): Observable<{ item: ErpNextItem; priceWarning: boolean }> {
    const item = {
      item_code: details.itemCode.trim() || undefined,
      item_name: details.itemName.trim(),
      item_group: details.itemGroup,
      stock_uom: details.stockUom.trim(),
      is_stock_item: details.isStockItem ? 1 : 0,
      is_sales_item: 1,
      sales_uom: details.salesUom.trim() || undefined,
      uoms: details.salesUom.trim() !== details.stockUom.trim()
        ? [{ uom: details.salesUom.trim(), conversion_factor: details.salesUnits }]
        : [],
      image: details.imageUrl.trim() || undefined,
      barcodes: details.barcode.trim() ? [{ barcode: details.barcode.trim() }] : [],
    };

    return this.api.insert<ErpNextItem>('Item', item).pipe(
      switchMap((createdItem) => {
        if (details.price <= 0 || !details.priceList.trim()) {
          return of({ item: createdItem, priceWarning: false });
        }
        return this.api
          .insert('Item Price', {
            item_code: createdItem.item_code,
            price_list: details.priceList.trim(),
            price_list_rate: details.price,
            uom: details.salesUom.trim() || undefined,
            selling: 1,
          })
          .pipe(
            map(() => ({ item: createdItem, priceWarning: false })),
            catchError(() => of({ item: createdItem, priceWarning: true })),
          );
      }),
    );
  }

  update(itemName: string, details: EditItemDetails): Observable<ErpNextItem> {
    return this.api
      .update<ErpNextItem>('Item', itemName, {
        item_name: details.itemName.trim(),
        item_group: details.itemGroup,
        stock_uom: details.stockUom,
        is_stock_item: details.isStockItem ? 1 : 0,
        uoms: [
          { uom: details.stockUom, conversion_factor: 1 },
          ...details.uoms.filter((unit) => unit.uom !== details.stockUom),
        ],
        barcodes: details.barcode.trim() ? [{ barcode: details.barcode.trim() }] : [],
        image: details.imageUrl.trim() || null,
      })
      .pipe(switchMap((item) => this.saveSellingPrice(details.itemCode, details).pipe(map(() => item))));
  }

  loadSellingPrice(itemCode: string): Observable<{ price: number; priceList: string }> {
    return this.api
      .getList<ItemPriceRecord>('Item Price', {
        fields: ['name', 'item_code', 'price_list', 'price_list_rate'],
        filters: [['Item Price', 'item_code', '=', itemCode], ['Item Price', 'selling', '=', 1]],
        orderBy: 'modified desc',
        pageLength: 100,
      })
      .pipe(
        map((prices) => {
          const price = prices.find((row) => row.price_list === 'Standard Selling') ?? prices[0];
          return { price: price?.price_list_rate ?? 0, priceList: price?.price_list ?? 'Standard Selling' };
        }),
        catchError(() => of({ price: 0, priceList: 'Standard Selling' })),
      );
  }

  loadItem(itemName: string): Observable<ErpNextItemDetails> {
    return this.api.getDoc<ErpNextItemDetails>('Item', itemName);
  }

  loadStockLevels(itemCode: string): Observable<ItemStockLevel[]> {
    return this.api
      .getList<ItemStockLevel>('Bin', {
        fields: ['warehouse', 'actual_qty'],
        filters: [['Bin', 'item_code', '=', itemCode]],
        orderBy: 'warehouse asc',
        pageLength: 0,
      })
      .pipe(catchError(() => of([])));
  }

  delete(itemName: string): Observable<void> {
    return this.api.delete('Item', itemName);
  }

  duplicate(item: ErpNextItemDetails, details: EditItemDetails): Observable<ErpNextItem> {
    return this.api
      .insert<ErpNextItem>('Item', {
        item_code: details.itemCode.trim(),
        item_name: details.itemName.trim(),
        item_group: details.itemGroup,
        stock_uom: details.stockUom,
        is_stock_item: details.isStockItem ? 1 : 0,
        is_sales_item: item.is_sales_item ?? 1,
        image: details.imageUrl.trim() || undefined,
        uoms: details.uoms.filter((unit) => unit.uom !== details.stockUom),
        barcodes: details.barcode.trim() ? [{ barcode: details.barcode.trim() }] : [],
      })
      .pipe(switchMap((created) => this.saveSellingPrice(details.itemCode, details).pipe(map(() => created))));
  }

  nextDuplicateCode(itemCode: string, copyNumber = 1): Observable<string> {
    const duplicateCode = `${itemCode}-COPY${copyNumber === 1 ? '' : `-${copyNumber}`}`;
    return this.api
      .getCount('Item', [['Item', 'item_code', '=', duplicateCode]])
      .pipe(switchMap((count) => (count ? this.nextDuplicateCode(itemCode, copyNumber + 1) : of(duplicateCode))));
  }

  private saveSellingPrice(itemCode: string, details: EditItemDetails): Observable<void> {
    const priceList = details.priceList.trim();
    if (details.price <= 0 || !priceList) return of(undefined);
    return this.api
      .getList<{ name: string }>('Item Price', {
        fields: ['name'],
        filters: [
          ['Item Price', 'item_code', '=', itemCode],
          ['Item Price', 'price_list', '=', priceList],
          ['Item Price', 'selling', '=', 1],
        ],
        pageLength: 1,
      })
      .pipe(
        switchMap((rows) => rows[0]
          ? this.api.update('Item Price', rows[0].name, { price_list_rate: details.price })
          : this.api.insert('Item Price', { item_code: itemCode, price_list: priceList, price_list_rate: details.price, selling: 1 })),
        map(() => undefined),
      );
  }

  private names(doctype: string, filters: FrappeFilter[], optional: boolean): Observable<string[]> {
    const list$ = this.api
      .getList<{ name: string }>(doctype, { fields: ['name'], filters, orderBy: 'name asc', pageLength: 0 })
      .pipe(map((rows) => rows.map((row) => row.name)));
    return optional ? list$.pipe(catchError(() => of([]))) : list$;
  }
}
